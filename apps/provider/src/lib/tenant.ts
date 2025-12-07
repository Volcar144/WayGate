import { headers } from 'next/headers';

export const TENANT_HEADER = 'x-tenant';

export function getTenant(): string | null {
  // `headers()` has different runtime typings depending on Next.js version/environment.
  // Cast to a minimal interface with `get` to keep synchronous callers working.
  const h = headers() as unknown as { get: (name: string) => string | null };
  const t = h.get(TENANT_HEADER);
  return t ?? null;
}

export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return host.includes('localhost') || host.startsWith('127.0.0.1');
}
