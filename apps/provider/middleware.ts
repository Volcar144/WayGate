import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { TENANT_HEADER, isLocalHost } from '@/lib/tenant';
import { logger } from '@/utils/logger';

/**
 * Injects tenant and correlation headers into the downstream request, logs the request, and attaches security headers to the response.
 *
 * Extracts a tenant identifier from the pathname (/a/{tenant}/...) or from the `tenant` query parameter when the host is local; sets the TENANT_HEADER when present. Ensures an `x-request-id` header exists (reusing an incoming value or generating a new UUID), logs a request entry, and returns a NextResponse that continues processing with the modified request headers and a set of baseline security headers (CSP, HSTS in production, and related protections).
 *
 * @param req - The incoming NextRequest to inspect and augment
 * @returns A NextResponse that continues the middleware chain with tenant and `x-request-id` propagated to the downstream request and security headers applied to the response
 */
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
      // Allow SSE and WebSocket connections
      "connect-src 'self' wss: ws:",
      // Scripts: allow self and inline (for Next.js internals)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Styles: allow self and inline
      "style-src 'self' 'unsafe-inline'",
      // Images: allow self and data URIs
      "img-src 'self' data: https:",
      // Fonts: allow from self and Google Fonts
      "font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    ].join('; '),
  );

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};