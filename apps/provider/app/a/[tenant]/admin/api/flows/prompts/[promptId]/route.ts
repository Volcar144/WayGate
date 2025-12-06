import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { updatePrompt, deletePrompt } from '@/services/flows';
import { z } from 'zod';

type RouteParams = { params: { promptId: string } };

const UpdatePromptSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().nullable().optional(),
  schema: z.record(z.any()).optional(),
  timeoutSec: z.number().int().min(15).max(900).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const tenant = await requireTenant();
    const body = await req.json();
    const parsed = UpdatePromptSchema.parse(body);
    const prompt = await updatePrompt(tenant.id, params.promptId, parsed);
    return NextResponse.json({ prompt });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.flatten() }, { status: 400 });
    }
    console.error('Failed to update prompt', error);
    return NextResponse.json({ error: 'Failed to update prompt' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const tenant = await requireTenant();
    await deletePrompt(tenant.id, params.promptId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete prompt', error);
    return NextResponse.json({ error: 'Failed to delete prompt' }, { status: 500 });
  }
}
