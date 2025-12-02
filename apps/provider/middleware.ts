import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { TENANT_HEADER, isLocalHost } from '@/lib/tenant';

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const host = req.headers.get('host');
  let tenant: string | null = null;

  // Path-based tenant: /a/{tenant}/...
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] === 'a' && segments.length >= 2) {
    tenant = segments[1];
  }

  // Local-only fallback via ?tenant=
  if (!tenant) {
    const qpTenant = url.searchParams.get('tenant');
    if (qpTenant && isLocalHost(host)) {
      tenant = qpTenant;
    }
  }

  const requestHeaders = new Headers(req.headers);
  if (tenant) {
    requestHeaders.set(TENANT_HEADER, tenant);
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/a/:path*'],
};
