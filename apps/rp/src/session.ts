import { cookies } from 'next/headers';
import { verifyAccessToken, verifyIdToken } from './waygate';

export type SessionCookie = {
  id_token: string;
  access_token: string;
  refresh_token?: string | null;
  created_at: number;
};

export type Claims = {
  sub: string;
  aud?: string | string[];
  iss?: string;
  [key: string]: any;
};

export async function getSession(): Promise<{
  session: SessionCookie | null;
  idClaims?: Claims;
  accessClaims?: Claims;
}> {
  const raw = cookies().get('rp_session')?.value;
  if (!raw) return { session: null };
  let sess: SessionCookie | null = null;
  try {
    sess = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse rp_session cookie', e);
    return { session: null };
  }

  try {
    const idv = await verifyIdToken(sess.id_token);
    const atv = await verifyAccessToken(sess.access_token);
    return { session: sess, idClaims: idv.payload as Claims, accessClaims: atv.payload as Claims };
  } catch (e: any) {
    // Attempt refresh on token expiration
    if (sess.refresh_token) {
      try {
        const res = await fetch('/api/waygate/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: sess.refresh_token }),
          cache: 'no-store',
        });
        if (res.ok) {
          const t = await res.json();
          const updated: SessionCookie = {
            id_token: t.id_token,
            access_token: t.access_token,
            refresh_token: t.refresh_token || sess.refresh_token,
            created_at: Date.now(),
          };
          cookies().set('rp_session', JSON.stringify(updated), {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 30 * 24 * 60 * 60,
          });
          const idv = await verifyIdToken(updated.id_token);
          const atv = await verifyAccessToken(updated.access_token);
          return { session: updated, idClaims: idv.payload as Claims, accessClaims: atv.payload as Claims };
        }
      } catch (err) {
        console.error('Failed to refresh tokens', err);
      }
    }
  }
  return { session: null };
}

export function isAuthenticated(): boolean {
  return !!cookies().get('rp_session');
}
