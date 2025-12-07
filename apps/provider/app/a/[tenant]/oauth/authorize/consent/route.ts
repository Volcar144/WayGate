import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { completePending, getPending, scopesFromString, serializeParams, publishSSE } from '@/services/authz';
import { prisma } from '@/lib/prisma';
import { findTenantBySlug, getActivePrivateJwk } from '@/services/jwks';
import { SignJWT, importJWK } from 'jose';
import { getIssuerURL } from '@/utils/issuer';
import { randomBytes } from 'node:crypto';

/**
 * Handle an OAuth/OpenID Connect authorization completion by issuing an authorization code, optionally persisting user consent, producing an optional signed handoff token, and notifying listeners of the resulting redirect.
 *
 * The handler expects form fields `rid`, `deny`, and `remember`. It validates the pending request, may record consent when requested, creates a short-lived authorization code (and associated PKCE/nonce metadata), optionally signs a short-lived handoff JWT if a tenant private key is available, publishes a Server-Sent Event (`loginComplete`) with the redirect (and handoff), finalizes the pending request, and returns the redirect URL.
 *
 * @param req - The incoming NextRequest containing form data and client metadata (IP, user-agent)
 * @returns On success, an object `{ redirect: string }` containing the redirect URI with the issued `code` and original `state`. On failure, an object `{ error: string }` is returned with HTTP 400 status describing the error (e.g., `missing tenant`, `expired_request`, `login_required`, `unknown tenant`, or `access_denied`).
 */
export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });
  const form = await req.formData();
  const rid = String(form.get('rid') || '');
  const deny = form.get('deny') ? true : false;
  const remember = form.get('remember') ? true : false;

  const pending = await getPending(rid);
  if (!pending) return NextResponse.json({ error: 'expired_request' }, { status: 400 });
  if (!pending.userId) return NextResponse.json({ error: 'login_required' }, { status: 400 });

  if (deny) {
    const redirect = pending.redirectUri + serializeParams({ error: 'access_denied', state: pending.state });
    completePending(rid);
    return NextResponse.json({ redirect }, { status: 400 });
  }

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 400 });

  const scopes = scopesFromString(pending.scope);
  if (remember && scopes.length > 0) {
    // Upsert consent
    await (prisma as any).consent.upsert({
      where: { tenantId_userId_clientId: { tenantId: pending.tenantId, userId: pending.userId, clientId: pending.clientDbId } },
      update: { scopes },
      create: { tenantId: pending.tenantId, userId: pending.userId, clientId: pending.clientDbId, scopes },
    });
    const consentIp = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown') as string | null;
    await (prisma as any).audit.create({ data: { tenantId: pending.tenantId, userId: pending.userId, action: 'consent.granted', ip: consentIp || null, userAgent: req.headers.get('user-agent') || null } });
  }

  // Issue code
  const code = randomUrlSafe(32);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await (prisma as any).authCode.create({
    data: {
      tenantId: pending.tenantId,
      code,
      clientId: pending.clientDbId,
      userId: pending.userId,
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

  const redirect = pending.redirectUri + serializeParams({ code, state: pending.state });

  // Optional signed handoff token and SSE notify for enchanted flow
  let handoff: string | null = null;
  const priv = await getActivePrivateJwk(pending.tenantId);
  if (priv) {
    try {
      const key = await importJWK(priv as any, 'RS256');
      const issuer = await getIssuerURL();
      handoff = await new SignJWT({ sub: pending.userId, rid: pending.rid, aud: pending.clientId })
        .setProtectedHeader({ alg: 'RS256', kid: (priv as any).kid })
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime('2m')
        .sign(key);
    } catch {
      handoff = null;
    }
  }

  // Notify any listeners (desktop tab) that login is complete
  await publishSSE(pending.rid, 'loginComplete', { redirect, handoff });

  await completePending(rid);
  return NextResponse.json({ redirect });
}

function randomUrlSafe(n: number) {
  const buf = randomBytes(n);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}