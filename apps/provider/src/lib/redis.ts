import { env } from '@/env';
import type IORedis from 'ioredis';

// Provide a shared Redis utility with singleton connections
// We lazy-require ioredis to avoid bundling issues if Redis is not used

type RedisClient = IORedis.Redis;

const g = global as unknown as {
  __redis_primary?: RedisClient | null;
};

function buildRedis(): RedisClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Redis = require('ioredis') as typeof import('ioredis');
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT || 6379,
    username: env.REDIS_USERNAME,
    password: env.REDIS_PASSWORD,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  return client as unknown as RedisClient;
}

export async function getRedis(): Promise<RedisClient | null> {
  if (!env.REDIS_HOST) return null;
  if (g.__redis_primary === undefined) {
    try {
      g.__redis_primary = buildRedis();
    } catch (e) {
      g.__redis_primary = null;
      return null;
    }
  }
  const client = g.__redis_primary;
  if (!client) return null;
  // Connect if needed
  try {
    // @ts-ignore - ioredis v5 may have connect, older connects lazily on first command
    await client.connect?.();
  } catch (e) {
    // Ignore connect errors and fallback to in-memory
    return null;
  }
  return client;
}

export async function newRedisSubscriber(): Promise<RedisClient | null> {
  if (!env.REDIS_HOST) return null;
  let client: RedisClient | null = null;
  try {
    client = buildRedis();
    // @ts-ignore
    await client.connect?.();
    return client;
  } catch (e) {
    try { await (client as any)?.quit?.(); } catch { /* ignore */ }
    return null;
  }
}
