import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug, getActivePrivateJwk } from '@/services/jwks';
import { consumeUpstreamState, getGoogleProvider } from '@/services/idp';
import { getPending, publishSSE, setPendingUser, scopesFromString, serializeParams, completePending } from '@/services/authz';
import { prisma } from '@/lib/prisma';
import { getIssuerURL } from '@/utils/issuer';
import { importJWK, SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';

function html(body: string, status = 200) {
  return new NextResponse(`<!doctype html><meta charset="utf-8"/><body style="font-family:system-ui;padding:24px;max-width:720px;margin:0 auto">${body}</body>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

// Verify Google's ID token signatures via JWKS
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return html('<h1>Error</h1><p>missing tenant</p>', 400);

  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description') || undefined;
  const stateParam = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';

  if (error) {
    return html(`<h1>Google sign-in failed</h1><p>${escapeHtml(errorDesc || error)}</p>`, 400);
  }
  if (!stateParam || !code) return html('<h1>Error</h1><p>missing code or state</p>', 400);

  const us = await consumeUpstreamState(stateParam);
  if (!us || us.tenantSlug !== tenantSlug) return html('<h1>Invalid or expired session</h1>', 400);

  const pending = await getPending(us.rid);
  if (!pending || pending.tenantSlug !== tenantSlug) return html('<h1>Your login session has expired. Please try again.</h1>', 400);

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return html('<h1>Unknown tenant</h1>', 400);

  const provider = await getGoogleProvider(tenant.id);
  if (!provider) return html('<h1>Google sign-in not configured</h1><p>Please contact your administrator.</p>', 400);

  // Token exchange
  const issuer = getIssuerURL();
  const redirectUri = `${issuer}/sso/google/callback`;
  let tokenResponse: any = null;
  try {
    const form = new URLSearchParams();
    form.set('grant_type', 'authorization_code');
    form.set('code', code);
    form.set('client_id', provider.clientId);
    form.set('client_secret', provider.clientSecret);
    form.set('redirect_uri', redirectUri);
    form.set('code_verifier', us.codeVerifier);
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    tokenResponse = await resp.json();
    if (!resp.ok) {
      const msg = tokenResponse && tokenResponse.error_description ? String(tokenResponse.error_description) : 'token exchange failed';
      return html(`<h1>Google sign-in failed</h1><p>${escapeHtml(msg)}</p>`, 400);
    }
  } catch (e: any) {
    return html('<h1>Google sign-in failed</h1><p>Network error during token exchange.</p>', 400);
  }

  const idToken = String(tokenResponse.id_token || '');
  const at = String(tokenResponse.access_token || '');
  let claims: any;
  try {
    const verified = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: provider.clientId,
    });
    claims = verified.payload;
  } catch (e) {
    return html('<h1>Google sign-in failed</h1><p>Invalid ID token</p>', 400);
  }

  // Additional validation: nonce binding
  if (claims.nonce !== us.nonce) return html('<h1>Google sign-in failed</h1><p>Invalid nonce</p>', 400);

  const sub = String(claims.sub || '');
  if (!sub) return html('<h1>Google sign-in failed</h1><p>Missing subject</p>', 400);

  // Attempt to get email
  let email: string | null = null;
  if (typeof claims.email === 'string') email = String(claims.email).toLowerCase();
  const emailVerified = !!claims.email_verified;

  if (!email || !emailVerified) {
    // Fallback to userinfo
    if (at) {
      try {
        const ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${at}` },
        });
        const userinfo = await ui.json();
        if (userinfo && typeof userinfo.email === 'string') {
          email = String(userinfo.email).toLowerCase();
        }
      } catch {
        // ignore
      }
    }
  }

  if (!email) {
    return html('<h1>Google sign-in failed</h1><p>Could not determine email address.</p>', 400);
  }

  // Link or create user
  let user: any = null;
  let linked = false;
  const now = new Date();
  const existingLink = await (prisma as any).externalIdentity.findFirst({ where: { providerId: provider.id, subject: sub } });
  if (existingLink) {
    user = await (prisma as any).user.findUnique({ where: { id: existingLink.userId } });
    // update link
    await (prisma as any).externalIdentity.update({
      where: { id: existingLink.id },
      data: { email, claims: claims as any, lastLoginAt: now },
    });
  } else {
    // find user by email
    user = await (prisma as any).user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } });
    if (!user) {
      user = await (prisma as any).user.create({ data: { tenantId: tenant.id, email, name: null } });
    }
    // create link
    await (prisma as any).externalIdentity.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        providerId: provider.id,
        subject: sub,
        email,
        claims: claims as any,
        lastLoginAt: now,
      },
    });
    linked = true;
  }

  // Audit events
  await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: user.id, action: 'login.sso.google', ip: req.ip || null, userAgent: req.headers.get('user-agent') || null } });
  if (linked) {
    await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: user.id, action: 'idp.linked', ip: req.ip || null, userAgent: req.headers.get('user-agent') || null } });
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
      const issuer = getIssuerURL();
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

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
