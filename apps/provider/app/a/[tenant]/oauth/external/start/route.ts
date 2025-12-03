import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { getPending } from '@/services/authz';

function html(body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>External Sign-in</title><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica,Arial,sans-serif;padding:24px;max-width:720px;margin:0 auto">${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return html('<h1>Error</h1><p>missing tenant</p>', 400);

  const url = new URL(req.url);
  const provider = (url.searchParams.get('provider') || '').toLowerCase();
  const rid = url.searchParams.get('rid') || '';

  if (!provider) return html('<h1>Error</h1><p>missing provider</p>', 400);
  if (!rid) return html('<h1>Error</h1><p>missing rid</p>', 400);

  const pending = await getPending(rid);
  if (!pending || pending.tenantSlug !== tenantSlug) return html('<h1>Invalid or expired request</h1>', 400);

  const envProviders = (process.env.SSO_PROVIDERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const supported = ['google', 'microsoft', 'github'];
  let enabled = supported.includes(provider) && envProviders.includes(provider);
  try {
    const { findTenantBySlug } = await import('@/services/jwks');
    const tenant = await findTenantBySlug(tenantSlug);
    if (tenant) {
      const { getEnabledProviderTypesForTenant } = await import('@/services/idp');
      const dbProviders = await getEnabledProviderTypesForTenant(tenant.id);
      if (dbProviders.map((p) => p.toLowerCase()).includes(provider)) enabled = true;
    }
  } catch (e) {
    // Fallback to env-only enablement if DB check fails
    console.warn('Failed to check DB providers:', e);
  }
  if (!enabled) return html('<h1>Provider not enabled</h1><p>This external sign-in provider is not enabled for this tenant.</p>', 400);

  // Redirect to provider-specific SSO start route
  if (provider === 'google') {
    const u = new URL(req.url);
    const start = new URL(`/a/${tenantSlug}/sso/google/start`, u.origin);
    start.searchParams.set('rid', rid);
    return NextResponse.redirect(start.toString());
  }

  const label = provider === 'microsoft' ? 'Microsoft' : provider === 'github' ? 'GitHub' : provider;
  return html(
    `<h1>${escapeHtml(label)} sign-in not yet configured</h1><p>This provider is not implemented yet. Please use magic link instead.</p>`,
    501,
  );
}
