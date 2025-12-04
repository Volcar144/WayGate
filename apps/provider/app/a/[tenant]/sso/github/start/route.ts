import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { getPending } from '@/services/authz';
import { createUpstreamState, getGithubProvider } from '@/services/idp';
import { getIssuerURL } from '@/utils/issuer';

export const runtime = 'nodejs';

function html(body: string, status = 400) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"/><body style="font-family:system-ui;padding:24px;max-width:720px;margin:0 auto">${body}</body>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  );
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

  const provider = await getGithubProvider(tenant.id);
  if (!provider) return html('<h1>GitHub sign-in not configured</h1><p>Please contact your administrator.</p>', 400);

  const us = await createUpstreamState({
    tenantId: tenant.id,
    tenantSlug,
    rid: pending.rid,
    providerId: provider.id,
    providerType: 'github',
  });

  const issuer = getIssuerURL();
  const redirectUri = `${issuer}/sso/github/callback`;

  const scope = (provider.scopes && provider.scopes.length > 0 ? provider.scopes : ['read:user', 'user:email']).join(' ');

  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', provider.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', us.state);
  authUrl.searchParams.set('code_challenge', us.codeChallenge);
  authUrl.searchParams.set('code_challenge_method', us.codeChallengeMethod);
  // Reduce accidental org creation via signup from auth prompt
  authUrl.searchParams.set('allow_signup', 'false');

  return NextResponse.redirect(authUrl.toString());
}
