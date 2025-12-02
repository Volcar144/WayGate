import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { discover } from '../../../src/waygate';

export async function POST(_req: NextRequest) {
  try {
    const session = cookies().get('rp_session')?.value;
    if (session) {
      try {
        const parsed = JSON.parse(session) as { refresh_token?: string | null };
        const cfg = await discover();
        const logoutUrl = `${cfg.issuer}/logout`;
        if (parsed.refresh_token) {
          await fetch(logoutUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refresh_token: parsed.refresh_token }),
          });
        }
      } catch {}
    }
  } catch {}
  cookies().delete('rp_session');
  cookies().delete('rp_oidc');
  return NextResponse.redirect('/');
}
