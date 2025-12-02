import { getIssuerURL } from '@/utils/issuer';
import { getActiveKeyForTenant } from '@/services/jwks';
import { importJWK, SignJWT, JWK } from 'jose';

export type SignedToken = { token: string; exp: number; kid: string };

async function getSigningKey(tenantId: string): Promise<{ alg: 'RS256'; kid: string; key: CryptoKey }> {
  const active = await getActiveKeyForTenant(tenantId);
  if (!active) throw new Error('no_active_signing_key');
  const alg: 'RS256' = 'RS256';
  const key = await importJWK(active.privateJwk as JWK, alg);
  return { alg, kid: active.kid, key };
}

export async function signAccessToken(params: {
  tenantId: string;
  sub: string;
  clientId: string;
  scope: string | null;
  expiresInSec?: number;
}): Promise<SignedToken> {
  const { tenantId, sub, clientId, scope } = params;
  const expiresInSec = params.expiresInSec ?? 60 * 15; // 15 minutes
  const { alg, kid, key } = await getSigningKey(tenantId);
  const issuer = getIssuerURL();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSec;

  const jwt = await new SignJWT({
    sub,
    aud: clientId,
    scope: scope || undefined,
    typ: 'at+jwt',
  } as any)
    .setProtectedHeader({ alg, kid })
    .setIssuer(issuer)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);

  return { token: jwt, exp, kid };
}

export async function signIdToken(params: {
  tenantId: string;
  sub: string;
  clientId: string;
  nonce?: string | null;
  authTime?: number | null; // epoch seconds
  expiresInSec?: number;
}): Promise<SignedToken> {
  const { tenantId, sub, clientId, nonce, authTime } = params;
  const expiresInSec = params.expiresInSec ?? 60 * 5; // 5 minutes
  const { alg, kid, key } = await getSigningKey(tenantId);
  const issuer = getIssuerURL();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSec;

  const claims: Record<string, any> = { sub, aud: clientId };
  if (nonce) claims.nonce = nonce;
  if (authTime) claims.auth_time = authTime;

  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg, kid })
    .setIssuer(issuer)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);

  return { token: jwt, exp, kid };
}
