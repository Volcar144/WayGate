import { env } from '@/env';
import type { NextRequest } from 'next/server';

/**
 * Determines whether the given request is authenticated with the application admin secret.
 *
 * If the environment admin secret is not configured, this always returns `false`.
 *
 * @param req - The incoming Next.js request whose `x-admin-secret` header will be checked.
 * @returns `true` if the `x-admin-secret` header exactly matches `env.ADMIN_SECRET`, `false` otherwise.
 */
export function isAdminRequest(req: NextRequest): boolean {
  const token = req.headers.get('x-admin-secret');
  if (!env.ADMIN_SECRET) return false;
  return token === env.ADMIN_SECRET;
}