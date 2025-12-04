import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/admin';

export const runtime = 'nodejs';

/**
 * Revoke one or all JSON Web Keys (JWKs) for the tenant resolved from the request.
 *
 * If a JSON body with a `kid` field is provided, the key with that `kid` for the tenant is marked `retired`; otherwise all active keys for the tenant are marked `retired`. An audit record is created for the action including tenant id, request IP, and user-agent.
 *
 * @returns `{ ok: true }` on success; on failure the route responds with JSON error objects:
 * - `{ error: 'forbidden' }` with status 403 when the requester is not an admin
 * - `{ error: 'missing tenant' }` with status 400 when no tenant slug is available
 * - `{ error: 'unknown tenant' }` with status 404 when the tenant cannot be found
 * - `{ error: 'server_error' }` with status 500 on internal errors
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });
  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

  let payload: any = {};
  try { payload = await req.json(); } catch {}
  const kid: string | undefined = payload?.kid;

  try {
    const now = new Date();
    if (kid) {
      await (prisma as any).jwkKey.updateMany({ where: { tenantId: tenant.id, kid }, data: { status: 'retired', notAfter: now } });
      await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: 'admin.revoke_key', ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null, userAgent: req.headers.get('user-agent') || null } });
    } else {
      await (prisma as any).jwkKey.updateMany({ where: { tenantId: tenant.id, status: 'active' }, data: { status: 'retired', notAfter: now } });
      await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: 'admin.revoke_all_keys', ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null, userAgent: req.headers.get('user-agent') || null } });
    }
  } catch (e) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}