import { prisma } from '@/lib/prisma';
import type {
  FlowDashboardResponse,
  FlowDto,
  FlowNodeDto,
  FlowNodeType,
  FlowRunDto,
  FlowRunStatus,
  FlowTrigger,
  UiPromptDto,
  PromptSchema,
  FlowEventType,
  FlowStatus,
} from '@/types/flows';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

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

const FlowInputSchema = z.object({
  name: z.string().min(3),
  trigger: z.enum(['signin', 'signup', 'pre_consent', 'post_consent', 'custom']),
});

type FlowIncludeNodes = Prisma.FlowGetPayload<{
  include: {
    nodes: {
      include: { uiPrompt: true };
      orderBy: { order: 'asc' };
    };
  };
}>;

export async function getFlowDashboard(tenantId: string): Promise<FlowDashboardResponse> {
  const [flows, prompts, runs] = await Promise.all([
    prisma.flow.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      include: {
        nodes: {
          include: { uiPrompt: true },
          orderBy: { order: 'asc' },
        },
      },
    }),
    prisma.uiPrompt.findMany({ where: { tenantId }, orderBy: { updatedAt: 'desc' } }),
    prisma.flowRun.findMany({
      where: { tenantId },
      orderBy: { startedAt: 'desc' },
      take: 15,
      include: {
        flow: {
          select: { id: true, name: true, trigger: true },
        },
        user: {
          select: { id: true, email: true, name: true },
        },
        events: {
          orderBy: { timestamp: 'asc' },
          take: 10,
          include: { node: { select: { id: true, type: true, order: true } } },
        },
      },
    }),
  ]);

  const enabledFlows = flows.filter((flow) => flow.status === 'enabled').length;
  const recentFailedRuns = runs.filter((run) => run.status === 'failed').length;
  const lastRunAt = runs[0]?.startedAt?.toISOString() ?? null;

  return {
    flows: flows.map(mapFlow),
    prompts: prompts.map(mapPrompt),
    runs: runs.map(mapRun),
    stats: {
      totalFlows: flows.length,
      enabledFlows,
      recentFailedRuns,
      lastRunAt,
    },
  };
}

export async function createFlow(tenantId: string, input: { name: string; trigger: FlowTrigger }): Promise<FlowDto> {
  const parsed = FlowInputSchema.parse(input);
  const flow = await prisma.flow.create({
    data: {
      tenantId,
      name: parsed.name,
      trigger: parsed.trigger,
      status: 'disabled',
    },
    include: {
      nodes: {
        include: { uiPrompt: true },
        orderBy: { order: 'asc' },
      },
    },
  });
  return mapFlow(flow);
}

export async function updateFlow(
  tenantId: string,
  flowId: string,
  updates: Partial<{ name: string; status: 'enabled' | 'disabled'; trigger: FlowTrigger }>,
): Promise<FlowDto> {
  await ensureFlowOwnership(tenantId, flowId);
  const flow = await prisma.flow.update({
    where: { id: flowId },
    data: {
      ...(updates.name ? { name: updates.name } : {}),
      ...(updates.status ? { status: updates.status } : {}),
      ...(updates.trigger ? { trigger: updates.trigger } : {}),
      version: { increment: 1 },
    },
    include: {
      nodes: {
        include: { uiPrompt: true },
        orderBy: { order: 'asc' },
      },
    },
  });
  return mapFlow(flow);
}

export async function deleteFlow(tenantId: string, flowId: string): Promise<void> {
  await ensureFlowOwnership(tenantId, flowId);
  await prisma.flow.delete({ where: { id: flowId } });
}

export async function createFlowNode(
  tenantId: string,
  flowId: string,
  input: { type: FlowNodeType; config?: Record<string, any>; uiPromptId?: string | null },
): Promise<FlowDto> {
  const flow = await ensureFlowOwnership(tenantId, flowId);
  const maxOrder = await prisma.flowNode.aggregate({
    where: { flowId },
    _max: { order: true },
  });
  await prisma.flowNode.create({
    data: {
      tenantId,
      flowId,
      type: input.type,
      config: input.config ?? {},
      order: (maxOrder._max.order ?? 0) + 1,
      uiPromptId: input.uiPromptId ?? null,
    },
  });
  await prisma.flow.update({ where: { id: flowId }, data: { version: { increment: 1 } } });
  const updated = await fetchFlowWithNodes(flowId);
  return mapFlow(updated);
}

export async function updateFlowNode(
  tenantId: string,
  flowId: string,
  nodeId: string,
  updates: Partial<{ order: number; config: Record<string, any>; uiPromptId: string | null }>,
): Promise<FlowDto> {
  await ensureFlowOwnership(tenantId, flowId);
  await prisma.flowNode.update({
    where: { id: nodeId, tenantId, flowId },
    data: {
      ...(typeof updates.order === 'number' ? { order: updates.order } : {}),
      ...(updates.config ? { config: updates.config } : {}),
      uiPromptId: updates.uiPromptId === undefined ? undefined : updates.uiPromptId,
    },
  });
  await prisma.flow.update({ where: { id: flowId }, data: { version: { increment: 1 } } });
  const updated = await fetchFlowWithNodes(flowId);
  return mapFlow(updated);
}

export async function deleteFlowNode(tenantId: string, flowId: string, nodeId: string): Promise<FlowDto> {
  await ensureFlowOwnership(tenantId, flowId);
  await prisma.flowNode.delete({ where: { id: nodeId, tenantId } });
  await prisma.flow.update({ where: { id: flowId }, data: { version: { increment: 1 } } });
  const updated = await fetchFlowWithNodes(flowId);
  return mapFlow(updated);
}

export async function createPrompt(
  tenantId: string,
  input: { title: string; description?: string | null; schema: PromptSchema; timeoutSec?: number | null },
): Promise<UiPromptDto> {
  const schema = PromptSchemaValidator.parse(input.schema ?? {});
  const prompt = await prisma.uiPrompt.create({
    data: {
      tenantId,
      title: input.title,
      description: input.description ?? null,
      schema,
      timeoutSec: input.timeoutSec ?? 120,
    },
  });
  return mapPrompt(prompt);
}

export async function updatePrompt(
  tenantId: string,
  promptId: string,
  updates: Partial<{ title: string; description?: string | null; schema: PromptSchema; timeoutSec?: number | null }>,
): Promise<UiPromptDto> {
  const schema = updates.schema ? PromptSchemaValidator.parse(updates.schema) : undefined;
  const prompt = await prisma.uiPrompt.update({
    where: { id: promptId, tenantId },
    data: {
      ...(updates.title ? { title: updates.title } : {}),
      description: updates.description === undefined ? undefined : updates.description,
      ...(schema ? { schema } : {}),
      timeoutSec: updates.timeoutSec === undefined ? undefined : updates.timeoutSec,
    },
  });
  return mapPrompt(prompt);
}

export async function deletePrompt(tenantId: string, promptId: string): Promise<void> {
  await prisma.uiPrompt.delete({ where: { id: promptId, tenantId } });
}

async function ensureFlowOwnership(tenantId: string, flowId: string): Promise<FlowIncludeNodes> {
  const flow = await prisma.flow.findFirst({
    where: { id: flowId, tenantId },
    include: {
      nodes: {
        include: { uiPrompt: true },
        orderBy: { order: 'asc' },
      },
    },
  });
  if (!flow) {
    throw new Error('flow_not_found');
  }
  return flow;
}

async function fetchFlowWithNodes(flowId: string): Promise<FlowIncludeNodes> {
  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    include: {
      nodes: {
        include: { uiPrompt: true },
        orderBy: { order: 'asc' },
      },
    },
  });
  if (!flow) {
    throw new Error('flow_not_found');
  }
  return flow;
}

function mapFlow(flow: FlowIncludeNodes): FlowDto {
  return {
    id: flow.id,
    name: flow.name,
    trigger: flow.trigger as FlowTrigger,
    status: flow.status as FlowStatus,
    version: flow.version,
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
    nodes: flow.nodes?.map(mapNode) ?? [],
  };
}

function mapNode(node: Prisma.FlowNode & { uiPrompt: Prisma.UiPrompt | null }): FlowNodeDto {
  return {
    id: node.id,
    type: node.type as FlowNodeType,
    order: node.order,
    config: (node.config as Record<string, any>) ?? {},
    nextNodeId: node.nextNodeId,
    failureNodeId: node.failureNodeId,
    uiPromptId: node.uiPromptId,
    uiPromptTitle: node.uiPrompt?.title ?? null,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  };
}

function mapPrompt(prompt: Prisma.UiPrompt): UiPromptDto {
  return {
    id: prompt.id,
    title: prompt.title,
    description: prompt.description,
    schema: (prompt.schema as PromptSchema) ?? { fields: [] },
    timeoutSec: prompt.timeoutSec,
    createdAt: prompt.createdAt.toISOString(),
    updatedAt: prompt.updatedAt.toISOString(),
  };
}

function mapRun(run: Prisma.FlowRun & {
  flow: { id: string; name: string; trigger: FlowTrigger };
  user: { id: string; email: string; name: string | null } | null;
  events: (Prisma.FlowEvent & { node: { id: string; type: string | null } | null })[];
}): FlowRunDto {
  return {
    id: run.id,
    flowId: run.flowId,
    flowName: run.flow.name,
    trigger: run.flow.trigger as FlowTrigger,
    status: run.status as FlowRunStatus,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    lastError: run.lastError,
    user: run.user
      ? {
          id: run.user.id,
          email: run.user.email,
          name: run.user.name,
        }
      : null,
    events: run.events.map((event) => ({
      id: event.id,
      nodeId: event.nodeId,
      nodeType: (event.node?.type as FlowNodeType) || undefined,
      type: event.type as FlowEventType,
      timestamp: event.timestamp.toISOString(),
      metadata: (event.metadata as Record<string, any>) ?? null,
    })),
  };
}
