import { NextRequest, NextResponse } from 'next/server';
import { destroyAdminSession } from '@/lib/auth';
import { getTenant } from '@/lib/tenant';

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  
  if (!tenantSlug) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  await destroyAdminSession();

  return NextResponse.redirect(new URL(`/a/${tenantSlug}/admin-login`, req.url));
}
