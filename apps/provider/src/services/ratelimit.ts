import { getRedis } from '@/lib/redis';
import { env } from '@/env';
import { z } from 'zod';

// Simple Redis-backed rate limiter with in-memory fallback.

const memStore = new Map<string, { count: number; resetAt: number }>();

type Overrides = {
  tenants?: Record<
    string,
    {
      token?: { ip?: number; client?: number; windowSec?: number };
      register?: { ip?: number; windowSec?: number };
      clients?: Record<string, { client?: number; windowSec?: number }>;
    }
  >;
};

const overridesSchema = z
  .object({
    tenants: z
      .record(
        z.object({
          token: z
            .object({
              ip: z.number().optional(),
              client: z.number().optional(),
              windowSec: z.number().optional(),
            })
            .optional(),
          register: z
            .object({
              ip: z.number().optional(),
              windowSec: z.number().optional(),
            })
            .optional(),
          clients: z
            .record(
              z.object({
                client: z.number().optional(),
                windowSec: z.number().optional(),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
  })
  .optional();

let overrides: Overrides | null = null;
/**
 * Load and cache tenant-specific rate limit overrides from the `RL_OVERRIDES_JSON` environment variable.
 *
 * @returns The parsed and schema-validated overrides object; returns an empty object if the environment value is unset or invalid.
 */
function getOverrides(): Overrides {
  if (overrides != null) return overrides;
  try {
    const parsed = env.RL_OVERRIDES_JSON ? JSON.parse(env.RL_OVERRIDES_JSON) : {};
    const validated = overridesSchema.parse(parsed) as Overrides | undefined;
    overrides = validated || {};
  } catch {
    overrides = {};
  }
  return overrides!;
}

/**
 * Compute token rate limit configuration for a tenant, applying environment defaults and any tenant- or client-specific overrides.
 *
 * @param tenant - Tenant identifier used to look up overrides
 * @param clientId - Optional client identifier used to apply client-specific overrides
 * @returns An object with `ipLimit` (maximum requests per IP in the window), `clientLimit` (maximum requests per client in the window), and `windowMs` (window duration in milliseconds). All numeric values are guaranteed to be at least 1.
 */
export function getTokenRateLimitConfig(tenant: string, clientId?: string | null) {
  const baseIp = env.RL_TOKEN_IP_LIMIT ?? 60;
  const baseClient = env.RL_TOKEN_CLIENT_LIMIT ?? 120;
  const windowSec = env.RL_TOKEN_WINDOW_SEC ?? 60;
  let ip = baseIp;
  let client = baseClient;
  const o = getOverrides();
  const to = o.tenants?.[tenant];
  if (to?.token?.ip != null) ip = to.token.ip;
  if (to?.token?.client != null) client = to.token.client;
  let w = to?.token?.windowSec ?? windowSec;
  if (clientId && to?.clients?.[clientId]?.client != null) client = to.clients[clientId].client!;
  if (clientId && to?.clients?.[clientId]?.windowSec != null) w = to.clients[clientId].windowSec!;
  return { ipLimit: Math.max(1, ip), clientLimit: Math.max(1, client), windowMs: Math.max(1, w) * 1000 };
}

/**
 * Compute registration rate limit settings for a specific tenant.
 *
 * @param tenant - Tenant identifier used to lookup overrides
 * @returns An object containing `ipLimit` (maximum requests per IP for registration, at least 1) and `windowMs` (time window in milliseconds, at least 1000)
 */
export function getRegisterRateLimitConfig(tenant: string) {
  const baseIp = env.RL_REGISTER_IP_LIMIT ?? 10;
  const windowSec = env.RL_REGISTER_WINDOW_SEC ?? 3600;
  const o = getOverrides();
  const to = o.tenants?.[tenant];
  const ip = to?.register?.ip ?? baseIp;
  const w = to?.register?.windowSec ?? windowSec;
  return { ipLimit: Math.max(1, ip), windowMs: Math.max(1, w) * 1000 };
}

/**
 * Attempt to consume one unit from the rate limit bucket identified by `key`.
 *
 * @param key - Namespaced identifier for the rate limit bucket
 * @param limit - Maximum allowed units in the window
 * @param windowMs - Rolling window duration in milliseconds
 * @returns An object with:
 *  - `allowed`: `true` if the consumption is within the limit, `false` otherwise.
 *  - `remaining`: number of units still available in the current window.
 *  - `reset`: timestamp (milliseconds since epoch) when the current window resets.
 */
export async function rateLimitTake(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  const redis = await getRedis();
  if (redis) {
    const n = await redis.incr(key);
    let ttlMs = await redis.pttl(key);
    if (ttlMs < 0) {
      await redis.expire(key, Math.ceil(windowMs / 1000));
      ttlMs = windowMs;
    }
    const allowed = n <= limit;
    const remaining = Math.max(0, limit - n);
    return { allowed, remaining, reset: Date.now() + ttlMs };
  }
  // Fallback in-memory
  const now = Date.now();
  const rec = memStore.get(key);
  if (!rec || rec.resetAt <= now) {
    memStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: 1 <= limit, remaining: Math.max(0, limit - 1), reset: now + windowMs };
  }
  rec.count += 1;
  memStore.set(key, rec);
  return { allowed: rec.count <= limit, remaining: Math.max(0, limit - rec.count), reset: rec.resetAt };
}

export function buildTokenRateLimitKeys(args: { tenant: string; clientId?: string | null; ip?: string | null }) {
  const base = `rl:token:${args.tenant}`;
  return {
    byIp: `${base}:ip:${args.ip || 'unknown'}`,
    byClient: `${base}:client:${args.clientId || 'unknown'}`,
  };
}

export function buildRegisterRateLimitKeys(args: { tenant: string; ip?: string | null }) {
  const base = `rl:register:${args.tenant}`;
  return {
    byIp: `${base}:ip:${args.ip || 'unknown'}`,
  };
}