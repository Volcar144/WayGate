import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { getIssuerURL } from '@/utils/issuer';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';

function etagFor(body: string) {
  return 'W/"' + createHash('sha256').update(body).digest('hex') + '"';
}

export async function GET() {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });

  const issuer = getIssuerURL();

  const cfg = {
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    claims_supported: [
      'sub',
      'iss',
      'aud',
      'exp',
      'iat',
      'auth_time',
      'nonce',
      'name',
      'given_name',
      'family_name',
      'email',
      'email_verified',
      'picture',
    ],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  };

  const body = JSON.stringify(cfg);
  const etag = etagFor(body);

  const res = new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=300',
      etag,
    },
  });

  return res;
}
