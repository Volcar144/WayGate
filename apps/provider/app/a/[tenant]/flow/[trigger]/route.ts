import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { startFlowRun } from '@/services/flows';

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { trigger } = (req.nextUrl.searchParams && { trigger: req.nextUrl.searchParams.get('trigger') }) || {};
    // The filename param [trigger] is available via dynamic route, but Next's route handler doesn't expose it directly here; use the pathname as fallback.
    // Prefer body.trigger if provided.
    const body = await req.json().catch(() => ({}));
    const flowTrigger = (body.trigger as any) || trigger || (req.nextUrl.pathname.split('/').pop() as string) || 'custom';

    const pending = body.pending ?? { rid: `manual_${Date.now()}`, clientId: 'system', clientName: 'system' };
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;
    const request = body.request ?? { ip, userAgent: req.headers.get('user-agent') ?? null };
    const user = body.user ?? { id: body.userId ?? body.user?.id ?? `anon_${Date.now()}`, email: body.email ?? undefined, name: body.name ?? null };

    const result = await startFlowRun({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      trigger: flowTrigger as any,
      pending,
      user,
      request,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('Flow trigger failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Flow trigger failed' }, { status: 500 });
  }
}
