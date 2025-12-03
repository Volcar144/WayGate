import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { TENANT_HEADER, isLocalHost } from '@/lib/tenant';
import { logger } from '@/utils/logger';

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
  // Correlation ID
  const rid = req.headers.get('x-request-id') || crypto.randomUUID();
  requestHeaders.set('x-request-id', rid);

  // Request log (method, path, tenant)
  try {
    logger.info('request', { method: req.method, path: url.pathname, tenant: tenant || 'unknown', ip: (req as any).ip || req.headers.get('x-forwarded-for') || null, ua: req.headers.get('user-agent') || null, rid });
  } catch {}

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // Security headers
  const isProd = process.env.NODE_ENV === 'production';
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (isProd) res.headers.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  // Baseline CSP; individual routes can override
  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Allow SSE
      "connect-src 'self'",
      // Inline scripts will be allowed only via nonce in route responses
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
    ].join('; '),
  );

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
