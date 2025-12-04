import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { getPending } from '@/services/authz';
import { createUpstreamState, getOidcGenericProvider } from '@/services/idp';
import { getIssuerURL } from '@/utils/issuer';
import { discoverOidc } from '@/utils/oidc';

export const runtime = 'nodejs';

function html(body: string, status = 400) {
  return new NextResponse(`<!doctype html><meta charset="utf-8"/><body style="font-family:system-ui;padding:24px;max-width:720px;margin:0 auto">${body}</body>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return html('<h1>Error</h1><p>missing tenant</p>', 400);

  const url = new URL(req.url);
  const rid = url.searchParams.get('rid') || '';
  if (!rid) return html('<h1>Error</h1><p>missing rid</p>', 400);

  const pending = await getPending(rid);
  if (!pending || pending.tenantSlug !== tenantSlug) return html('<h1>Invalid or expired request</h1>', 400);

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return html('<h1>Error</h1><p>unknown tenant</p>', 400);

  const provider = await getOidcGenericProvider(tenant.id);
  if (!provider) return html('<h1>OIDC sign-in not configured</h1><p>Please contact your administrator.</p>', 400);

  const discovery = await discoverOidc(provider.issuer);
  if (!discovery || !discovery.authorization_endpoint) {
    return html('<h1>OIDC sign-in failed</h1><p>Could not discover OIDC endpoints for the configured issuer.</p>', 400);
  }

  const us = await createUpstreamState({
    tenantId: tenant.id,
    tenantSlug,
    rid: pending.rid,
    providerId: provider.id,
    providerType: 'oidc_generic',
  });

  const issuer = getIssuerURL();
  const redirectUri = `${issuer}/sso/oidc_generic/callback`;

  const scope = (provider.scopes && provider.scopes.length > 0 ? provider.scopes : ['openid', 'email', 'profile']).join(' ');

  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', provider.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', us.state);
  authUrl.searchParams.set('nonce', us.nonce);
  authUrl.searchParams.set('code_challenge', us.codeChallenge);
  authUrl.searchParams.set('code_challenge_method', us.codeChallengeMethod);

  return NextResponse.redirect(authUrl.toString());
}
