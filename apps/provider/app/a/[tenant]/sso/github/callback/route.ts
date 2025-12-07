import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug, getActivePrivateJwk } from '@/services/jwks';
import { consumeUpstreamState, getGithubProvider } from '@/services/idp';
import { getPending, publishSSE, setPendingUser, scopesFromString, serializeParams, completePending } from '@/services/authz';
import { prisma } from '@/lib/prisma';
import { getIssuerURL } from '@/utils/issuer';
import { importJWK, SignJWT } from 'jose';
import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';

function html(body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"/><body style="font-family:system-ui;padding:24px;max-width:720px;margin:0 auto">${body}</body>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return html('<h1>Error</h1><p>missing tenant</p>', 400);

  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description') || undefined;
  const stateParam = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';

  if (error) {
    return html(`<h1>GitHub sign-in failed</h1><p>${escapeHtml(errorDesc || error)}</p>`, 400);
  }
  if (!stateParam || !code) return html('<h1>Error</h1><p>missing code or state</p>', 400);

  const us = await consumeUpstreamState(stateParam);
  if (!us || us.tenantSlug !== tenantSlug) return html('<h1>Invalid or expired session</h1>', 400);

  const pending = await getPending(us.rid);
  if (!pending || pending.tenantSlug !== tenantSlug) return html('<h1>Your login session has expired. Please try again.</h1>', 400);

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return html('<h1>Unknown tenant</h1>', 400);

  const provider = await getGithubProvider(tenant.id);
  if (!provider) return html('<h1>GitHub sign-in not configured</h1><p>Please contact your administrator.</p>', 400);

  // Token exchange
  const issuer = await getIssuerURL();
  const redirectUri = `${issuer}/sso/github/callback`;
  let tokenResponse: any = null;
  try {
    const form = new URLSearchParams();
    form.set('client_id', provider.clientId);
    form.set('client_secret', provider.clientSecret);
    form.set('code', code);
    form.set('redirect_uri', redirectUri);
    // If the start used PKCE, include verifier; GitHub will ignore when client_secret is present
    form.set('code_verifier', us.codeVerifier);
    const resp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    tokenResponse = await resp.json();
    if (!resp.ok) {
      const msg = tokenResponse && (tokenResponse.error_description || tokenResponse.error)
        ? String(tokenResponse.error_description || tokenResponse.error)
        : 'token exchange failed';
      return html(`<h1>GitHub sign-in failed</h1><p>${escapeHtml(msg)}</p>`, 400);
    }
  } catch (e: any) {
    return html('<h1>GitHub sign-in failed</h1><p>Network error during token exchange.</p>', 400);
  }

  const at = String(tokenResponse.access_token || '');
  if (!at) return html('<h1>GitHub sign-in failed</h1><p>Missing access token.</p>', 400);

  // Fetch user profile
  let ghUser: any = null;
  try {
    const ui = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${at}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    });
    ghUser = await ui.json();
    if (!ui.ok) throw new Error('user fetch failed');
  } catch {
    return html('<h1>GitHub sign-in failed</h1><p>Could not fetch user profile.</p>', 400);
  }

  const sub = ghUser && (ghUser.id != null) ? String(ghUser.id) : '';
  const username = typeof ghUser?.login === 'string' ? String(ghUser.login) : null;
  if (!sub) return html('<h1>GitHub sign-in failed</h1><p>Missing user id.</p>', 400);

  // Determine primary verified email
  let email: string | null = null;
  try {
    const ei = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${at}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    });
    const emails = (await ei.json()) as Array<{ email: string; primary: boolean; verified: boolean; visibility?: string | null }>;
    if (Array.isArray(emails)) {
      const primaryVerified = emails.find((e) => e.primary && e.verified);
      const anyVerified = emails.find((e) => e.verified);
      const chosen = primaryVerified || anyVerified;
      if (chosen && typeof chosen.email === 'string') email = chosen.email.toLowerCase();
    }
  } catch {
    // ignore, fallback below
  }
  if (!email && typeof ghUser?.email === 'string' && ghUser.email) {
    email = String(ghUser.email).toLowerCase();
  }

  if (!email) {
    return html(
      '<h1>GitHub sign-in needs your email</h1>' +
        '<p>We could not determine a verified email address for your GitHub account.</p>' +
        '<p>Please verify your email on GitHub and grant the "user:email" scope, or return to the sign-in page and use a magic link to confirm your email.</p>',
      400,
    );
  }

  // Link or create user
  let user: any = null;
  let linked = false;
  const now = new Date();
  const existingLink = await (prisma as any).externalIdentity.findFirst({ where: { providerId: provider.id, subject: sub } });
  const claims: any = { profile: ghUser };

  // Ensure user exists (race-safe)
  user = await (prisma as any).user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    update: {},
    create: { tenantId: tenant.id, email, name: username },
  });

  // Create or update external identity link (race-safe)
  await (prisma as any).externalIdentity.upsert({
    where: { providerId_subject: { providerId: provider.id, subject: sub } },
    update: { email, claims: claims as any, lastLoginAt: now },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      providerId: provider.id,
      subject: sub,
      email,
      claims: claims as any,
      lastLoginAt: now,
    },
  });
  linked = !existingLink;

  // Audit events
  const ip = (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null) as string | null;
  await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: user.id, action: 'login.sso.github', ip, userAgent: req.headers.get('user-agent') || null } });
  if (linked) {
    await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: user.id, action: 'idp.linked', ip, userAgent: req.headers.get('user-agent') || null } });
  }

  // attach to pending
  await setPendingUser(pending.rid, user.id);

  // Consent handling
  const scopes = scopesFromString(pending.scope);
  let needsConsent = true;
  if (scopes.length === 0) needsConsent = false;
  if (pending.scope && pending.scope.trim() === '') needsConsent = false;
  const client = await (prisma as any).client.findUnique({ where: { id: pending.clientDbId } });
  if (client && client.firstParty) needsConsent = false;
  const existingConsent = await (prisma as any).consent.findUnique({ where: { tenantId_userId_clientId: { tenantId: tenant.id, userId: user.id, clientId: pending.clientDbId } } });
  if (existingConsent) {
    const existingScopes: string[] = (existingConsent.scopes || []) as any;
    const missing = scopes.filter((s) => !existingScopes.includes(s));
    if (missing.length === 0) needsConsent = false;
  }

  if (needsConsent) {
    await publishSSE(pending.rid, 'consentRequired', { rid: pending.rid });
    return html('<h1>Continue on your desktop to grant consent.</h1><p>You can close this page.</p>');
  }

  // Issue code and notify
  const { redirect, handoff } = await issueCodeAndBuildRedirect({ pending: pending as any, userId: user.id });
  await publishSSE(pending.rid, 'loginComplete', { redirect, handoff });
  await completePending(pending.rid);
  return html(`<h1>Signed in</h1><p>You may now return to your original device.</p><p><a href="${redirect}">Continue</a></p>`);
}

async function issueCodeAndBuildRedirect(params: { pending: any; userId: string }) {
  const { pending, userId } = params;
  const code = randomUrlSafe(32);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await (prisma as any).authCode.create({
    data: {
      tenantId: pending.tenantId,
      code,
      clientId: pending.clientDbId,
      userId,
      redirectUri: pending.redirectUri,
      scope: pending.scope,
      expiresAt,
    },
  });
  try {
    const { recordAuthCodeMeta } = await import('@/services/authz');
    recordAuthCodeMeta(code, {
      nonce: pending.nonce,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      authTime: Math.floor(Date.now() / 1000),
    });
  } catch {}
  const qp = serializeParams({ code, state: pending.state });
  const redirect = pending.redirectUri + qp;
  const priv = await getActivePrivateJwk(pending.tenantId);
  let handoff: string | null = null;
  if (priv) {
    try {
      const alg = 'RS256';
      const key = await importJWK(priv as any, alg);
      const issuer = await getIssuerURL();
      handoff = await new SignJWT({ sub: userId, rid: pending.rid, aud: pending.clientId })
        .setProtectedHeader({ alg, kid: (priv as any).kid })
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime('2m')
        .sign(key);
    } catch {
      handoff = null;
    }
  }
  return { redirect, code, handoff };
}

function randomUrlSafe(n: number) {
  const buf = randomBytes(n);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
