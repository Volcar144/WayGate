import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { completePending, getPending, scopesFromString, serializeParams } from '@/services/authz';
import { prisma } from '@/lib/prisma';
import { findTenantBySlug, getActivePrivateJwk } from '@/services/jwks';
import { SignJWT, importJWK } from 'jose';
import { getIssuerURL } from '@/utils/issuer';
import { randomBytes } from 'node:crypto';

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });
  const form = await req.formData();
  const rid = String(form.get('rid') || '');
  const deny = form.get('deny') ? true : false;
  const remember = form.get('remember') ? true : false;

  const pending = getPending(rid);
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
    await (prisma as any).audit.create({ data: { tenantId: pending.tenantId, userId: pending.userId, action: 'consent.granted', ip: req.ip || null, userAgent: req.headers.get('user-agent') || null } });
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

  const redirect = pending.redirectUri + serializeParams({ code, state: pending.state });

  // Optional signed handoff token
  const priv = await getActivePrivateJwk(pending.tenantId);
  if (priv) {
    try {
      const key = await importJWK(priv as any, 'RS256');
      const issuer = getIssuerURL();
      await new SignJWT({ sub: pending.userId, rid: pending.rid, aud: pending.clientId })
        .setProtectedHeader({ alg: 'RS256', kid: (priv as any).kid })
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime('2m')
        .sign(key);
    } catch {}
  }

  completePending(rid);
  return NextResponse.json({ redirect });
}

function randomUrlSafe(n: number) {
  const buf = randomBytes(n);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
