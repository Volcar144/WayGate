import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug, rotateKeysForTenant } from '@/services/jwks';

export async function POST() {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

  const { kid } = await rotateKeysForTenant(tenant.id);
  return NextResponse.json({ ok: true, kid });
}
