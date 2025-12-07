import { env } from '@/env';
import { getTenant } from './tenant';

// Provide a shared Redis utility with singleton connections
// We lazy-require ioredis to avoid bundling issues if Redis is not used

// Use a minimal 'any' type to avoid requiring ioredis types at build time
// This keeps Redis optional for environments without it installed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedisClient = any;

const g = global as unknown as {
  __redis_primary?: RedisClient | null;
};

function buildRedis(): RedisClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Redis = require('ioredis');
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
    try { await (client as any)?.quit?.(); } catch {
      // ignore
    }
    return null;
  }
}

/**
 * Create a tenant-namespaced Redis key
 * All Redis keys should be prefixed with tenant namespace to ensure isolation
 */
export function namespacedKey(key: string, tenantSlug?: string): string {
  const tenant = tenantSlug || getTenant();
  if (!tenant) {
    // In development, allow non-namespaced keys for backward compatibility
    if (process.env.NODE_ENV !== 'production') {
      return key;
    }
    throw new Error('Tenant context required for Redis operations in production');
  }
  return `wg:${tenant}:${key}`;
}

/**
 * Create a tenant-namespaced Redis channel for pub/sub
 */
export function namespacedChannel(channel: string, tenantSlug?: string): string {
  const tenant = tenantSlug || getTenant();
  if (!tenant) {
    // In development, allow non-namespaced channels for backward compatibility
    if (process.env.NODE_ENV !== 'production') {
      return channel;
    }
    throw new Error('Tenant context required for Redis pub/sub in production');
  }
  return `wg:${tenant}:${channel}`;
}

/**
 * Wrapper for Redis operations that automatically applies tenant namespacing
 */
export class TenantRedis {
  private client: RedisClient | null;
  private tenantSlug?: string;

  constructor(tenantSlug?: string) {
    this.tenantSlug = tenantSlug;
  }

  async getClient(): Promise<RedisClient | null> {
    if (!this.client) {
      this.client = await getRedis();
    }
    return this.client;
  }

  /**
   * Get a namespaced key
   */
  key(key: string): string {
    return namespacedKey(key, this.tenantSlug);
  }

  /**
   * Get a namespaced channel
   */
  channel(channel: string): string {
    return namespacedChannel(channel, this.tenantSlug);
  }

  /**
   * Set a value with tenant namespacing
   */
  async set(key: string, value: string, ...args: any[]): Promise<any> {
    const client = await this.getClient();
    if (!client) return null;
    return client.set(this.key(key), value, ...args);
  }

  /**
   * Get a value with tenant namespacing
   */
  async get(key: string): Promise<string | null> {
    const client = await this.getClient();
    if (!client) return null;
    return client.get(this.key(key));
  }

  /**
   * Delete a key with tenant namespacing
   */
  async del(key: string): Promise<number> {
    const client = await this.getClient();
    if (!client) return 0;
    return client.del(this.key(key));
  }

  /**
   * Increment a key with tenant namespacing
   */
  async incr(key: string): Promise<number> {
    const client = await this.getClient();
    if (!client) return 0;
    return client.incr(this.key(key));
  }

  /**
   * Set expiration on a key with tenant namespacing
   */
  async expire(key: string, seconds: number): Promise<number> {
    const client = await this.getClient();
    if (!client) return 0;
    return client.expire(this.key(key), seconds);
  }

  /**
   * Get TTL for a key with tenant namespacing
   */
  async pttl(key: string): Promise<number> {
    const client = await this.getClient();
    if (!client) return -2;
    return client.pttl(this.key(key));
  }

  /**
   * Publish to a channel with tenant namespacing
   */
  async publish(channel: string, message: string): Promise<number> {
    const client = await this.getClient();
    if (!client) return 0;
    return client.publish(this.channel(channel), message);
  }

  /**
   * Subscribe to a channel with tenant namespacing
   */
  async subscribe(channel: string, callback: (channel: string, message: string) => void): Promise<void> {
    const client = await newRedisSubscriber();
    if (!client) return;
    
    const namespacedChan = this.channel(channel);
    client.subscribe(namespacedChan, (msg: string) => {
      callback(channel, msg); // Return original channel name to caller
    });
  }

  /**
   * Atomic get and delete with tenant namespacing
   */
  async getdel(key: string): Promise<string | null> {
    const client = await this.getClient();
    if (!client) return null;
    
    // Try to use GETDEL if available, otherwise fallback to GET+DEL
    if (typeof (client as any).getdel === 'function') {
      return (client as any).getdel(this.key(key));
    } else {
      const value = await client.get(this.key(key));
      await client.del(this.key(key));
      return value;
    }
  }

  /**
   * Multi-command transaction with tenant namespacing
   */
  async multi(): Promise<TenantRedisTransaction> {
    const client = await this.getClient();
    if (!client) {
      throw new Error('Redis client not available');
    }
    
    const multi = client.multi();
    return new TenantRedisTransaction(multi, this);
  }
}

/**
 * Transaction wrapper for tenant-namespaced Redis operations
 */
export class TenantRedisTransaction {
  private multi: any;
  private tenantRedis: TenantRedis;

  constructor(multi: any, tenantRedis: TenantRedis) {
    this.multi = multi;
    this.tenantRedis = tenantRedis;
  }

  set(key: string, value: string, ...args: any[]): this {
    this.multi.set(this.tenantRedis.key(key), value, ...args);
    return this;
  }

  get(key: string): this {
    this.multi.get(this.tenantRedis.key(key));
    return this;
  }

  del(key: string): this {
    this.multi.del(this.tenantRedis.key(key));
    return this;
  }

  incr(key: string): this {
    this.multi.incr(this.tenantRedis.key(key));
    return this;
  }

  exec(): Promise<any> {
    return this.multi.exec();
  }
}

/**
 * Create a tenant-scoped Redis instance
 */
export function getTenantRedis(tenantSlug?: string): TenantRedis {
  return new TenantRedis(tenantSlug);
}
