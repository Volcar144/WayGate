import { NextRequest, NextResponse } from 'next/server';
import { consumeMagicToken, getPending, publishSSE, setPendingUser, completePending, scopesFromString, serializeParams } from '@/services/authz';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug, getActivePrivateJwk } from '@/services/jwks';
import { prisma } from '@/lib/prisma';
import { SignJWT, importJWK } from 'jose';
import { getIssuerURL } from '@/utils/issuer';

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

  const mt = consumeMagicToken(token);
  if (!mt || mt.tenantSlug !== tenantSlug) return html('<h1>Invalid or expired link</h1>', 400);

  const pending = getPending(mt.rid);
  if (!pending) return html('<h1>Your login session has expired. Please try again.</h1>', 400);

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return html('<h1>Unknown tenant</h1>', 400);

  // Find or create user by email
  let user = await (prisma as any).user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: mt.email } } });
  if (!user) {
    user = await (prisma as any).user.create({ data: { tenantId: tenant.id, email: mt.email, name: null } });
  }

  setPendingUser(pending.rid, user.id);

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
  const { redirect, handoff } = await issueCodeAndBuildRedirect({ tenantId: tenant.id, pendingRid: pending.rid, userId: user.id, state: pending.state });
  await publishSSE(pending.rid, 'loginComplete', { redirect, handoff });
  completePending(pending.rid);
  return html(`<h1>Signed in</h1><p>You may now return to your original device.</p><p><a href="${redirect}">Continue</a></p>`);
}

async function issueCodeAndBuildRedirect(params: { tenantId: string; pendingRid: string; userId: string; state: string | null }) {
  // Load pending again
  const pending = getPending(params.pendingRid)!;
  // Create auth code
  const code = randomUrlSafe(32);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await (prisma as any).authCode.create({
    data: {
      tenantId: pending.tenantId,
      code,
      clientId: pending.clientDbId,
      userId: params.userId,
      redirectUri: pending.redirectUri,
      scope: pending.scope,
      expiresAt,
    },
  });

  const qp = serializeParams({ code, state: pending.state });
  const redirect = pending.redirectUri + qp;

  // Signed handoff (JWT) for enchanted link signal
  const priv = await getActivePrivateJwk(params.tenantId);
  let handoff: string | null = null;
  if (priv) {
    try {
      const alg = 'RS256';
      const key = await importJWK(priv as any, alg);
      const issuer = getIssuerURL();
      handoff = await new SignJWT({ sub: params.userId, rid: pending.rid, aud: pending.clientId })
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

import { randomBytes } from 'node:crypto';
function randomUrlSafe(n: number) {
  const buf = randomBytes(n);
  // Base64url encode
  const b64 = buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64;
}
