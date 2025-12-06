import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { getFlowDashboard, createFlow } from '@/services/flows';
import { z } from 'zod';

const CreateFlowSchema = z.object({
  name: z.string().min(3),
  trigger: z.enum(['signin', 'signup', 'pre_consent', 'post_consent', 'custom']),
});

export async function GET() {
  try {
    const tenant = await requireTenant();
    const dashboard = await getFlowDashboard(tenant.id);
    return NextResponse.json(dashboard);
  } catch (error) {
    console.error('Failed to load flows dashboard', error);
    return NextResponse.json({ error: 'Failed to load flows dashboard' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const body = await req.json();
    const parsed = CreateFlowSchema.parse(body);
    const flow = await createFlow(tenant.id, parsed);
    return NextResponse.json({ flow }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.flatten() }, { status: 400 });
    }
    console.error('Failed to create flow', error);
    return NextResponse.json({ error: 'Failed to create flow' }, { status: 500 });
  }
}
