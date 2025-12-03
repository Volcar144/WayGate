import { NextRequest, NextResponse } from 'next/server';
import { consumeMagicToken, getPending, publishSSE, setPendingUser, completePending, scopesFromString, serializeParams } from '@/services/authz';
import type { PendingAuthRequest } from '@/services/authz';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug, getActivePrivateJwk } from '@/services/jwks';
import { prisma } from '@/lib/prisma';
import { SignJWT, importJWK } from 'jose';
import { getIssuerURL } from '@/utils/issuer';
import { randomBytes } from 'node:crypto';

function html(body: string, status = 200) {
  return new NextResponse(`<!doctype html><meta charset="utf-8"/><body style="font-family:system-ui;padding:24px;max-width:720px;margin:0 auto">${body}</body>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return html('<h1>Error</h1><p>missing tenant</p>', 400);
  const token = req.nextUrl.searchParams.get('token') || '';

  const mt = await consumeMagicToken(token);
  if (!mt || mt.tenantSlug !== tenantSlug) return html('<h1>Invalid or expired link</h1>', 400);

  const pending = await getPending(mt.rid);
  if (!pending) return html('<h1>Your login session has expired. Please try again.</h1>', 400);

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return html('<h1>Unknown tenant</h1>', 400);

  // Find or create user by email
  let user = await (prisma as any).user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: mt.email } } });
  if (!user) {
    user = await (prisma as any).user.create({ data: { tenantId: tenant.id, email: mt.email, name: null } });
  }

  await setPendingUser(pending.rid, user.id);

  // audit login
  await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: user.id, action: 'login.magic', ip: req.ip || null, userAgent: req.headers.get('user-agent') || null } });

  // Determine if consent required
  const scopes = scopesFromString(pending.scope);
  let needsConsent = true;
  if (scopes.length === 0) needsConsent = false; // no op
  if (pending.scope && pending.scope.trim() === '') needsConsent = false;

  // First-party clients implicitly skip consent
  // Load client info to check firstParty
  const client = await (prisma as any).client.findUnique({ where: { id: pending.clientDbId } });
  if (client && client.firstParty) {
    needsConsent = false;
  }

  // If consent stored and covers all scopes, skip
  const existing = await (prisma as any).consent.findUnique({ where: { tenantId_userId_clientId: { tenantId: tenant.id, userId: user.id, clientId: pending.clientDbId } } });
  if (existing) {
    const existingScopes: string[] = (existing.scopes || []) as any;
    const missing = scopes.filter((s) => !existingScopes.includes(s));
    if (missing.length === 0) needsConsent = false;
  }

  if (needsConsent) {
    await publishSSE(pending.rid, 'consentRequired', { rid: pending.rid });
    return html('<h1>Continue on your desktop to grant consent.</h1><p>You can close this page.</p>');
  }

  // Issue code and publish handoff
  const { redirect, handoff } = await issueCodeAndBuildRedirect({ pending, userId: user.id });
  await publishSSE(pending.rid, 'loginComplete', { redirect, handoff });
  await completePending(pending.rid);
  return html(`<h1>Signed in</h1><p>You may now return to your original device.</p><p><a href="${redirect}">Continue</a></p>`);
}

/**
 * Generate an authorization code, persist it with metadata, construct the redirect URL for the client, and optionally produce a short-lived signed handoff token.
 *
 * @param params - Function input
 * @param params.pending - Pending authentication request containing tenant, client, redirect URI, scope, PKCE/nonce and state values
 * @param params.userId - ID of the authenticated user for whom the code is issued
 * @returns An object with:
 *  - `redirect`: the client's redirect URI with the authorization `code` and `state` query parameters appended,
 *  - `code`: the issued authorization code (expires in 5 minutes),
 *  - `handoff`: a signed JWT for handoff when a tenant private key is available (expires in ~2 minutes) or `null` if not created
 */
async function issueCodeAndBuildRedirect(params: { pending: PendingAuthRequest; userId: string }) {
  const { pending, userId } = params;
  // Create auth code
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
  // Record code metadata for PKCE + nonce handling
  try {
    const { recordAuthCodeMeta } = await import('@/services/authz');
    recordAuthCodeMeta(code, {
      nonce: pending.nonce,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      authTime: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {}
    console.error('Failed to record auth code metadata', e);
  }

  const qp = serializeParams({ code, state: pending.state });
  const redirect = pending.redirectUri + qp;

  // Signed handoff (JWT) for enchanted link signal
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
    } catch (e) {
      try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {}
      console.error('Failed to sign handoff token', e);
      handoff = null;
    }
  }

  return { redirect, code, handoff };
}

function randomUrlSafe(n: number) {
  const buf = randomBytes(n);
  // Base64url encode
  const b64 = buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64;
}