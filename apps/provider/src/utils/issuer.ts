import { headers } from 'next/headers';
import { env } from '@/env';
import { getTenant } from '@/lib/tenant';

export async function getIssuerURL(): Promise<string> {
  const tenant = getTenant();

  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('host');

  if (!host) throw new Error('Cannot derive issuer: missing Host header');
  if (!tenant) throw new Error('Cannot derive issuer: missing tenant context');

  return `${proto}://${host}/a/${tenant}`;
}
