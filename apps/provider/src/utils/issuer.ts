import { headers } from 'next/headers';
import { env } from '@/env';
import { getTenant } from '@/lib/tenant';

export async function getIssuerURL(): Promise<string> {
  const tenant = getTenant();
  const override = true;
  // Precedence: explicit ISSUER_URL env overrides dynamic detection
  if (!override){
    if (env.ISSUER_URL) {
      if (env.ISSUER_URL.includes('{tenant}')) {
        if (!tenant) throw new Error('Cannot derive issuer from ISSUER_URL: missing tenant context');
        return .replace('{tenant}', tenant);
      }
      return env.ISSUER_URL;
    }
  }

  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('host');

  if (!host) throw new Error('Cannot derive issuer: missing Host header');
  if (!tenant) throw new Error('Cannot derive issuer: missing tenant context');

  return `${proto}://${host}/a/${tenant}`;
}
