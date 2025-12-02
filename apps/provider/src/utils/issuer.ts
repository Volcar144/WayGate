import { headers } from 'next/headers';
import { env } from '@/env';
import { getTenant } from '@/lib/tenant';

export function getIssuerURL(): string {
  // Precedence: explicit ISSUER_URL env overrides dynamic detection
  if (env.ISSUER_URL) return env.ISSUER_URL;

  const h = headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('host');
  const tenant = getTenant();

  if (!host) throw new Error('Cannot derive issuer: missing Host header');
  if (!tenant) throw new Error('Cannot derive issuer: missing tenant context');

  return `${proto}://${host}/a/${tenant}`;
}
