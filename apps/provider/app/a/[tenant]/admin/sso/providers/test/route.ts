import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/admin';

export const runtime = 'nodejs';

const bodySchema = z.object({
  type: z.enum(['google', 'microsoft', 'github', 'oidc_generic']),
  issuer: z.string().url().optional(),
});

async function discover(issuer: string) {
  try {
    const wellKnown = issuer.replace(/\/$/, '') + '/.well-known/openid-configuration';
    const resp = await fetch(wellKnown, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return { ok: false, error: 'not_found' } as const;
    const json = await resp.json();
    return { ok: true as const, discovery: json };
  } catch (e) {
    return { ok: false as const, error: 'network_error' };
  }
}

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

  let payload: any = {};
  try { payload = await req.json(); } catch {}
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.issues }, { status: 400 });

  const { type, issuer } = parsed.data;
  const existing = await (prisma as any).identityProvider.findFirst({ where: { tenantId: tenant.id, type } });

  if (type === 'google' || type === 'github') {
    if (!existing) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 400 });
    if (!existing.clientId) return NextResponse.json({ ok: false, error: 'missing_client' }, { status: 400 });
    return NextResponse.json({ ok: true, message: 'Basic configuration present' });
  }

  const iss = issuer || (existing?.issuer as string | undefined);
  if (!iss) return NextResponse.json({ ok: false, error: 'missing_issuer' }, { status: 400 });
  const result = await discover(iss);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  const d = result.discovery as any;
  if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) {
    return NextResponse.json({ ok: false, error: 'invalid_discovery' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: 'Issuer is valid', discovery: { authorization_endpoint: d.authorization_endpoint, token_endpoint: d.token_endpoint, jwks_uri: d.jwks_uri } });
}
