import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { env } from '../../../src/env';
import { createPkce, discover, randomBase64Url } from '../../../src/waygate';

/**
 * Initiates an OpenID Connect authorization flow by persisting PKCE parameters, state, and nonce in an HTTP-only cookie and redirecting the client to the provider's authorization endpoint.
 *
 * The cookie contains `state`, the PKCE `verifier`, `nonce`, and a creation timestamp, is HTTP-only, uses `SameSite=Lax`, and expires after 10 minutes. The redirected authorization URL includes the authorization code parameters (response type, client ID, redirect URI, scope, state, nonce, code challenge, and challenge method).
 *
 * @returns A response that redirects the client to the OIDC provider's authorization endpoint.
 */
export async function GET() {
  const cfg = await discover();
  const { verifier, challenge, method } = await createPkce();
  const state = randomBase64Url(32);
  const nonce = randomBase64Url(32);

  const cookiePayload = {
    state,
    verifier,
    nonce,
    created_at: Date.now(),
  };
  const isSecure = process.env.NODE_ENV === 'production';
  cookies().set('rp_oidc', JSON.stringify(cookiePayload), {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60, // 10 minutes
  });

  const usp = new URLSearchParams();
  usp.set('response_type', 'code');
  usp.set('client_id', env.WAYGATE_CLIENT_ID);
  usp.set('redirect_uri', env.RP_REDIRECT_URI);
  usp.set('scope', 'openid offline_access');
  usp.set('state', state);
  usp.set('nonce', nonce);
  usp.set('code_challenge', challenge);
  usp.set('code_challenge_method', method);

  const authorizeUrl = `${cfg.authorization_endpoint}?${usp.toString()}`;
  return NextResponse.redirect(authorizeUrl);
}