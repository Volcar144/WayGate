// Re-export the canonical flows package (explicit index to avoid file/folder resolution collision)
export * from './flows/index';
export { startFlowRun, resumeFlow } from './flows/engine';

import { prisma } from '@/lib/prisma';
import type { FlowRequestContext } from './flows/engine';
import { startFlowRun } from './flows/engine';

/**
 * Backwards-compatible thin adapter for callers that still import
 * `FlowExecutionService` from `@/services/flows`.
 */
export class FlowExecutionService {
  static async executeFlow(
    tenantId: string,
    trigger: string,
    context: Record<string, any> = {},
    userId?: string,
  ): Promise<void> {
    try {
      // Resolve tenant slug for engine keys
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
      const tenantSlug = tenant?.slug ?? tenantId;

      const uid = userId ?? context.userId;
      const email = context.email ?? undefined;
      const name = context.name ?? undefined;

      const user = {
        id: uid ?? `anon_${Date.now()}`,
        email: email ?? `no-reply+${Date.now()}@example.invalid`,
        name: name ?? null,
      };

      const pending = {
        rid: `manual_${Date.now()}`,
        clientId: 'system',
        clientName: 'system',
      } as any;

      // Fire-and-forget the startFlowRun; engine will handle prompts if needed
      startFlowRun({
        tenantId,
        tenantSlug,
        trigger: trigger as any,
        pending,
        user,
        request: (context as FlowRequestContext) ?? {},
      }).catch((err) => console.error('Flow start error:', err));
    } catch (err) {
      console.error('executeFlow adapter error:', err);
    }
  }
}

