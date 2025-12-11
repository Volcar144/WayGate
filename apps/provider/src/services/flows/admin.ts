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

type FlowWithNodes = Prisma.FlowGetPayload<{
  select: {
    id: true;
    name: true;
    status: true;
    trigger: true;
    version: true;
    nodes: true;
    createdAt: true;
    updatedAt: true;
  };
}>;

export async function getFlowDashboard(tenantId: string): Promise<FlowDashboardResponse> {
  const [flows, prompts, runs] = await Promise.all([
    prisma.flow.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        trigger: true,
        version: true,
        nodes: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.uiPrompt.findMany({ where: { tenantId }, orderBy: { updatedAt: 'desc' } }),
    prisma.flowRun.findMany({
      where: { tenantId },
      orderBy: { startedAt: 'desc' },
      take: 15,
      select: {
        id: true,
        status: true,
        flowId: true,
        userId: true,
        requestRid: true,
        lastError: true,
        startedAt: true,
        finishedAt: true,
        flow: {
          select: { id: true, name: true, trigger: true },
        },
        user: {
          select: { id: true, email: true, name: true },
        },
        events: {
          orderBy: { timestamp: 'asc' },
          take: 10,
          select: { id: true, type: true, timestamp: true, metadata: true },
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
    select: {
      id: true,
      name: true,
      status: true,
      trigger: true,
      version: true,
      nodes: true,
      createdAt: true,
      updatedAt: true,
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
    select: {
      id: true,
      name: true,
      status: true,
      trigger: true,
      version: true,
      nodes: true,
      createdAt: true,
      updatedAt: true,
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
  const nodes = (Array.isArray(flow.nodes) ? flow.nodes : []) as any[];
  const newNode = {
    id: `node_${Date.now()}`,
    type: input.type,
    config: input.config ?? {},
    order: (nodes.length ? Math.max(...nodes.map((n) => n.order ?? 0)) : 0) + 1,
    uiPromptId: input.uiPromptId ?? null,
  };
  nodes.push(newNode);
  const updated = await prisma.flow.update({
    where: { id: flowId },
    data: { nodes: JSON.parse(JSON.stringify(nodes)), version: { increment: 1 } },
    select: {
      id: true,
      name: true,
      status: true,
      trigger: true,
      version: true,
      nodes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return mapFlow(updated);
}

export async function updateFlowNode(
  tenantId: string,
  flowId: string,
  nodeId: string,
  updates: Partial<{ order: number; config: Record<string, any>; uiPromptId: string | null }>,
): Promise<FlowDto> {
  const flow = await ensureFlowOwnership(tenantId, flowId);
  const nodes = (Array.isArray(flow.nodes) ? flow.nodes : []) as any[];
  const idx = nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) throw new Error('Node not found');
  nodes[idx] = { ...nodes[idx], ...updates };
  const updated = await prisma.flow.update({
    where: { id: flowId },
    data: { nodes: JSON.parse(JSON.stringify(nodes)), version: { increment: 1 } },
    select: {
      id: true,
      name: true,
      status: true,
      trigger: true,
      version: true,
      nodes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return mapFlow(updated);
}

export async function deleteFlowNode(tenantId: string, flowId: string, nodeId: string): Promise<FlowDto> {
  const flow = await ensureFlowOwnership(tenantId, flowId);
  const nodes = (Array.isArray(flow.nodes) ? flow.nodes : []) as any[];
  const filtered = nodes.filter((n) => n.id !== nodeId);
  const updated = await prisma.flow.update({
    where: { id: flowId },
    data: { nodes: JSON.parse(JSON.stringify(filtered)), version: { increment: 1 } },
    select: {
      id: true,
      name: true,
      status: true,
      trigger: true,
      version: true,
      nodes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
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

async function ensureFlowOwnership(tenantId: string, flowId: string): Promise<FlowWithNodes> {
  const flow = await prisma.flow.findFirst({
    where: { id: flowId, tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      trigger: true,
      version: true,
      nodes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!flow) {
    throw new Error('flow_not_found');
  }
  return flow;
}

async function fetchFlowWithNodes(flowId: string): Promise<FlowWithNodes> {
  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    select: {
      id: true,
      name: true,
      status: true,
      trigger: true,
      version: true,
      nodes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!flow) {
    throw new Error('flow_not_found');
  }
  return flow;
}

function mapFlow(flow: FlowWithNodes): FlowDto {
  return {
    id: flow.id,
    name: flow.name,
    trigger: flow.trigger,
    status: flow.status,
    version: flow.version,
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
    nodes: (Array.isArray(flow.nodes) ? flow.nodes : []).map((n) => {
      const node = n as any;
      return {
        id: node.id,
        type: node.type as FlowNodeType,
        order: node.order,
        config: node.config ?? {},
        nextNodeId: node.nextNodeId,
        failureNodeId: node.failureNodeId,
        uiPromptId: node.uiPromptId,
        uiPromptTitle: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}

function mapPrompt(prompt: any): UiPromptDto {
  return {
    id: prompt.id,
    title: prompt.title,
    description: prompt.description,
    schema: (prompt.schema as unknown as PromptSchema) ?? { fields: [] },
    timeoutSec: prompt.timeoutSec,
    createdAt: prompt.createdAt.toISOString(),
    updatedAt: prompt.updatedAt.toISOString(),
  };
}

function mapRun(run: any): FlowRunDto {
  return {
    id: run.id,
    flowId: run.flowId,
    flowName: run.flow?.name || 'Unknown',
    trigger: run.flow?.trigger as FlowTrigger,
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
    events: run.events.map((event: any) => ({
      id: event.id,
      nodeId: event.nodeId,
      nodeType: (event.nodeType as FlowNodeType) || undefined,
      type: event.type as FlowEventType,
      timestamp: event.timestamp.toISOString(),
      metadata: (event.metadata as Record<string, any>) ?? null,
    })),
  };
}
