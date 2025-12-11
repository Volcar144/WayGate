import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ active: false }, { status: 400 });

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ active: false }, { status: 400 });

  // Accept form-encoded or JSON body
  let token: string | null = null;
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await req.json();
      token = String(body.token || body.access_token || '');
    } else {
      const form = await req.formData();
      token = String(form.get('token') || form.get('access_token') || '');
    }
  } catch (e) {
    return NextResponse.json({ active: false }, { status: 400 });
  }

  if (!token) return NextResponse.json({ active: false }, { status: 200 });

  // Treat token as session id for now
  try {
    const session = await prisma.session.findUnique({ where: { id: token } });
    if (!session || session.tenantId !== tenant.id) return NextResponse.json({ active: false }, { status: 200 });
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.floor(new Date(session.expiresAt).getTime() / 1000);
    const active = exp > now;
    if (!active) return NextResponse.json({ active: false }, { status: 200 });
    return NextResponse.json({ active: true, sub: session.userId, exp, tenant: tenantSlug }, { status: 200 });
  } catch (e) {
    console.error('Introspect error', e);
    return NextResponse.json({ active: false }, { status: 500 });
  }
}
