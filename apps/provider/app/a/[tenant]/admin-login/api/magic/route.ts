import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { issueMagicToken, newRid } from '@/services/authz';
import { sendMagicEmail } from '@/services/email';
import { getIssuerURL } from '@/utils/issuer';

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) {
    return NextResponse.json({ error: 'Missing tenant' }, { status: 400 });
  }

  const body = await req.json();
  const { email } = body;

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  try {
    const tenant = await findTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Unknown tenant' }, { status: 400 });
    }

    // Create a magic token
    const rid = newRid();
    const mt = await issueMagicToken({
      tenantId: tenant.id,
      tenantSlug,
      rid,
      email: email.toLowerCase(),
      ttlMs: 15 * 60 * 1000 // 15 minutes
    });

    // Build magic link
    const issuer = await getIssuerURL();
    const magicUrl = `${issuer}/admin-login/callback?token=${mt.token}`;

    // Send email
    try {
      await sendMagicEmail(email, magicUrl);
    } catch (error) {
      console.error('Failed to send magic email:', error);
      // In development, return the link
      if (process.env.NODE_ENV === 'development') {
        return NextResponse.json({
          ok: true,
          message: 'Magic link generated (email not sent in development)',
          debug_link: magicUrl
        });
      }
    }

    // In development, always include debug link for consistent DX
    const response: { ok: boolean; message: string; debug_link?: string } = {
      ok: true,
      message: 'Magic link sent to your email'
    };

    if (process.env.NODE_ENV === 'development') {
      response.debug_link = magicUrl;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Magic link error:', error);
    return NextResponse.json({ error: 'Failed to send magic link' }, { status: 500 });
  }
}
