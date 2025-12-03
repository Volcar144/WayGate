import { NextRequest } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return new Response('forbidden', { status: 403 });
  const tenantSlug = getTenant();
  if (!tenantSlug) return new Response('missing tenant', { status: 400 });
  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return new Response('unknown tenant', { status: 404 });

  const url = new URL(req.url);
  const format = (url.searchParams.get('format') || 'json').toLowerCase();
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limitParam = url.searchParams.get('limit');
  let take = 10000;
  if (limitParam) {
    const n = parseInt(limitParam, 10);
    if (!Number.isNaN(n)) take = Math.min(Math.max(1, n), 100000);
  }
  const where: any = { tenantId: tenant.id };
  if (from) where.createdAt = { ...(where.createdAt || {}), gte: new Date(from) };
  if (to) where.createdAt = { ...(where.createdAt || {}), lte: new Date(to) };

  const rows = (await (prisma as any).audit.findMany({ where, orderBy: { id: 'asc' }, take })) as any[];

  if (format === 'csv') {
    const header = 'id,tenantId,userId,action,ip,userAgent,createdAt\n';
    const lines = rows.map((r) => [r.id, r.tenantId, r.userId || '', r.action, r.ip || '', (r.userAgent || '').replaceAll('\n', ' '), r.createdAt.toISOString()].join(','));
    const csv = header + lines.join('\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="audit.csv"' } });
  }

  return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
