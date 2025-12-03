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
  const userId: string | undefined = payload?.user_id;

  try {
    if (userId) {
      // Revoke sessions for a specific user
      const sessions = await (prisma as any).session.findMany({ where: { tenantId: tenant.id, userId } });
      const ids = sessions.map((s: any) => s.id);
      if (ids.length > 0) {
        await (prisma as any).refreshToken.updateMany({ where: { sessionId: { in: ids } }, data: { revoked: true } });
        await (prisma as any).session.updateMany({ where: { id: { in: ids } }, data: { expiresAt: new Date() } });
      }
      await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId, action: 'admin.revoke_user_sessions', ip: (req.ip as any) || null, userAgent: req.headers.get('user-agent') || null } });
    } else {
      // Revoke all sessions for tenant
      const sessions = await (prisma as any).session.findMany({ where: { tenantId: tenant.id } });
      const ids = sessions.map((s: any) => s.id);
      if (ids.length > 0) {
        await (prisma as any).refreshToken.updateMany({ where: { sessionId: { in: ids } }, data: { revoked: true } });
        await (prisma as any).session.updateMany({ where: { id: { in: ids } }, data: { expiresAt: new Date() } });
      }
      await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: 'admin.revoke_all_sessions', ip: (req.ip as any) || null, userAgent: req.headers.get('user-agent') || null } });
    }
  } catch (e) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
