import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { env } from '../../src/env';
import { verifyIdToken, verifyAccessToken } from '../../src/waygate';

/**
 * Handle the OIDC callback: process query parameters, exchange the authorization code for tokens,
 * verify ID and access tokens, create a session cookie, and redirect to the protected page.
 *
 * @param req - Incoming Next.js request containing OIDC callback query parameters (`code`, `state`, optional `error` and `error_description`)
 * @returns A NextResponse containing either:
 *   - a JSON error payload with an appropriate HTTP status for invalid requests or token verification failures, or
 *   - a redirect to `/protected` after successful token exchange and session creation
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  if (error) {
    return NextResponse.json({ error, error_description: errorDescription || null }, { status: 400 });
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const stateCookie = cookies().get('rp_oidc')?.value;
  if (!stateCookie) return NextResponse.json({ error: 'invalid_request', error_description: 'missing_state' }, { status: 400 });
  let parsed: { state: string; verifier: string; nonce: string } | null = null;
  try {
    parsed = JSON.parse(stateCookie);
  } catch (e) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'invalid_state' }, { status: 400 });
  }
  if (!parsed || parsed.state !== state) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'state_mismatch' }, { status: 400 });
  }

  const res = await fetch('/api/waygate/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      redirect_uri: env.RP_REDIRECT_URI,
      code_verifier: parsed.verifier,
    }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: 'server_error' }));
    return NextResponse.json(payload, { status: res.status });
  }
  const tokenSet = await res.json();
  const idToken: string = tokenSet.id_token;
  const accessToken: string = tokenSet.access_token;
  const refreshToken: string | undefined = tokenSet.refresh_token;

  try {
    await verifyIdToken(idToken, parsed.nonce);
    await verifyAccessToken(accessToken);
  } catch (e) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  const isSecure = process.env.NODE_ENV === 'production';
  cookies().set('rp_session', JSON.stringify({ id_token: idToken, access_token: accessToken, refresh_token: refreshToken ?? null, created_at: Date.now() }), {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  cookies().delete('rp_oidc');

  // On success, redirect to a protected page
  return NextResponse.redirect('/protected');
}