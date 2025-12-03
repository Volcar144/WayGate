import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/admin';

export const runtime = 'nodejs';

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
      await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: 'admin.revoke_key', ip: (req.ip as any) || null, userAgent: req.headers.get('user-agent') || null } });
    } else {
      await (prisma as any).jwkKey.updateMany({ where: { tenantId: tenant.id, status: 'active' }, data: { status: 'retired', notAfter: now } });
      await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: 'admin.revoke_all_keys', ip: (req.ip as any) || null, userAgent: req.headers.get('user-agent') || null } });
    }
  } catch (e) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
