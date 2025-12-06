import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { getFlowDashboard, createPrompt } from '@/services/flows';
import { z } from 'zod';

const PromptSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional().nullable(),
  schema: z.record(z.any()),
  timeoutSec: z.number().int().min(15).max(900).optional().nullable(),
});

export async function GET() {
  try {
    const tenant = await requireTenant();
    const dashboard = await getFlowDashboard(tenant.id);
    return NextResponse.json({ prompts: dashboard.prompts });
  } catch (error) {
    console.error('Failed to load prompts', error);
    return NextResponse.json({ error: 'Failed to load prompts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const body = await req.json();
    const parsed = PromptSchema.parse(body);
    const prompt = await createPrompt(tenant.id, {
      title: parsed.title,
      description: parsed.description ?? null,
      schema: parsed.schema as any,
      timeoutSec: parsed.timeoutSec ?? undefined,
    });
    return NextResponse.json({ prompt }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.flatten() }, { status: 400 });
    }
    console.error('Failed to create prompt', error);
    return NextResponse.json({ error: 'Failed to create prompt' }, { status: 500 });
  }
}
