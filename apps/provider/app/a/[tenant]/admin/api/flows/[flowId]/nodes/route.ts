import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { createFlowNode } from '@/services/flows';
import { z } from 'zod';

type RouteParams = { params: { flowId: string } };

const CreateNodeSchema = z.object({
  type: z.enum(['begin','read_signals','check_captcha','prompt_ui','metadata_write','require_reauth','branch','webhook','api_request','finish']),
  config: z.record(z.any()).optional(),
  uiPromptId: z.string().uuid().optional().nullable(),
});

export async function POST(req: NextRequest, context: { params: Promise<{ flowId: string }> }) {
  try {
    const params = await context.params;
    const tenant = await requireTenant();
    const body = await req.json();
    const parsed = CreateNodeSchema.parse(body);
    const flow = await createFlowNode(tenant.id, params.flowId, {
      type: parsed.type,
      config: parsed.config ?? {},
      uiPromptId: parsed.uiPromptId ?? null,
    });
    return NextResponse.json({ flow }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.flatten() }, { status: 400 });
    }
    console.error('Failed to create flow node', error);
    return NextResponse.json({ error: 'Failed to create flow node' }, { status: 500 });
  }
}
