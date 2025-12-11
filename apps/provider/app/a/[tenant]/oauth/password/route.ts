import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { issueMagicToken } from '@/services/authz';
import { getIssuerURL } from '@/utils/issuer';
import { sendMagicEmail } from '@/services/email';
import { verifyPassword } from '@/utils/password';

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });
  const form = await req.formData();
  const email = String(form.get('email') || '').toLowerCase();
  const password = String(form.get('password') || '');
  const rid = String(form.get('rid') || '');

  const schema = z.object({ email: z.string().email(), password: z.string().min(1), rid: z.string().min(8) });
  const parse = schema.safeParse({ email, password, rid });
  if (!parse.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const pendingImport = await import('@/services/authz');
  const pending = await pendingImport.getPending(rid);
  if (!pending || pending.tenantSlug !== tenantSlug) return NextResponse.json({ error: 'expired_request' }, { status: 400 });

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 400 });

  // Find user within tenant
  const prismaMod = await import('@/lib/prisma');
  const user: any = await (prismaMod.prisma as any).user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } }, include: { tenant: true } }).catch(() => null);
  if (!user || !user.passwordHash) return NextResponse.json({ error: 'not_registered' }, { status: 404 });

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });

  // Issue magic token and send link (preserve existing enchanted-link UX)
  const mt = await issueMagicToken({ tenantId: tenant.id, tenantSlug, rid, email });
  const issuer = await getIssuerURL();
  const magicUrl = `${issuer}/oauth/magic/consume?token=${encodeURIComponent(mt.token)}`;
  try { await sendMagicEmail(email, magicUrl); } catch (e) { /* ignore */ }

  return NextResponse.json({ ok: true, message: 'Password verified; magic link sent.', debug_link: magicUrl });
}
