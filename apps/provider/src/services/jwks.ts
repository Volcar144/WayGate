import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, calculateJwkThumbprint, JWK } from 'jose';

// Export the prisma instance for use in seed
export { prisma };

export type KeyStatus = 'staged' | 'active' | 'retired';

// AES-256-GCM helpers
function getEncryptionKey(): Buffer {
  const secret = env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY is required for encrypting JWKs');
  // Derive a 32-byte key from the provided secret using SHA-256
  return createHash('sha256').update(secret).digest();
}

function encryptPrivateJwk(privateJwk: JWK): string {
  const iv = randomBytes(12); // GCM nonce
  const key = getEncryptionKey();

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(privateJwk), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // base64url encode components and join
  const b64 = (buf: Buffer) => buf.toString('base64url');
  return `v1:gcm:${b64(iv)}:${b64(encrypted)}:${b64(tag)}`;
}

function decryptPrivateJwk(payload: string): JWK {
  const [ver, mode, ivB64, dataB64, tagB64] = payload.split(':');
  if (ver !== 'v1' || mode !== 'gcm') {
    throw new Error('Unsupported JWK encryption payload');
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

function now(): Date {
  return new Date();
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export async function ensureActiveKeyForTenant(tenantId: string): Promise<void> {
  // If no active key exists, generate and activate one
  const existingActive = await (prisma as any).jwkKey.findFirst({
    where: { tenantId, status: 'active' },
  });
  if (existingActive) return;
  await rotateKeysForTenant(tenantId);
}

export async function rotateKeysForTenant(tenantId: string): Promise<{ kid: string }> {
  // Create a new staged key and then promote it to active, retiring any previous active key
  const { publicJwk, privateJwk, kid } = await generateRS256();
  const encrypted = encryptPrivateJwk(privateJwk);

  const nb = now();
  const na = addDays(nb, 7); // keep retired keys available 7 days

  // demote old active -> retired with notAfter
  const prevActive = await (prisma as any).jwkKey.findFirst({ where: { tenantId, status: 'active' } });

  // create staged
  const created = await (prisma as any).jwkKey.create({
    data: {
      tenantId,
      kid,
      pubJwk: publicJwk as any,
      privJwkEncrypted: encrypted,
      status: 'staged',
      notBefore: nb,
      notAfter: null,
    },
  });

  // promote staged to active
  await (prisma as any).jwkKey.update({
    where: { id: created.id },
    data: { status: 'active' },
  });

  if (prevActive) {
    await (prisma as any).jwkKey.update({
      where: { id: prevActive.id },
      data: { status: 'retired', notAfter: na },
    });
  }

  // audit
  await (prisma as any).audit.create({
    data: {
      tenantId,
      action: 'jwks.rotate',
      ip: null,
      userId: null,
      userAgent: null,
    },
  });

  return { kid };
}

export async function getJWKSForTenant(tenantId: string): Promise<{ keys: JWK[] }> {
  // include active keys and retired keys that are still within notAfter
  const list = await (prisma as any).jwkKey.findMany({
    where: {
      tenantId,
      OR: [
        { status: 'active' },
        { status: 'retired', notAfter: { gt: now() } },
      ],
    },
    orderBy: { notBefore: 'desc' },
  });

  const keys = (list || []).map((k: any) => k.pubJwk as JWK);
  return { keys };
}

export async function getActivePrivateJwk(tenantId: string): Promise<JWK | null> {
  const active = await (prisma as any).jwkKey.findFirst({ where: { tenantId, status: 'active' } });
  if (!active) return null;
  return decryptPrivateJwk(active.privJwkEncrypted as string);
}

export async function findTenantBySlug(slug: string): Promise<{ id: string } | null> {
  const tenant = await (prisma as any).tenant.findUnique({ where: { slug } });
  return tenant ? { id: tenant.id } : null;
}

export async function getActiveKeyForTenant(tenantId: string): Promise<{ kid: string; privateJwk: JWK; publicJwk: JWK } | null> {
  const active = await (prisma as any).jwkKey.findFirst({
    where: { tenantId, status: 'active' },
    select: { kid: true, pubJwk: true, privJwkEncrypted: true },
  });
  if (!active) return null;
  const privateJwk = decryptPrivateJwk(active.privJwkEncrypted as string);
  const publicJwk = active.pubJwk as JWK;
  return { kid: active.kid as string, privateJwk, publicJwk };
}

async function generateRS256(): Promise<{ publicJwk: JWK; privateJwk: JWK; kid: string }> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  const privateJwk = (await exportJWK(privateKey)) as JWK;

  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  const kid = await calculateJwkThumbprint(publicJwk, 'sha256');
  publicJwk.kid = kid;

  return { publicJwk, privateJwk, kid };
}
