import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { updateFlowNode, deleteFlowNode } from '@/services/flows';
import { z } from 'zod';

type RouteParams = { params: { flowId: string; nodeId: string } };

const UpdateNodeSchema = z.object({
  order: z.number().int().optional(),
  config: z.record(z.any()).optional(),
  uiPromptId: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: NextRequest, context: { params: Promise<{ flowId: string; nodeId: string }> }) {
  try {
    const params = await context.params
    const tenant = await requireTenant();
    const body = await req.json();
    const parsed = UpdateNodeSchema.parse(body);
    const flow = await updateFlowNode(tenant.id, params.flowId, params.nodeId, parsed);
    return NextResponse.json({ flow });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.flatten() }, { status: 400 });
    }
    console.error('Failed to update flow node', error);
    return NextResponse.json({ error: 'Failed to update flow node' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ flowId: string; nodeId: string }> }) {
  try {
    const params = await context.params;
    const tenant = await requireTenant();
    const flow = await deleteFlowNode(tenant.id, params.flowId, params.nodeId);
    return NextResponse.json({ flow });
  } catch (error) {
    console.error('Failed to delete flow node', error);
    return NextResponse.json({ error: 'Failed to delete flow node' }, { status: 500 });
  }
}
