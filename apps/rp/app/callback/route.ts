import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { env } from '../../src/env';
import { verifyIdToken, verifyAccessToken } from '../../src/waygate';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  if (error) {
    return NextResponse.redirect(`/error?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(errorDescription || '')}`);
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return NextResponse.redirect('/');
  }

  const stateCookie = cookies().get('rp_oidc')?.value;
  if (!stateCookie) return NextResponse.redirect('/');
  let parsed: { state: string; verifier: string; nonce: string } | null = null;
  try { parsed = JSON.parse(stateCookie); } catch {}
  if (!parsed || parsed.state !== state) {
    return NextResponse.redirect('/');
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
    return NextResponse.redirect('/');
  }
  const tokenSet = await res.json();
  const idToken: string = tokenSet.id_token;
  const accessToken: string = tokenSet.access_token;
  const refreshToken: string | undefined = tokenSet.refresh_token;

  try {
    await verifyIdToken(idToken, parsed.nonce);
    await verifyAccessToken(accessToken);
  } catch (e) {
    return NextResponse.redirect('/');
  }

  cookies().set('rp_session', JSON.stringify({ id_token: idToken, access_token: accessToken, refresh_token: refreshToken ?? null, created_at: Date.now() }), {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  cookies().delete('rp_oidc');

  return NextResponse.redirect('/protected');
}
