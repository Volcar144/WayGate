import { prisma } from '@/lib/prisma';
import { getTenantRedis } from '@/lib/redis';
import { tenantAuditRepo } from '@/lib/tenant-repo';
import { logger } from '@/utils/logger';
import type { PendingAuthRequest } from '@/services/authz';
import type {
  FlowPromptDescriptor,
  FlowTrigger,
  FlowNodeType,
  PromptSchema,
  FlowPromptVariant,
} from '@/types/flows';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';

export interface FlowRequestContext {
  ip?: string | null;
  userAgent?: string | null;
  headers?: Record<string, string>;
}

export interface FlowContext {
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
  pending: {
    rid: string;
    clientId: string;
    clientName: string;
    scope?: string | null;
  };
  signals?: {
    ip?: string | null;
    userAgent?: string | null;
    geo?: {
      country?: string | null;
      region?: string | null;
      city?: string | null;
    };
    device?: {
      os?: string | null;
      browser?: string | null;
    };
    risk?: {
      score: number;
      reasons?: string[];
    };
  };
  prompts?: Record<string, any>;
  metadata?: Record<string, any>;
  captcha?: {
    provider: string;
    verifiedAt: string;
    remoteIp?: string | null;
    score?: number;
  };
  extras?: Record<string, any>;
}

export interface FlowStartOptions {
  tenantId: string;
  tenantSlug: string;
  trigger: FlowTrigger;
  pending: PendingAuthRequest;
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
  request: FlowRequestContext;
}

export interface FlowPromptSubmission {
  action: string;
  fields: Record<string, string | null>;
}

export interface FlowResumeOptions {
  tenantId: string;
  tenantSlug: string;
  runId: string;
  resumeToken: string;
  submission: FlowPromptSubmission;
  request: FlowRequestContext;
}

export type FlowEngineResult =
  | { type: 'skipped' }
  | { type: 'prompt'; runId: string; prompt: FlowPromptDescriptor; resumeToken: string }
  | { type: 'success'; runId: string; context: FlowContext }
  | { type: 'error'; runId?: string; message: string };

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

type FlowNodeWithPrompt = Prisma.FlowNodeGetPayload<{
  include: { uiPrompt: true };
}>;

type FlowWithNodes = Prisma.FlowGetPayload<{
  include: {
    nodes: {
      include: { uiPrompt: true };
      orderBy: { order: 'asc' };
    };
  };
}>;

type FlowRunRecord = Prisma.FlowRunGetPayload<{
  include: {
    flow: {
      include: {
        nodes: {
          include: { uiPrompt: true };
          orderBy: { order: 'asc' };
        };
      };
    };
  };
}>;

type ResumeTokenState = {
  runId: string;
  nodeId: string;
  issuedAt: number;
};

type FlowMemoryStore = {
  resumeTokens: Map<string, { state: ResumeTokenState; expiresAt: number }>;
  captcha: Map<string, number>;
};

function getMemoryStore(): FlowMemoryStore {
  const g = globalThis as typeof globalThis & { __flowStore?: FlowMemoryStore };
  if (!g.__flowStore) {
    g.__flowStore = {
      resumeTokens: new Map(),
      captcha: new Map(),
    };
  }
  const now = Date.now();
  for (const [token, entry] of g.__flowStore.resumeTokens) {
    if (entry.expiresAt <= now) g.__flowStore.resumeTokens.delete(token);
  }
  for (const [token, expiresAt] of g.__flowStore.captcha) {
    if (expiresAt <= now) g.__flowStore.captcha.delete(token);
  }
  return g.__flowStore;
}

function sanitizeContext(ctx: FlowContext): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(ctx)) as Prisma.InputJsonValue;
}

function parseContext(raw: Prisma.JsonValue | null): FlowContext {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid flow context');
  }
  return raw as unknown as FlowContext;
}

function parsePromptSchema(data: Prisma.JsonValue | null): PromptSchema {
  try {
    return PromptSchemaValidator.parse(data);
  } catch (err) {
    logger.warn('Invalid prompt schema, falling back to empty form', { error: err instanceof Error ? err.message : err });
    return { fields: [] };
  }
}

function buildInitialContext(options: FlowStartOptions): FlowContext {
  return {
    user: {
      id: options.user.id,
      email: options.user.email,
      name: options.user.name ?? null,
    },
    pending: {
      rid: options.pending.rid,
      clientId: options.pending.clientId,
      clientName: options.pending.clientName,
      scope: options.pending.scope ?? null,
    },
    prompts: {},
    metadata: {},
  };
}

function getHeadersLowercase(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {};
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lowered[k.toLowerCase()] = v;
  }
  return lowered;
}

function enhanceSignals(context: FlowContext, request: FlowRequestContext): FlowContext {
  const headers = getHeadersLowercase(request.headers);
  const ua = request.userAgent || headers['user-agent'] || null;
  const ip = request.ip || headers['x-forwarded-for'] || headers['cf-connecting-ip'] || null;
  const country = headers['cf-ipcountry'] || headers['x-vercel-ip-country'] || null;
  const region = headers['x-vercel-ip-region'] || null;
  const city = headers['x-vercel-ip-city'] || null;
  const device = parseDevice(ua);
  const riskScore = deriveRiskScore(ip, device);
  context.signals = {
    ip,
    userAgent: ua,
    geo: { country, region, city },
    device,
    risk: {
      score: riskScore,
      reasons: riskScore > 60 ? ['anomalous_ip'] : undefined,
    },
  };
  return context;
}

function parseDevice(userAgent: string | null): { os?: string | null; browser?: string | null } {
  if (!userAgent) return {};
  const ua = userAgent.toLowerCase();
  let os: string | null = null;
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('iphone')) os = 'iOS';
  else if (ua.includes('android')) os = 'Android';

  let browser: string | null = null;
  if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('safari')) browser = 'Safari';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('edge')) browser = 'Edge';

  return { os, browser };
}

function deriveRiskScore(ip?: string | null, device?: { os?: string | null; browser?: string | null }): number {
  if (!ip) return 50;
  if (ip.startsWith('10.') || ip.startsWith('192.168') || ip.startsWith('127.')) return 5;
  if (device?.browser === 'Firefox') return 25;
  return 40;
}

async function loadActiveFlow(tenantId: string, trigger: FlowTrigger): Promise<FlowWithNodes | null> {
  return prisma.flow.findFirst({
    where: { tenantId, trigger, status: 'enabled' },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    include: {
      nodes: {
        include: { uiPrompt: true },
        orderBy: { order: 'asc' },
      },
    },
  });
}

function selectEntryNode(flow: FlowWithNodes): FlowNodeWithPrompt | null {
  if (!flow.nodes || flow.nodes.length === 0) return null;
  const begin = flow.nodes.find((node) => node.type === 'begin');
  return begin || flow.nodes[0];
}

function nodesMap(flow: FlowWithNodes): Map<string, FlowNodeWithPrompt> {
  const map = new Map<string, FlowNodeWithPrompt>();
  for (const node of flow.nodes) map.set(node.id, node);
  return map;
}

function nextNodeResolver(
  current: FlowNodeWithPrompt,
  flow: FlowWithNodes,
  explicit?: string | null,
): FlowNodeWithPrompt | null {
  const map = nodesMap(flow);
  if (explicit) {
    return map.get(explicit) || null;
  }
  const ordered = flow.nodes || [];
  const idx = ordered.findIndex((n) => n.id === current.id);
  if (idx === -1) return null;
  return ordered[idx + 1] || null;
}

async function recordEvent(
  tenantId: string,
  runId: string,
  nodeId: string | null,
  type: 'enter' | 'exit' | 'prompt' | 'resume' | 'error',
  metadata?: Record<string, any>,
) {
  try {
    await prisma.flowEvent.create({
      data: {
        tenantId,
        flowRunId: runId,
        nodeId,
        type,
        metadata: metadata ? (metadata as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (err) {
    logger.warn('Failed to record flow event', { error: err instanceof Error ? err.message : err });
  }
}

async function issueResumeToken(
  tenantSlug: string,
  data: ResumeTokenState,
  ttlSeconds: number,
): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const redis = getTenantRedis(tenantSlug);
  const payload = JSON.stringify(data);
  try {
    await redis.set(`flow:resume:${token}`, payload, 'EX', Math.max(30, ttlSeconds));
    return token;
  } catch {
    const store = getMemoryStore();
    store.resumeTokens.set(token, { state: data, expiresAt: Date.now() + ttlSeconds * 1000 });
    return token;
  }
}

async function consumeResumeToken(
  tenantSlug: string,
  token: string,
): Promise<ResumeTokenState | null> {
  const redis = getTenantRedis(tenantSlug);
  try {
    const key = `flow:resume:${token}`;
    const raw = await redis.get(key);
    if (raw) {
      await redis.del(key);
      return JSON.parse(raw) as ResumeTokenState;
    }
  } catch {
    // ignore and fall back to memory store
  }
  const store = getMemoryStore();
  const entry = store.resumeTokens.get(token);
  if (!entry) return null;
  store.resumeTokens.delete(token);
  return entry.state;
}

async function guardCaptchaToken(tenantSlug: string, token: string): Promise<void> {
  const hash = createHash('sha256').update(token).digest('hex');
  const redis = getTenantRedis(tenantSlug);
  const key = `flow:captcha:${hash}`;
  try {
    const existing = await redis.get(key);
    if (existing) {
      throw new Error('captcha_token_reused');
    }
    await redis.set(key, '1', 'EX', 600);
    return;
  } catch {
    const store = getMemoryStore();
    if (store.captcha.get(hash)) {
      throw new Error('captcha_token_reused');
    }
    store.captcha.set(hash, Date.now() + 600_000);
  }
}

async function verifyCaptcha(
  cfg: CheckCaptchaConfig,
  token: string,
  remoteIp?: string | null,
): Promise<{ success: boolean; score?: number }> {
  if (cfg.provider === 'turnstile') {
    const form = new URLSearchParams();
    if (cfg.secretKey) form.set('secret', cfg.secretKey);
    form.set('response', token);
    if (typeof remoteIp === 'string') form.set('remoteip', remoteIp);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = (await res.json()) as { success: boolean; score?: number };
    return { success: !!data.success, score: data.score };
  }
  if (cfg.provider === 'hcaptcha') {
    const form = new URLSearchParams();
    if (cfg.secretKey) form.set('secret', cfg.secretKey);
    form.set('response', token);
    if (typeof remoteIp === 'string') form.set('remoteip', remoteIp);
    const res = await fetch('https://hcaptcha.com/siteverify', { method: 'POST', body: form });
    const data = (await res.json()) as { success: boolean; score?: number };
    return { success: !!data.success, score: data.score };
  }
  return { success: true };
}

interface CheckCaptchaConfig {
  provider: 'turnstile' | 'hcaptcha' | 'mock';
  siteKey?: string;
  secretKey?: string;
  minScore?: number;
  timeoutSec?: number;
  storeAs?: string;
}

interface PromptUiConfig {
  promptId?: string;
  storeAs?: string;
  actionRouting?: Record<string, { nextNodeId?: string | null; failure?: boolean }>;
}

interface MetadataWriteConfig {
  namespace: string;
  values: Record<string, unknown>;
}

interface GeolocationCheckConfig {
  namespace?: string;
  key?: string;
  requireSame?: boolean;
  treatMissingAsMismatch?: boolean;
}

function ensurePromptDescriptor(
  flow: FlowWithNodes,
  node: FlowNodeWithPrompt,
  schema: PromptSchema,
  variant: FlowPromptVariant,
  error?: string,
  meta?: Record<string, any>,
): FlowPromptDescriptor {
  return {
    nodeId: node.id,
    nodeType: node.type as FlowNodeType,
    promptId: node.uiPromptId ?? null,
    flowId: flow.id,
    flowName: flow.name,
    flowTrigger: flow.trigger as FlowTrigger,
    title: node.uiPrompt?.title || 'Additional verification required',
    description: node.uiPrompt?.description || undefined,
    schema,
    variant,
    error,
    meta,
  };
}

async function writeUserMetadata(tenantId: string, userId: string, cfg: MetadataWriteConfig) {
  if (!cfg.namespace || !cfg.values) return;
  await prisma.userMetadata.upsert({
    where: {
      tenantId_userId_namespace: {
        tenantId,
        userId,
        namespace: cfg.namespace,
      },
    },
    update: { data: cfg.values as Prisma.InputJsonValue },
    create: {
      tenantId,
      userId,
      namespace: cfg.namespace,
      data: cfg.values as Prisma.InputJsonValue,
    },
  });
}

export async function startFlowRun(options: FlowStartOptions): Promise<FlowEngineResult> {
  const flow = await loadActiveFlow(options.tenantId, options.trigger);
  if (!flow || flow.nodes.length === 0) {
    return { type: 'skipped' };
  }
  const context = buildInitialContext(options);
  // load user's metadata into context so nodes can read previous values
  try {
    const metas = await prisma.userMetadata.findMany({ where: { tenantId: options.tenantId, userId: options.user.id } });
    if (!context.metadata) context.metadata = {};
    for (const m of metas) {
      try {
        context.metadata[m.namespace] = m.data as Record<string, any>;
      } catch {
        context.metadata[m.namespace] = m.data as any;
      }
    }
  } catch (e) {
    // ignore metadata load failures - engine can continue
    logger.warn('Failed to load user metadata for flow start', { error: e instanceof Error ? e.message : e });
  }
  const include = {
    flow: {
      include: {
        nodes: {
          include: { uiPrompt: true },
          orderBy: { order: 'asc' },
        },
      },
    },
  } as const;
  let run: FlowRunRecord | null = null;
  try {
    run = await prisma.flowRun.create({
      data: {
        tenantId: options.tenantId,
        flowId: flow.id,
        userId: options.user.id,
        requestRid: options.pending.rid,
        trigger: options.trigger,
        context: sanitizeContext(context),
      },
      include,
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      run = await prisma.flowRun.findFirst({
        where: { tenantId: options.tenantId, requestRid: options.pending.rid, trigger: options.trigger },
        include,
      });
    } else {
      throw err;
    }
  }

  if (!run) {
    throw new Error('flow_run_init_failed');
  }

  return runLoop({
    tenantSlug: options.tenantSlug,
    request: options.request,
    run,
    context,
    resumeSubmission: undefined,
  });
}

export async function resumeFlow(options: FlowResumeOptions): Promise<FlowEngineResult> {
  const resumeState = await consumeResumeToken(options.tenantSlug, options.resumeToken);
  if (!resumeState || resumeState.runId !== options.runId) {
    return { type: 'error', runId: options.runId, message: 'invalid_resume_token' };
  }
  const run = await prisma.flowRun.findUnique({
    where: { id: options.runId, tenantId: options.tenantId },
    include: {
      flow: {
        include: {
          nodes: {
            include: { uiPrompt: true },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  });
  if (!run) {
    return { type: 'error', runId: options.runId, message: 'flow_run_missing' };
  }
  const context = parseContext(run.context as Prisma.JsonValue);
  return runLoop({
    tenantSlug: options.tenantSlug,
    request: options.request,
    run,
    context,
    resumeSubmission: options.submission,
    resumeNodeId: resumeState.nodeId,
  });
}

interface RunLoopArgs {
  run: FlowRunRecord;
  context: FlowContext;
  tenantSlug: string;
  request: FlowRequestContext;
  resumeSubmission?: FlowPromptSubmission;
  resumeNodeId?: string;
}

async function runLoop(args: RunLoopArgs): Promise<FlowEngineResult> {
  const flow = args.run.flow;
  if (!flow || !flow.nodes.length) {
    return { type: 'success', runId: args.run.id, context: args.context };
  }

  const ordered = flow.nodes;
  const map = nodesMap(flow);
  let current: FlowNodeWithPrompt | null;
  if (args.resumeSubmission) {
    const candidateId = args.resumeNodeId || args.run.currentNodeId || null;
    current = candidateId ? map.get(candidateId) || selectEntryNode(flow) : selectEntryNode(flow);
  } else {
    current = selectEntryNode(flow);
  }
  if (!current) {
    await markRunSuccess(args.run.id, args.context);
    return { type: 'success', runId: args.run.id, context: args.context };
  }

  const maxIterations = ordered.length * 4;
  let steps = 0;
  let resumeHandled = false;
  while (current && steps < maxIterations) {
    steps += 1;
    try {
      const nodeType = String(current.type);
      await recordEvent(args.run.tenantId, args.run.id, current.id, resumeHandled ? 'resume' : 'enter');

      if (nodeType === 'read_signals') {
        enhanceSignals(args.context, args.request);
        await updateRunContext(args.run.id, args.context, current.id);
        await recordEvent(args.run.tenantId, args.run.id, current.id, 'exit');
        current = nextNodeResolver(current, flow);
        continue;
      }

      if (nodeType === 'geolocation_check') {
        // ensure signals populated
        enhanceSignals(args.context, args.request);
        const cfg = sanitizeConfig<GeolocationCheckConfig>(current.config, { namespace: 'default', key: 'last_login_country', requireSame: true, treatMissingAsMismatch: false });
        const namespace = cfg.namespace ?? 'default';
        const key = cfg.key ?? 'last_login_country';
        const currentCountry = args.context.signals?.geo?.country || null;
        const last = args.context.metadata?.[namespace]?.[key] ?? null;
        if (!currentCountry) {
          // cannot determine geo -> continue
          await updateRunContext(args.run.id, args.context, current.id);
          await recordEvent(args.run.tenantId, args.run.id, current.id, 'exit', { reason: 'no_geo' });
          current = nextNodeResolver(current, flow);
          continue;
        }

        // mismatch handling
        const mismatch = last && currentCountry !== last;
        if (mismatch) {
          await recordEvent(args.run.tenantId, args.run.id, current.id, 'exit', { mismatch: true, last, currentCountry });
          // route to failureNodeId if configured, otherwise continue to next
          if (current.failureNodeId) {
            current = nodesMap(flow).get(current.failureNodeId) || null;
          } else {
            current = nextNodeResolver(current, flow);
          }
          // do not overwrite stored metadata here; let metadata_write node persist new value
          continue;
        }

        // no mismatch - update in-memory context so later metadata_write can merge/persist if desired
        if (!args.context.metadata) args.context.metadata = {};
        if (!args.context.metadata[namespace]) args.context.metadata[namespace] = {};
        try {
          (args.context.metadata[namespace] as any)[key as string] = currentCountry;
        } catch {}
        await updateRunContext(args.run.id, args.context, current.id);
        await recordEvent(args.run.tenantId, args.run.id, current.id, 'exit', { mismatch: false, currentCountry });
        current = nextNodeResolver(current, flow);
        continue;
      }

      if (nodeType === 'check_captcha') {
        const result = await handleCaptchaNode(args, flow, current);
        if (result.kind === 'prompt') {
          return promptResult(args.run, flow, current, result.prompt, result.ttlSeconds, args.tenantSlug, args.context);
        }
        if (result.kind === 'failure') {
          await markRunFailure(args.run.id, args.run.tenantId, args.context, result.message);
          return { type: 'error', runId: args.run.id, message: result.message };
        }
        await recordEvent(args.run.tenantId, args.run.id, current.id, 'exit');
        current = nextNodeResolver(current, flow);
        resumeHandled = true;
        continue;
      }

      if (nodeType === 'prompt_ui' || nodeType === 'require_reauth') {
        const result = await handlePromptNode(args, flow, current);
        if (result.kind === 'prompt') {
          return promptResult(args.run, flow, current, result.prompt, result.ttlSeconds, args.tenantSlug, args.context);
        }
        if (result.kind === 'failure') {
          await markRunFailure(args.run.id, args.run.tenantId, args.context, result.message);
          return { type: 'error', runId: args.run.id, message: result.message };
        }
        await recordEvent(args.run.tenantId, args.run.id, current.id, 'exit');
        current = nextNodeResolver(current, flow, result.nextNodeId);
        resumeHandled = true;
        continue;
      }

      if (nodeType === 'metadata_write') {
        const ok = await handleMetadataWriteNode(args, current);
        if (!ok.success) {
          const msg = ok.message ?? 'metadata_write_failed';
          await markRunFailure(args.run.id, args.run.tenantId, args.context, msg);
          return { type: 'error', runId: args.run.id, message: msg };
        }
        await recordEvent(args.run.tenantId, args.run.id, current.id, 'exit');
        current = nextNodeResolver(current, flow);
        continue;
      }

      if (nodeType === 'mfa_challenge') {
        // MFA challenge node: prompt user to choose which MFA method to use
        const schema: PromptSchema = {
          fields: [
            {
              id: 'mfa_method',
              label: 'Choose verification method',
              type: 'radio',
              required: true,
              options: [
                { value: 'totp', label: 'Authenticator app (TOTP)' },
                { value: 'sms', label: 'Text message (SMS)' },
                { value: 'email', label: 'Email code' },
                { value: 'webauthn', label: 'Security key (WebAuthn)' },
              ],
            },
          ],
          actions: [{ id: 'continue', label: 'Continue', variant: 'primary' }],
          submitLabel: 'Verify',
        };
        const descriptor = ensurePromptDescriptor(flow, current, schema, 'default', undefined, {
          mfaMethods: ['totp', 'sms', 'email', 'webauthn'],
        });
        return promptResult(args.run, flow, current, descriptor, 600, args.tenantSlug, args.context);
      }

      if (nodeType === 'mfa_totp_verify') {
        // TOTP verification: prompt for 6-digit code from authenticator app
        const schema: PromptSchema = {
          fields: [
            {
              id: 'totp_code',
              label: 'Enter 6-digit code from your authenticator',
              type: 'otp',
              required: true,
              placeholder: '000000',
            },
          ],
          submitLabel: 'Verify',
        };
        const descriptor = ensurePromptDescriptor(flow, current, schema, 'default', undefined, {
          mfaMethod: 'totp',
        });
        return promptResult(args.run, flow, current, descriptor, 300, args.tenantSlug, args.context);
      }

      if (nodeType === 'mfa_sms_verify') {
        // SMS verification: prompt for code sent via SMS
        const schema: PromptSchema = {
          fields: [
            {
              id: 'sms_code',
              label: 'Enter code sent to your phone',
              type: 'otp',
              required: true,
              placeholder: '000000',
            },
          ],
          submitLabel: 'Verify',
        };
        const descriptor = ensurePromptDescriptor(flow, current, schema, 'default', undefined, {
          mfaMethod: 'sms',
        });
        return promptResult(args.run, flow, current, descriptor, 600, args.tenantSlug, args.context);
      }

      if (nodeType === 'mfa_email_verify') {
        // Email verification: prompt for code sent via email
        const schema: PromptSchema = {
          fields: [
            {
              id: 'email_code',
              label: 'Enter code sent to your email',
              type: 'otp',
              required: true,
              placeholder: '000000',
            },
          ],
          submitLabel: 'Verify',
        };
        const descriptor = ensurePromptDescriptor(flow, current, schema, 'default', undefined, {
          mfaMethod: 'email',
        });
        return promptResult(args.run, flow, current, descriptor, 900, args.tenantSlug, args.context);
      }

      if (nodeType === 'mfa_webauthn_verify') {
        // WebAuthn verification: prompt for security key
        const schema: PromptSchema = {
          fields: [],
          submitLabel: 'Verify with Security Key',
        };
        const descriptor = ensurePromptDescriptor(flow, current, schema, 'default', undefined, {
          mfaMethod: 'webauthn',
          webauthnChallenge: crypto.randomUUID(),
        });
        return promptResult(args.run, flow, current, descriptor, 600, args.tenantSlug, args.context);
      }

      if (current.type === 'finish') {
        await recordEvent(args.run.tenantId, args.run.id, current.id, 'exit');
        await markRunSuccess(args.run.id, args.context);
        return { type: 'success', runId: args.run.id, context: args.context };
      }

      // Fallback for begin or unsupported nodes => no-op
      await recordEvent(args.run.tenantId, args.run.id, current.id, 'exit');
      current = nextNodeResolver(current, flow);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'flow_execution_error';
      await recordEvent(args.run.tenantId, args.run.id, current?.id || null, 'error', { message });
      await markRunFailure(args.run.id, args.run.tenantId, args.context, message);
      logger.error('Flow node execution failed', {
        runId: args.run.id,
        nodeId: current?.id,
        error: message,
      });
      return { type: 'error', runId: args.run.id, message };
    }
  }

  await markRunSuccess(args.run.id, args.context);
  return { type: 'success', runId: args.run.id, context: args.context };
}

async function promptResult(
  run: FlowRunRecord,
  flow: FlowWithNodes,
  node: FlowNodeWithPrompt,
  descriptor: FlowPromptDescriptor,
  ttlSeconds: number,
  tenantSlug: string,
  context: FlowContext,
): Promise<FlowEngineResult> {
  await prisma.flowRun.update({
    where: { id: run.id },
    data: {
      status: 'interrupted',
      currentNodeId: node.id,
      context: sanitizeContext(context),
    },
  });
  await recordEvent(run.tenantId, run.id, node.id, 'prompt');
  const resumeToken = await issueResumeToken(tenantSlug, { runId: run.id, nodeId: node.id, issuedAt: Date.now() }, ttlSeconds || 600);
  return { type: 'prompt', runId: run.id, prompt: descriptor, resumeToken };
}

async function updateRunContext(runId: string, context: FlowContext, currentNodeId?: string | null) {
  try {
    await prisma.flowRun.update({
      where: { id: runId },
      data: {
        context: sanitizeContext(context),
        currentNodeId: currentNodeId ?? null,
      },
    });
  } catch (err) {
    logger.warn('Failed to update flow context', { error: err instanceof Error ? err.message : err });
  }
}

async function markRunSuccess(runId: string, context: FlowContext) {
  try {
    await prisma.flowRun.update({
      where: { id: runId },
      data: {
        status: 'success',
        finishedAt: new Date(),
        context: sanitizeContext(context),
        currentNodeId: null,
        lastError: null,
      },
    });
  } catch (err) {
    logger.error('Failed to mark flow success', { error: err instanceof Error ? err.message : err });
  }
}

async function markRunFailure(runId: string, tenantId: string, context: FlowContext, message: string) {
  try {
    await prisma.flowRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        context: sanitizeContext(context),
        lastError: message,
      },
    });
    await tenantAuditRepo.create(tenantId, {
      userId: context.user.id,
      action: 'flow.run_failed',
      details: { message },
    });
  } catch (err) {
    logger.error('Failed to mark flow failure', { error: err instanceof Error ? err.message : err });
  }
}

async function handleCaptchaNode(
  args: RunLoopArgs,
  flow: FlowWithNodes,
  node: FlowNodeWithPrompt,
): Promise<{ kind: 'prompt'; prompt: FlowPromptDescriptor; ttlSeconds: number } | { kind: 'continue' } | { kind: 'failure'; message: string }> {
  const cfg = sanitizeConfig<CheckCaptchaConfig>(node.config, {
    provider: 'turnstile',
  });
  if (cfg.provider !== 'mock' && (!cfg.siteKey || !cfg.secretKey)) {
    return { kind: 'failure', message: 'captcha_misconfigured' };
  }
  if (!args.resumeSubmission) {
    const schema: PromptSchema = { fields: [] };
    const prompt = ensurePromptDescriptor(flow, node, schema, 'captcha', undefined, {
      captchaProvider: cfg.provider,
      siteKey: cfg.siteKey,
    });
    return { kind: 'prompt', prompt, ttlSeconds: cfg.timeoutSec || 600 };
  }
  const submission = args.resumeSubmission;
  const captchaToken =
    submission.fields['cf-turnstile-response'] || submission.fields['h-captcha-response'] || submission.fields['captcha_token'];
  if (!captchaToken) {
    const prompt = ensurePromptDescriptor(flow, node, { fields: [] }, 'captcha', 'captcha_required', {
      captchaProvider: cfg.provider,
      siteKey: cfg.siteKey,
    });
    return { kind: 'prompt', prompt, ttlSeconds: cfg.timeoutSec || 600 };
  }
  if (cfg.provider !== 'mock') {
    await guardCaptchaToken(args.tenantSlug, captchaToken);
    const verification = await verifyCaptcha(cfg, captchaToken, args.request.ip);
    if (!verification.success) {
      const prompt = ensurePromptDescriptor(flow, node, { fields: [] }, 'captcha', 'captcha_failed', {
        captchaProvider: cfg.provider,
        siteKey: cfg.siteKey,
      });
      return { kind: 'prompt', prompt, ttlSeconds: cfg.timeoutSec || 600 };
    }
    if (cfg.minScore && verification.score && verification.score < cfg.minScore) {
      return { kind: 'failure', message: 'captcha_low_score' };
    }
    args.context.captcha = {
      provider: cfg.provider,
      verifiedAt: new Date().toISOString(),
      remoteIp: args.request.ip || null,
      score: verification.score,
    };
  } else {
    args.context.captcha = {
      provider: 'mock',
      verifiedAt: new Date().toISOString(),
      remoteIp: args.request.ip || null,
      score: 1,
    };
  }
  await updateRunContext(args.run.id, args.context, node.id);
  return { kind: 'continue' };
}

async function handlePromptNode(
  args: RunLoopArgs,
  flow: FlowWithNodes,
  node: FlowNodeWithPrompt,
): Promise<
  | { kind: 'prompt'; prompt: FlowPromptDescriptor; ttlSeconds: number }
  | { kind: 'continue'; nextNodeId?: string | null }
  | { kind: 'failure'; message: string }
> {
  const cfg = sanitizeConfig<PromptUiConfig>(node.config, {});
  const schema = node.uiPrompt ? parsePromptSchema(node.uiPrompt.schema as Prisma.JsonValue) : { fields: [] };
  const storageKey = cfg.storeAs || node.id;
  if (!args.resumeSubmission) {
    const nodeType = String(node.type);
    const prompt = ensurePromptDescriptor(flow, node, schema, nodeType === 'require_reauth' ? 'reauth' : 'default');
    return { kind: 'prompt', prompt, ttlSeconds: node.uiPrompt?.timeoutSec ?? 600 };
  }
  const submission = args.resumeSubmission;
  const missingField = schema.fields.find((field) => field.required && !submission.fields[field.id]);
  if (missingField) {
    const nodeType = String(node.type);
    const prompt = ensurePromptDescriptor(flow, node, schema, nodeType === 'require_reauth' ? 'reauth' : 'default', `${missingField.label} is required`);
    return { kind: 'prompt', prompt, ttlSeconds: node.uiPrompt?.timeoutSec ?? 600 };
  }
  if (!args.context.prompts) args.context.prompts = {};
  args.context.prompts[storageKey] = {
    action: submission.action,
    fields: submission.fields,
  };
  await updateRunContext(args.run.id, args.context, node.id);
  const route = cfg.actionRouting?.[submission.action];
  const nextNodeId = route?.nextNodeId;
  if (route?.failure) {
    const failureNode = node.failureNodeId || undefined;
    return failureNode ? { kind: 'continue', nextNodeId: failureNode } : { kind: 'failure', message: 'prompt_denied' };
  }
  return { kind: 'continue', nextNodeId };
}

async function handleMetadataWriteNode(
  args: RunLoopArgs,
  node: FlowNodeWithPrompt,
): Promise<{ success: boolean; message?: string }> {
  const cfg = sanitizeConfig<MetadataWriteConfig>(node.config, { namespace: 'default', values: {} });
  if (!cfg.namespace) return { success: false, message: 'metadata_namespace_required' };
  try {
    await writeUserMetadata(args.run.tenantId, args.context.user.id, cfg);
    if (!args.context.metadata) args.context.metadata = {};
    args.context.metadata[cfg.namespace] = cfg.values;
    await updateRunContext(args.run.id, args.context, node.id);
    return { success: true };
  } catch (err) {
    logger.error('Metadata write failed', { error: err instanceof Error ? err.message : err });
    return { success: false, message: 'metadata_write_failed' };
  }
}

function sanitizeConfig<T>(config: Prisma.JsonValue | null, defaults: T): T {
  if (!config || typeof config !== 'object') return { ...defaults };
  return { ...defaults, ...(config as object) } as T;
}
