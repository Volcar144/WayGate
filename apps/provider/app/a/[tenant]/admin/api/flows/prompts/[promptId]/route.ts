import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { updatePrompt, deletePrompt } from '@/services/flows';
import { z } from 'zod';

type RouteParams = { params: { promptId: string } };

const PromptSchemaValidator = z.object({
  fields: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        type: z.enum(['text', 'email', 'textarea', 'select', 'number', 'password', 'checkbox', 'radio', 'date', 'tel', 'url', 'file', 'color', 'range', 'time', 'otp', 'multiselect', 'address', 'signature']),
        required: z.boolean().optional(),
        placeholder: z.string().optional(),
        helperText: z.string().optional(),
        options: z
          .array(
            z.object({
              label: z.string(),
              value: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
  actions: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        variant: z.enum(['primary', 'secondary', 'danger']).optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  submitLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
});

const UpdatePromptSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().nullable().optional(),
  schema: PromptSchemaValidator.optional(),
  timeoutSec: z.number().int().min(15).max(900).nullable().optional(),
});

export async function PATCH(req: NextRequest, context: { params: Promise<{ promptId: string }> }) {
  try {
    const params = await context.params;
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

export async function DELETE(_req: NextRequest, context: { params: Promise<{ promptId: string }> }) {
  try {
    const params = await context.params;
    const tenant = await requireTenant();
    await deletePrompt(tenant.id, params.promptId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete prompt', error);
    return NextResponse.json({ error: 'Failed to delete prompt' }, { status: 500 });
  }
}
