import { getRedis } from '@/lib/redis';

// Simple Redis-backed rate limiter with in-memory fallback.

const memStore = new Map<string, { count: number; resetAt: number }>();

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
