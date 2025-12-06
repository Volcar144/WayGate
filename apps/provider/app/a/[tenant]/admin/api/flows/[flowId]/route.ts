import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { updateFlow, deleteFlow } from '@/services/flows';
import { z } from 'zod';

const UpdateFlowSchema = z.object({
  name: z.string().min(3).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  trigger: z.enum(['signin', 'signup', 'pre_consent', 'post_consent', 'custom']).optional(),
});

type RouteParams = { params: { flowId: string } };

export async function PATCH(req: NextRequest, context: { params: Promise<{ flowId: string }> }) {
  try {
    const params = await context.params;
    const tenant = await requireTenant();
    const body = await req.json();
    const parsed = UpdateFlowSchema.parse(body);
    const flow = await updateFlow(tenant.id, params.flowId, parsed);
    return NextResponse.json({ flow });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.flatten() }, { status: 400 });
    }
    console.error('Failed to update flow', error);
    return NextResponse.json({ error: 'Failed to update flow' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ flowId: string }> }) {
  try {
    const params = await context.params;
    const tenant = await requireTenant();
    await deleteFlow(tenant.id, params.flowId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete flow', error);
    return NextResponse.json({ error: 'Failed to delete flow' }, { status: 500 });
  }
}
