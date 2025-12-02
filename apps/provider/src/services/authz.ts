import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';

export type PendingAuthRequest = {
  rid: string;
  tenantId: string;
  tenantSlug: string;
  clientDbId: string; // PK of Client row
  clientId: string; // public client id
  clientName: string;
  redirectUri: string;
  scope: string | null;
  state: string | null;
  nonce: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: 'S256' | 'plain' | null;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
  userId: string | null;
  completed: boolean;
};

export type MagicToken = {
  token: string;
  tenantId: string;
  tenantSlug: string;
  rid: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
};

// Simple in-memory stores with global cache for dev hot-reload
export type CodeMeta = {
  nonce: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: 'S256' | 'plain' | null;
  authTime: number; // epoch seconds
  createdAt: number; // epoch ms
};

export type RefreshMeta = {
  scope: string;
  createdAt: number; // epoch ms
};

const g = global as unknown as {
  __authz?: {
    pending: Map<string, PendingAuthRequest>;
    sse: Map<string, Set<WritableStreamDefaultWriter>>;
    magic: Map<string, MagicToken>;
    ratelimit: Map<string, number[]>; // key -> timestamps
    codeMeta: Map<string, CodeMeta>;
    refreshMeta: Map<string, RefreshMeta>;
  };
};

function ensureStore() {
  if (!g.__authz) {
    g.__authz = {
      pending: new Map(),
      sse: new Map(),
      magic: new Map(),
      ratelimit: new Map(),
      codeMeta: new Map(),
      refreshMeta: new Map(),
    };
  }
  return g.__authz!;
}

function now() {
  return Date.now();
}

export function newRid() {
  return randomBytes(16).toString('base64url');
}

export function newToken() {
  return randomBytes(24).toString('base64url');
}

export function createPendingAuthRequest(params: Omit<PendingAuthRequest, 'rid' | 'createdAt' | 'expiresAt' | 'userId' | 'completed'> & { ttlMs?: number }): PendingAuthRequest {
  const store = ensureStore();
  const rid = newRid();
  const createdAt = now();
  const ttl = params.ttlMs ?? 5 * 60 * 1000; // 5 minutes
  const req: PendingAuthRequest = {
    ...params,
    rid,
    createdAt,
    expiresAt: createdAt + ttl,
    userId: null,
    completed: false,
  };
  store.pending.set(rid, req);
  return req;
}

export function getPending(rid: string | null | undefined): PendingAuthRequest | null {
  if (!rid) return null;
  const { pending } = ensureStore();
  const req = pending.get(rid);
  if (!req) return null;
  if (req.expiresAt <= now()) {
    pending.delete(rid);
    return null;
  }
  return req;
}

export function setPendingUser(rid: string, userId: string): PendingAuthRequest | null {
  const { pending } = ensureStore();
  const req = getPending(rid);
  if (!req) return null;
  req.userId = userId;
  pending.set(rid, req);
  return req;
}

export function completePending(rid: string): PendingAuthRequest | null {
  const { pending } = ensureStore();
  const req = getPending(rid);
  if (!req) return null;
  req.completed = true;
  pending.set(rid, req);
  return req;
}

export function subscribeSSE(rid: string, writer: WritableStreamDefaultWriter) {
  const { sse } = ensureStore();
  if (!sse.has(rid)) sse.set(rid, new Set());
  sse.get(rid)!.add(writer);
}

export function unsubscribeSSE(rid: string, writer: WritableStreamDefaultWriter) {
  const { sse } = ensureStore();
  sse.get(rid)?.delete(writer);
}

export async function publishSSE(rid: string, event: string, data: any) {
  const { sse } = ensureStore();
  const subs = sse.get(rid);
  if (!subs || subs.size === 0) return;
  const line = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  await Promise.all(
    Array.from(subs).map(async (w) => {
      try {
        await w.write(new TextEncoder().encode(line));
      } catch {
        // ignore
      }
    })
  );
}

export function issueMagicToken(params: { tenantId: string; tenantSlug: string; rid: string; email: string; ttlMs?: number }): MagicToken {
  const store = ensureStore();
  const token = newToken();
  const createdAt = now();
  const ttl = params.ttlMs ?? 10 * 60 * 1000; // 10 minutes
  const mt: MagicToken = {
    token,
    tenantId: params.tenantId,
    tenantSlug: params.tenantSlug,
    rid: params.rid,
    email: params.email.toLowerCase(),
    createdAt,
    expiresAt: createdAt + ttl,
    used: false,
  };
  store.magic.set(token, mt);
  return mt;
}

export function consumeMagicToken(token: string): MagicToken | null {
  const store = ensureStore();
  const mt = store.magic.get(token);
  if (!mt) return null;
  if (mt.used) return null;
  if (mt.expiresAt <= now()) {
    store.magic.delete(token);
    return null;
  }
  mt.used = true;
  store.magic.set(token, mt);
  return mt;
}

export function cleanupExpired() {
  const store = ensureStore();
  const t = now();
  for (const [rid, req] of store.pending) {
    if (req.expiresAt <= t || req.completed) store.pending.delete(rid);
  }
  for (const [tok, mt] of store.magic) {
    if (mt.expiresAt <= t || mt.used) store.magic.delete(tok);
  }
  for (const [code, meta] of store.codeMeta) {
    // Keep code metadata for up to 10 minutes by default
    if (meta.createdAt <= t - 10 * 60 * 1000) store.codeMeta.delete(code);
  }
  for (const [token, meta] of store.refreshMeta) {
    // Drop refresh metadata after 60 days
    if (meta.createdAt <= t - 60 * 24 * 60 * 60 * 1000) store.refreshMeta.delete(token);
  }
}

export function recordAuthCodeMeta(code: string, meta: Omit<CodeMeta, 'createdAt'>) {
  const { codeMeta } = ensureStore();
  codeMeta.set(code, { ...meta, createdAt: now() });
}

export function getAuthCodeMeta(code: string): CodeMeta | null {
  const { codeMeta } = ensureStore();
  return codeMeta.get(code) || null;
}

export function consumeAuthCodeMeta(code: string): CodeMeta | null {
  const { codeMeta } = ensureStore();
  const m = codeMeta.get(code) || null;
  if (m) codeMeta.delete(code);
  return m;
}

export function setRefreshMeta(token: string, scope: string) {
  const { refreshMeta } = ensureStore();
  refreshMeta.set(token, { scope, createdAt: now() });
}

export function getRefreshMeta(token: string): RefreshMeta | null {
  const { refreshMeta } = ensureStore();
  return refreshMeta.get(token) || null;
}

export function ratelimitCheck(key: string, limit: number, windowMs: number): boolean {
  const { ratelimit } = ensureStore();
  const t = now();
  const arr = ratelimit.get(key) ?? [];
  const recent = arr.filter((x) => x > t - windowMs);
  if (recent.length >= limit) return false;
  recent.push(t);
  ratelimit.set(key, recent);
  return true;
}

export async function findClient(tenantId: string, clientId: string): Promise<{
  id: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  grantTypes: string[];
  firstParty: boolean;
} | null> {
  const c = await (prisma as any).client.findUnique({
    where: { tenantId_clientId: { tenantId, clientId } },
  });
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    clientId: c.clientId,
    redirectUris: c.redirectUris as string[],
    grantTypes: c.grantTypes as string[],
    firstParty: c.firstParty as boolean,
  };
}

export function scopesFromString(scope: string | null | undefined): string[] {
  if (!scope) return [];
  return scope
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function serializeParams(params: Record<string, string | null | undefined>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) usp.set(k, v);
  const s = usp.toString();
  return s ? `?${s}` : '';
}
