import { prisma } from '@/lib/prisma';
import { getRedis } from '@/lib/redis';
import { env } from '@/env';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

export type IdpType = 'google' | 'microsoft' | 'github' | 'oidc_generic';
export type ProviderStatus = 'enabled' | 'disabled';

export type IdentityProviderConfig = {
  id: string;
  tenantId: string;
  type: IdpType;
  clientId: string;
  clientSecretEnc: string;
  clientSecret: string; // decrypted
  issuer: string;
  scopes: string[];
  status: ProviderStatus;
};

export type UpstreamState = {
  state: string;
  tenantId: string;
  tenantSlug: string;
  rid: string;
  providerId: string;
  providerType: IdpType;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  createdAt: number; // ms
  expiresAt: number; // ms
};

// AES-256-GCM helpers (shared with jwks.ts style)
function getEncryptionKey(): Buffer {
  const secret = env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY is required for secret encryption');
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const key = getEncryptionKey();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64 = (buf: Buffer) => buf.toString('base64url');
  return `v1:gcm:${b64(iv)}:${b64(encrypted)}:${b64(tag)}`;
}

export function decryptSecret(payload: string): string {
  const [ver, mode, ivB64, dataB64, tagB64] = payload.split(':');
  if (ver !== 'v1' || mode !== 'gcm') throw new Error('Unsupported secret payload');
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return out.toString('utf8');
}

function b64url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generatePkcePair(): { verifier: string; challenge: string; method: 'S256' } {
  const verifier = b64url(randomBytes(32)); // 43 to 128 chars; 32 bytes -> 43 b64url chars
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

function keyState(state: string) {
  return `idp:state:${state}`;
}

const g = global as unknown as {
  __idp?: {
    states: Map<string, UpstreamState>;
  };
};

function ensureStore() {
  if (!g.__idp) g.__idp = { states: new Map() };
  return g.__idp;
}

export async function createUpstreamState(params: {
  tenantId: string;
  tenantSlug: string;
  rid: string;
  providerId: string;
  providerType: IdpType;
  ttlMs?: number;
}): Promise<UpstreamState> {
  const state = randomBytes(16).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  const { verifier, challenge, method } = generatePkcePair();
  const createdAt = Date.now();
  const ttl = params.ttlMs ?? 5 * 60 * 1000; // 5 minutes
  const us: UpstreamState = {
    state,
    tenantId: params.tenantId,
    tenantSlug: params.tenantSlug,
    rid: params.rid,
    providerId: params.providerId,
    providerType: params.providerType,
    nonce,
    codeVerifier: verifier,
    codeChallenge: challenge,
    codeChallengeMethod: method,
    createdAt,
    expiresAt: createdAt + ttl,
  };

  const redis = await getRedis();
  if (redis) {
    await redis.set(keyState(state), JSON.stringify(us), 'EX', Math.max(1, Math.ceil(ttl / 1000)));
  } else {
    const store = ensureStore();
    store.states.set(state, us);
  }

  return us;
}

export async function getUpstreamState(state: string): Promise<UpstreamState | null> {
  if (!state) return null;
  const redis = await getRedis();
  if (redis) {
    const raw = await redis.get(keyState(state));
    if (!raw) return null;
    try { return JSON.parse(raw) as UpstreamState; } catch { return null; }
  }
  const store = ensureStore();
  const s = store.states.get(state) || null;
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    store.states.delete(state);
    return null;
  }
  return s;
}

export async function consumeUpstreamState(state: string): Promise<UpstreamState | null> {
  const redis = await getRedis();
  if (redis) {
    const key = keyState(state);
    try {
      const raw = await (redis as any).getdel(key);
      if (!raw) return null;
      return JSON.parse(raw) as UpstreamState;
    } catch (e) {
      try {
        const res = await (redis as any).multi().get(key).del(key).exec();
        const raw = res?.[0]?.[1] as string | null;
        if (!raw) return null;
        return JSON.parse(raw) as UpstreamState;
      } catch {
        return null;
      }
    }
  }
  const store = ensureStore();
  const s = store.states.get(state) || null;
  if (!s) return null;
  store.states.delete(state);
  if (s.expiresAt <= Date.now()) return null;
  return s;
}

export async function getEnabledProviderTypesForTenant(tenantId: string): Promise<IdpType[]> {
  const rows = await (prisma as any).identityProvider.findMany({ where: { tenantId, status: 'enabled' }, select: { type: true } });
  return (rows || []).map((r: any) => r.type as IdpType);
}

export async function getGoogleProvider(tenantId: string): Promise<IdentityProviderConfig | null> {
  const row = await (prisma as any).identityProvider.findFirst({ where: { tenantId, type: 'google', status: 'enabled' } });
  if (!row) return null;
  let clientSecret = '';
  try {
    clientSecret = decryptSecret(row.clientSecretEnc as string);
  } catch (e) {
    // If decrypt fails, treat as not configured
    return null;
  }
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    type: row.type as IdpType,
    clientId: row.clientId as string,
    clientSecretEnc: row.clientSecretEnc as string,
    clientSecret,
    issuer: row.issuer as string,
    scopes: (row.scopes || []) as string[],
    status: row.status as ProviderStatus,
  };
}
