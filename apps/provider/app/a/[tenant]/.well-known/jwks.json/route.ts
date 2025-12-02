import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug, getJWKSForTenant } from '@/services/jwks';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';

function etagFor(body: string) {
  return 'W/"' + createHash('sha256').update(body).digest('hex') + '"';
}

export async function GET() {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

  const jwks = await getJWKSForTenant(tenant.id);
  const body = JSON.stringify(jwks);
  const etag = etagFor(body);

  const res = new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=300',
      etag,
    },
  });

  return res;
}
