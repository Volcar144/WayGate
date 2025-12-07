import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/admin';
import { encryptSecret, decryptSecret } from '@/services/idp';
import { getIssuerURL } from '@/utils/issuer';

export const runtime = 'nodejs';

const typeSchema = z.enum(['google', 'microsoft', 'github', 'oidc_generic']);

const upsertSchema = z.object({
  type: typeSchema,
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  issuer: z.string().url().optional(),
  scopes: z.union([z.array(z.string()).transform((a) => a.filter(Boolean)), z.string().transform((s) => s.split(/\s+/).filter(Boolean))]).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
});

async function buildCallbackUrl(type: string): Promise<string> {
  const issuer = await getIssuerURL();
  return `${issuer}/sso/${type}/callback`;
}

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

  const rows = await (prisma as any).identityProvider.findMany({ where: { tenantId: tenant.id } });
  const result = await Promise.all(rows.map(async (r: any) => {
    let hasSecret = false;
    try {
      const val = r.clientSecretEnc ? decryptSecret(r.clientSecretEnc) : '';
      hasSecret = !!val && val !== 'placeholder';
    } catch {
      hasSecret = false;
    }
    return {
      id: r.id,
      type: r.type,
      clientId: r.clientId,
      issuer: r.issuer,
      scopes: r.scopes || [],
      status: r.status,
      hasSecret,
      callbackUrl: await buildCallbackUrl(r.type),
    };
  }));

  // Also include default entries for missing providers to simplify UI
  const types = ['google', 'microsoft', 'github', 'oidc_generic'];
  const byType = new Map(result.map((r: any) => [r.type, r]));
  const enriched = await Promise.all(types.map(async (t) => byType.get(t) || { id: null, type: t, clientId: '', issuer: '', scopes: [], status: 'disabled', hasSecret: false, callbackUrl: await buildCallbackUrl(t) }));

  return NextResponse.json({ ok: true, providers: enriched });
}

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    // ignore JSON parse errors
  }
  const parsed = upsertSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.issues }, { status: 400 });
  const data: any = parsed.data;

  if ((data.type === 'microsoft' || data.type === 'oidc_generic')) {
    if (!data.issuer) return NextResponse.json({ error: 'validation_error', details: [{ path: ['issuer'], message: 'issuer is required for microsoft and oidc_generic' }] }, { status: 400 });
  }
  if (data.type === 'google') {
    if (!data.clientId.endsWith('.apps.googleusercontent.com')) {
      // soft warning only
    }
  }

  // Optional: validate issuer discovery for microsoft/oidc
  if (data.issuer && (data.type === 'microsoft' || data.type === 'oidc_generic')) {
    try {
      const wellKnown = data.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration';
      const resp = await fetch(wellKnown, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) return NextResponse.json({ error: 'invalid_issuer', message: 'Could not fetch discovery document' }, { status: 400 });
      const json = await resp.json();
      if (!json || typeof json.authorization_endpoint !== 'string' || typeof json.token_endpoint !== 'string') {
        return NextResponse.json({ error: 'invalid_issuer', message: 'Issuer missing required OIDC endpoints' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'invalid_issuer', message: 'Failed to validate issuer' }, { status: 400 });
    }
  }

  const scopes = Array.isArray(data.scopes) ? data.scopes : (typeof data.scopes === 'string' ? data.scopes.split(/\s+/).filter(Boolean) : []);

  const existing = await (prisma as any).identityProvider.findFirst({ where: { tenantId: tenant.id, type: data.type } });
  const secretEnc = (data.clientSecret && data.clientSecret.trim() !== '') ? encryptSecret(data.clientSecret) : null;

  if (!existing) {
    // Require client secret on create to avoid storing unusable placeholder values
    if (!secretEnc) {
      return NextResponse.json(
        { error: 'validation_error', details: [{ path: ['clientSecret'], message: 'clientSecret is required when creating a provider' }] },
        { status: 400 },
      );
    }
    // Create new provider
    const created = await (prisma as any).identityProvider.create({
      data: {
        tenantId: tenant.id,
        type: data.type,
        clientId: data.clientId,
        clientSecretEnc: secretEnc,
        issuer: data.issuer || '',
        scopes: scopes.length > 0 ? scopes : ['openid', 'email', 'profile'],
        status: data.status || 'disabled',
      },
    });
    await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: `admin.idp.create.${data.type}`, ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null, userAgent: req.headers.get('user-agent') || null } });
    return NextResponse.json({ ok: true, id: created.id });
  }

  // Update existing
  const newIssuer = (data.issuer !== undefined && data.issuer !== '') ? data.issuer : existing.issuer;
  const needsIssuer = data.type === 'microsoft' || data.type === 'oidc_generic';
  if (needsIssuer && !newIssuer) {
    return NextResponse.json({ error: 'validation_error', details: [{ path: ['issuer'], message: 'issuer cannot be removed for microsoft/oidc_generic' }] }, { status: 400 });
  }
  const updateData: any = { clientId: data.clientId, issuer: newIssuer, scopes: scopes.length > 0 ? scopes : existing.scopes };
  if (secretEnc) updateData.clientSecretEnc = secretEnc;
  if (data.status) updateData.status = data.status;

  await (prisma as any).identityProvider.update({ where: { id: existing.id }, data: updateData });
  await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: `admin.idp.update.${data.type}`, ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null, userAgent: req.headers.get('user-agent') || null } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

  let payload: any = {};
  try { payload = await req.json(); } catch {}
  const parsed = z.object({ type: typeSchema, status: z.enum(['enabled', 'disabled']) }).safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.issues }, { status: 400 });
  const { type, status } = parsed.data;

  const existing = await (prisma as any).identityProvider.findFirst({ where: { tenantId: tenant.id, type } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Prevent enabling incomplete providers
  if (status === 'enabled') {
    let hasSecret = false;
    let secretPlain = '';
    try {
      secretPlain = existing.clientSecretEnc ? decryptSecret(existing.clientSecretEnc as any) : '';
      hasSecret = !!secretPlain && secretPlain !== 'placeholder';
    } catch {
      hasSecret = false;
    }
    const needsIssuer = type === 'microsoft' || type === 'oidc_generic';
    const complete = !!existing.clientId && hasSecret && (!needsIssuer || !!existing.issuer);
    if (!complete) {
      return NextResponse.json({ error: 'incomplete_config', message: 'Cannot enable provider until client id, secret, and required issuer are configured' }, { status: 400 });
    }
  }

  await (prisma as any).identityProvider.update({ where: { id: existing.id }, data: { status } });
  await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: `admin.idp.${status}.${type}`, ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null, userAgent: req.headers.get('user-agent') || null } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });
  if (!isAdminRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });

  let payload: any = {};
  try { payload = await req.json(); } catch {}
  const parsed = z.object({ type: typeSchema }).safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.issues }, { status: 400 });

  const { type } = parsed.data;
  const existing = await (prisma as any).identityProvider.findFirst({ where: { tenantId: tenant.id, type } });
  if (!existing) return NextResponse.json({ ok: true });

  // Safeguards: do not allow deleting enabled providers or providers with linked identities
  if (existing.status === 'enabled') {
    return NextResponse.json({ error: 'forbidden', message: 'Disable the provider before deletion' }, { status: 400 });
  }
  const linkCount = await (prisma as any).externalIdentity.count({ where: { providerId: existing.id } });
  if (linkCount > 0) {
    return NextResponse.json({ error: 'forbidden', message: `Cannot delete provider with ${linkCount} linked identities` }, { status: 400 });
  }

  await (prisma as any).identityProvider.delete({ where: { id: existing.id } });
  await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: `admin.idp.delete.${type}`, ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null, userAgent: req.headers.get('user-agent') || null } });
  return NextResponse.json({ ok: true });
}
