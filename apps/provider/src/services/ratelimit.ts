import { env } from '@/env';

// Simple Redis-like rate limiter with in-memory fallback. If REDIS_* envs are set,
// this will attempt a best-effort connection using a dynamic import of 'ioredis'.
// If the import fails or no config is provided, it falls back to a process-local map.

type RedisLike = {
  incr: (key: string) => Promise<number>;
  pttl: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<void>;
};

let redisClient: RedisLike | null = null;
const memStore = new Map<string, { count: number; resetAt: number }>();

async function getRedis(): Promise<RedisLike | null> {
  if (redisClient !== null) return redisClient;
  const host = env.REDIS_HOST;
  const port = env.REDIS_PORT || 6379;
  if (!host) {
    redisClient = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IORedis = require('ioredis');
    const client = new IORedis({
      host,
      port,
      username: env.REDIS_USERNAME,
      password: env.REDIS_PASSWORD,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    try {
      await client.connect?.();
    } catch {}
    redisClient = {
      incr: async (key: string) => await client.incr(key),
      pttl: async (key: string) => await client.pttl(key),
      expire: async (key: string, seconds: number) => {
        await client.expire(key, seconds);
      },
    } as RedisLike;
    return redisClient;
  } catch {
    redisClient = null;
    return null;
  }
}

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
