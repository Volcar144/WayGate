import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function json(status: number, body: any) { return NextResponse.json(body, { status }); }

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return json(400, { error: 'invalid_request', error_description: 'missing tenant' });
  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return json(404, { error: 'invalid_request', error_description: 'unknown tenant' });

  // Try to parse JSON, fallback to form data
  let payload: any = null;
  try { payload = await req.json(); } catch (e) { Sentry?.captureException?.(e); console.error('Failed to parse JSON payload for logout', e); }
  if (!payload) {
    try {
      const fd = await req.formData();
      payload = Object.fromEntries(Array.from(fd.entries()) as [string, string][]);
    } catch (e) { Sentry?.captureException?.(e); console.error('Failed to parse form data payload for logout', e); }
  }

  const refreshToken = payload?.refresh_token as string | undefined;
  const sessionId = payload?.session_id as string | undefined;

  if (!refreshToken && !sessionId) return json(400, { error: 'invalid_request', error_description: 'refresh_token or session_id required' });

  try {
    let sid: string | null = null;
    if (sessionId) {
      const session = await (prisma as any).session.findUnique({ where: { id: sessionId } });
      if (!session || session.tenantId !== tenant.id) return json(400, { error: 'invalid_request', error_description: 'invalid session' });
      sid = session.id;
    } else if (refreshToken) {
      const rt = await (prisma as any).refreshToken.findUnique({ where: { token: refreshToken } });
      if (!rt || rt.tenantId !== tenant.id) return json(400, { error: 'invalid_request', error_description: 'invalid refresh_token' });
      sid = rt.sessionId;
    }

    if (!sid) return json(400, { error: 'invalid_request' });

    await (prisma as any).refreshToken.updateMany({ where: { sessionId: sid }, data: { revoked: true } });
    await (prisma as any).session.update({ where: { id: sid }, data: { expiresAt: new Date() } }).catch(() => {});

    await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: 'session.logout', ip: (req.ip as any) || null, userAgent: req.headers.get('user-agent') || null } });

    return json(200, { ok: true });
  } catch (e) {
    Sentry?.captureException?.(e, {
      tags: { tenant: tenantSlug },
      extra: { hasRefreshToken: !!refreshToken, hasSessionId: !!sessionId },
    } as any);
    return json(500, { error: 'server_error' });
  }
}
