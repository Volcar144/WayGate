import { headers } from 'next/headers';

export const TENANT_HEADER = 'x-tenant';

export function getTenant(): string | null {
  const h = headers();
  const t = h.get(TENANT_HEADER);
  return t ?? null;
}

export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return host.includes('localhost') || host.startsWith('127.0.0.1');
}
