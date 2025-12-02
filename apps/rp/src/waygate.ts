import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { env } from './env';

export type OIDCConfig = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
};

// Global cache to survive hot-reloads during dev
const g = global as unknown as {
  __rp_cache?: {
    config?: OIDCConfig;
    jwks?: ReturnType<typeof createRemoteJWKSet>;
  };
};

function getProviderBaseURL() {
  return env.WAYGATE_BASE_URL || 'http://localhost:3000';
}

export async function discover(): Promise<OIDCConfig> {
  if (!g.__rp_cache) g.__rp_cache = {};
  if (g.__rp_cache.config) return g.__rp_cache.config;
  const base = getProviderBaseURL();
  const wellKnown = `${base}/a/${env.WAYGATE_TENANT_SLUG}/.well-known/openid-configuration`;
  const res = await fetch(wellKnown, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Discovery failed: ${res.status}`);
  const json = (await res.json()) as OIDCConfig;
  g.__rp_cache.config = json;
  return json;
}

export async function getJWKS() {
  if (!g.__rp_cache) g.__rp_cache = {};
  if (g.__rp_cache.jwks) return g.__rp_cache.jwks;
  const cfg = await discover();
  const url = new URL(cfg.jwks_uri);
  const jwks = createRemoteJWKSet(url, { cache: true, cooldownDuration: 30_000 });
  g.__rp_cache.jwks = jwks;
  return jwks;
}

export type Verified = { payload: JWTPayload };

export async function verifyIdToken(idToken: string, nonce?: string | null): Promise<Verified> {
  const cfg = await discover();
  const JWKS = await getJWKS();
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: cfg.issuer,
    audience: env.WAYGATE_CLIENT_ID,
    algorithms: ['RS256'],
  });
  if (nonce && payload.nonce !== nonce) {
    throw new Error('nonce_mismatch');
  }
  return { payload };
}

export async function verifyAccessToken(accessToken: string): Promise<Verified> {
  const cfg = await discover();
  const JWKS = await getJWKS();
  const { payload } = await jwtVerify(accessToken, JWKS, {
    issuer: cfg.issuer,
    audience: env.WAYGATE_CLIENT_ID,
    algorithms: ['RS256'],
  });
  return { payload };
}

export function randomBase64Url(size = 32) {
  const arr = new Uint8Array(size);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(arr);
  } else {
    // Node.js
    const { randomBytes } = require('node:crypto');
    const buf: Buffer = randomBytes(size);
    buf.copy(arr);
  }
  return Buffer.from(arr).toString('base64url');
}

export async function sha256base64Url(input: string) {
  if (typeof crypto !== 'undefined' && 'subtle' in crypto) {
    const enc = new TextEncoder();
    const data = enc.encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Buffer.from(digest).toString('base64url');
  } else {
    const { createHash } = require('node:crypto');
    return createHash('sha256').update(input).digest('base64url');
  }
}

export async function createPkce() {
  const verifier = randomBase64Url(64);
  const challenge = await sha256base64Url(verifier);
  return { verifier, challenge, method: 'S256' as const };
}

export type Session = {
  id_token: string;
  access_token: string;
  refresh_token?: string | null;
  created_at: number;
};

export type StateCookie = {
  state: string;
  verifier: string;
  nonce: string;
  created_at: number;
};
