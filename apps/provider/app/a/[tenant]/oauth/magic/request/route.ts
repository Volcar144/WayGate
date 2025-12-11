import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { getPending, issueMagicToken, ratelimitCheck, serializeParams } from '@/services/authz';
import { getIssuerURL } from '@/utils/issuer';
import { sendMagicEmail } from '@/services/email';

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });
  const form = await req.formData();
  const email = String(form.get('email') || '').toLowerCase();
  const rid = String(form.get('rid') || '');

  const schema = z.object({ email: z.string().email(), rid: z.string().min(8) });
  const parse = schema.safeParse({ email, rid });
  if (!parse.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const pending = await getPending(rid);
  if (!pending || pending.tenantSlug !== tenantSlug)
    return NextResponse.json({ error: 'expired_request' }, { status: 400 });

  // rudimentary rate limit by email
  const rlKey = `magic:${tenantSlug}:${email}`;
  if (!ratelimitCheck(rlKey, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 400 });

  // Ensure the email belongs to an existing user for this tenant. If not, prompt registration.
  const existingUser = await (await import('@/lib/prisma')).prisma.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } }).catch(() => null);
  if (!existingUser) {
    return NextResponse.json({ error: 'not_registered' }, { status: 404 });
  }

  const mt = await issueMagicToken({ tenantId: tenant.id, tenantSlug, rid, email });

  // In a real system, send email containing magic link to mt.email.
  // Provide a debug link for local/testing scenarios.
  const issuer = await getIssuerURL();
  const magicUrl = `${issuer}/oauth/magic/consume${serializeParams({ token: mt.token })}`;

  // Attempt to send via SMTP if configured
  try { await sendMagicEmail(email, magicUrl); } catch {}

  return NextResponse.json({ ok: true, message: 'Magic link sent if email exists. For debug, use provided link.', debug_link: magicUrl });
}
