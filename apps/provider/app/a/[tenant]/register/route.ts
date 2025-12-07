import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { prisma } from '@/lib/prisma';
import { buildRegisterRateLimitKeys, rateLimitTake, getRegisterRateLimitConfig } from '@/services/ratelimit';
import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';

function error(status: number, payload: any) { return NextResponse.json(payload, { status }); }

const schema = z.object({
  client_name: z.string().min(1),
  redirect_uris: z.array(z.string().url()).min(1),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
  token_endpoint_auth_method: z.enum(['client_secret_basic', 'client_secret_post', 'none']).optional(),
});

/**
 * Register a new OAuth/OpenID Connect client for the resolved tenant and return its credentials.
 *
 * @param req - Incoming Next.js request containing the registration JSON body
 * @returns A JSON HTTP response with the created client's credentials and metadata:
 * - `client_id`: the generated client identifier
 * - `client_secret`: the generated client secret, `undefined` when no secret is issued
 * - `client_name`: the client's display name
 * - `redirect_uris`: the registered redirect URIs
 * - `grant_types`: the allowed grant types
 * - `token_endpoint_auth_method`: the token endpoint auth method
 *
 * Error responses are returned for a missing or unknown tenant, rate limiting, invalid JSON, or invalid parameters.
 */
export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return error(400, { error: 'invalid_request', error_description: 'missing tenant' });
  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return error(404, { error: 'invalid_request', error_description: 'unknown tenant' });

  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown') as string | null;
  const keys = buildRegisterRateLimitKeys({ tenant: tenantSlug, ip });
  const cfg = getRegisterRateLimitConfig(tenantSlug);
  const rl = await rateLimitTake(keys.byIp, cfg.ipLimit, cfg.windowMs);
  if (!rl.allowed) return error(429, { error: 'rate_limited' });

  let body: any;
  try { body = await req.json(); } catch { return error(400, { error: 'invalid_request', error_description: 'invalid json' }); }
  const parse = schema.safeParse(body);
  if (!parse.success) return error(400, { error: 'invalid_request', error_description: 'invalid parameters' });
  const inb = parse.data;

  const grantTypes = inb.grant_types ?? ['authorization_code', 'refresh_token'];
  const tokenAuthMethod = inb.token_endpoint_auth_method ?? 'client_secret_basic';

  const clientId = randomBytes(18).toString('base64url');
  const clientSecret = tokenAuthMethod === 'none' ? null : randomBytes(24).toString('base64url');

  const created = await (prisma as any).client.create({
    data: {
      tenantId: tenant.id,
      clientId,
      clientSecret,
      name: inb.client_name,
      redirectUris: inb.redirect_uris,
      grantTypes,
      firstParty: false,
    },
  });

  await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: 'client.register', ip: ip || null, userAgent: req.headers.get('user-agent') || null } });

  return NextResponse.json({
    client_id: created.clientId,
    client_secret: created.clientSecret || undefined,
    client_name: created.name,
    redirect_uris: created.redirectUris,
    grant_types: created.grantTypes,
    token_endpoint_auth_method: tokenAuthMethod,
  });
}