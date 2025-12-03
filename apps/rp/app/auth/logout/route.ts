import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { discover } from '../../../src/waygate';

/**
 * Handle relying party logout: notify the identity provider if a refresh token is present, clear local RP cookies, and redirect to the site root.
 *
 * If notifying the provider fails, the error is logged and will be reported to Sentry when the Sentry package is available.
 *
 * @returns A redirect response to `/`.
 */
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
      } catch (e) {
        try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {}
        console.error('Failed to notify provider logout', e);
      }
    }
  } catch (e) {
    try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {}
    console.error('Error during RP logout', e);
  }
  cookies().delete('rp_session');
  cookies().delete('rp_oidc');
  return NextResponse.redirect('/');
}