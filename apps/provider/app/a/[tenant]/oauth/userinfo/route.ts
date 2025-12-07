import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug, getJWKSForTenant } from '@/services/jwks';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { getIssuerURL } from '@/utils/issuer';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function error(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return error(400, 'missing tenant');
  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return error(404, 'unknown tenant');

  const authz = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(authz);
  if (!m) return NextResponse.json({ error: 'invalid_token' }, { status: 401, headers: { 'www-authenticate': 'Bearer error="invalid_token"' } });
  const token = m[1];

  try {
    const jwks = await getJWKSForTenant(tenant.id);
    const JWKS = createLocalJWKSet({ keys: jwks.keys as any });
    const issuer = await getIssuerURL();
    const { payload } = await jwtVerify(token, JWKS, { issuer, algorithms: ['RS256'] });
    const sub = String(payload.sub || '');
    if (!sub) return error(401, 'invalid_token');

    const user = await (prisma as any).user.findUnique({ where: { id: sub } });
    if (!user || user.tenantId !== tenant.id) return error(401, 'invalid_token');

    return NextResponse.json({
      sub: user.id,
      name: user.name || null,
      email: user.email,
      email_verified: false,
    });
  } catch (e) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401, headers: { 'www-authenticate': 'Bearer error="invalid_token"' } });
  }
}
