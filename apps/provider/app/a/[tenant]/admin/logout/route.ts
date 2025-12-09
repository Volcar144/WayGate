import { NextRequest, NextResponse } from 'next/server';
import { destroyAdminSession } from '@/lib/auth';
import { getTenant } from '@/lib/tenant';

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  
  if (!tenantSlug) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  try {
    await destroyAdminSession();
  } catch (error) {
    console.error('Failed to destroy admin session during logout:', error);
    // Continue with logout redirect even if session cleanup fails
  }

  return NextResponse.redirect(new URL(`/a/${tenantSlug}/admin-login`, req.url));
}
