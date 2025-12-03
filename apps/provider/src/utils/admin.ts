import { env } from '@/env';
import type { NextRequest } from 'next/server';

export function isAdminRequest(req: NextRequest): boolean {
  const token = req.headers.get('x-admin-secret');
  if (!env.ADMIN_SECRET) return false;
  return token === env.ADMIN_SECRET;
}
