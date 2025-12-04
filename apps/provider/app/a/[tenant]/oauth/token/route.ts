import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { prisma } from '@/lib/prisma';
import { getAuthCodeMeta, consumeAuthCodeMeta, newToken } from '@/services/authz';
import { signAccessToken, signIdToken } from '@/services/tokens';
import { buildTokenRateLimitKeys, rateLimitTake, getTokenRateLimitConfig } from '@/services/ratelimit';
import { tenantClientRepo, tenantAuditRepo, verifyTenantOwnership } from '@/lib/tenant-repo';
import { logger } from '@/utils/logger';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';

function oidcError(error: string, description?: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status });
}

function parseBasicAuth(header: string | null): { clientId: string | null; clientSecret: string | null } {
  if (!header) return { clientId: null, clientSecret: null };
  const m = /^Basic\s+(.+)$/i.exec(header);
  if (!m) return { clientId: null, clientSecret: null };
  try {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return { clientId: null, clientSecret: null };
    const id = decoded.slice(0, idx);
    const secret = decoded.slice(idx + 1);
    return { clientId: id, clientSecret: secret };
  } catch (e) {
    console.error('Failed to parse basic auth header', e);
    return { clientId: null, clientSecret: null };
  }
}

function verifyPkce(verifier: string, challenge: string, method: 'S256' | 'plain'): boolean {
  if (method === 'plain') return verifier === challenge;
  const h = createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return h === challenge;
}

/**
 * Handles OAuth2/OpenID Connect token exchange requests for a tenant-scoped client.
 *
 * Accepts form-encoded requests and processes the `authorization_code` and `refresh_token` grant types, performing tenant resolution, client authentication (including PKCE verification for authorization codes and confidential client secret checks), rate limiting, session/refresh-token creation or rotation, token signing (access and ID tokens), audit logging, and error responses per the OIDC/OAuth2 flow.
 *
 * @param req - The incoming NextRequest containing headers and form data (`grant_type`, and grant-specific fields).
 * @returns A JSON HTTP response containing either issued tokens and their metadata (`token_type`, `access_token`, `expires_in`, `id_token`, `refresh_token`, `scope`) on success, or an error object (`error`, `error_description`) with an appropriate HTTP status on failure.
 */
export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return oidcError('invalid_request', 'missing tenant');

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return oidcError('invalid_request', 'unknown tenant');

  const auth = parseBasicAuth(req.headers.get('authorization'));
  const form = await req.formData();
  const grantType = String(form.get('grant_type') || '');

  const clientIdParam = form.get('client_id') ? String(form.get('client_id')) : null;
  const clientSecretParam = form.get('client_secret') ? String(form.get('client_secret')) : null;
  const clientId = auth.clientId || clientIdParam;
  const clientSecret = auth.clientSecret || clientSecretParam;

  const ip = (req.ip as string | null) || req.headers.get('x-forwarded-for') || 'unknown';
  const rlCfg = getTokenRateLimitConfig(tenantSlug, clientId);
  const rlKeys = buildTokenRateLimitKeys({ tenant: tenantSlug, clientId, ip });
  const ipLimit = await rateLimitTake(rlKeys.byIp, rlCfg.ipLimit, rlCfg.windowMs);
  if (!ipLimit.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  if (!clientId) return oidcError('invalid_client', 'missing client_id');
  
  // Use tenant repository for client lookup with automatic tenant isolation
  const client = await tenantClientRepo.findUnique(tenant.id, clientId);
  if (!client) {
    logger.warn('Client not found', { tenantSlug, clientId, ip });
    return oidcError('unauthorized_client', 'client not found');
  }

  const clientLimit = await rateLimitTake(rlKeys.byClient, rlCfg.clientLimit, rlCfg.windowMs);
  if (!clientLimit.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  // For confidential clients require authentication
  const isConfidential = !!client.clientSecret;
  if (isConfidential) {
    const provided = clientSecret;
    if (!provided || provided !== client.clientSecret) return oidcError('invalid_client', 'invalid client credentials');
  }

  if (grantType === 'authorization_code') {
    const schema = z.object({
      grant_type: z.literal('authorization_code'),
      code: z.string().min(20),
      redirect_uri: z.string().url(),
      code_verifier: z.string().min(43).max(128),
    });
    const parse = schema.safeParse({
      grant_type: grantType,
      code: String(form.get('code') || ''),
      redirect_uri: String(form.get('redirect_uri') || ''),
      code_verifier: String(form.get('code_verifier') || ''),
    });
    if (!parse.success) return oidcError('invalid_request', 'invalid parameters');

    const code = parse.data.code;
    const codeRow = await (prisma as any).authCode.findUnique({ where: { code } });
    if (!codeRow || codeRow.tenantId !== tenant.id) return oidcError('invalid_grant', 'invalid code');
    if (new Date(codeRow.expiresAt).getTime() <= Date.now()) return oidcError('invalid_grant', 'code expired');
    if (codeRow.clientId !== client.id) return oidcError('invalid_grant', 'code was not issued to this client');
    if (codeRow.redirectUri !== parse.data.redirect_uri) return oidcError('invalid_grant', 'redirect_uri mismatch');
    if (!codeRow.userId) return oidcError('invalid_grant', 'user not authenticated');

    // Strict PKCE: require matching challenge
    const meta = getAuthCodeMeta(code);
    if (!meta || !meta.codeChallenge || !meta.codeChallengeMethod) {
      return oidcError('invalid_grant', 'pkce_required');
    }
    const ok = verifyPkce(parse.data.code_verifier, meta.codeChallenge, meta.codeChallengeMethod);
    if (!ok) return oidcError('invalid_grant', 'pkce_verification_failed');

    // Single-use: delete code
    await (prisma as any).authCode.delete({ where: { code } }).catch((e: any) => {
      try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {}
      console.error('Failed to delete auth code', e);
    });
    consumeAuthCodeMeta(code);

    // Create session and refresh token
    const sessionTtlDays = 30;
    const session = await (prisma as any).session.create({
      data: {
        tenantId: tenant.id,
        userId: codeRow.userId,
        expiresAt: new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000),
      },
    });
    const refreshTtlDays = 30;
    const rt = newToken();
    const refresh = await (prisma as any).refreshToken.create({
      data: {
        tenantId: tenant.id,
        token: rt,
        sessionId: session.id,
        clientId: client.id,
        expiresAt: new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000),
      },
    });

    const scope = (codeRow.scope as string | null) || 'openid';
    const at = await signAccessToken({ tenantId: tenant.id, sub: codeRow.userId, clientId: client.clientId, scope });
    const idt = await signIdToken({ tenantId: tenant.id, sub: codeRow.userId, clientId: client.clientId, nonce: meta.nonce, authTime: meta.authTime || Math.floor(Date.now() / 1000) });

    // Persist granted scope bound to this refresh token (in-memory)
    try {
      const { setRefreshMeta } = await import('@/services/authz');
      setRefreshMeta(refresh.token, scope);
    } catch (e) {
      console.error('Failed to persist refresh meta', e);
    }

    // Log token exchange with tenant context
    await tenantAuditRepo.create(tenant.id, {
      userId: codeRow.userId,
      action: 'token.exchange',
      ip: ip || null,
      userAgent: req.headers.get('user-agent') || null,
    });

    return NextResponse.json({
      token_type: 'Bearer',
      access_token: at.token,
      expires_in: Math.max(1, at.exp - Math.floor(Date.now() / 1000)),
      id_token: idt.token,
      refresh_token: refresh.token,
      scope,
    });
  }

  if (grantType === 'refresh_token') {
    const schema = z.object({ grant_type: z.literal('refresh_token'), refresh_token: z.string().min(20) });
    const parse = schema.safeParse({ grant_type: grantType, refresh_token: String(form.get('refresh_token') || '') });
    if (!parse.success) return oidcError('invalid_request', 'invalid parameters');

    const rt = await prisma.refreshToken.findUnique({ where: { token: parse.data.refresh_token } });
    if (!rt || rt.tenantId !== tenant.id) {
      logger.warn('Invalid refresh token attempt', { tenantSlug, ip });
      return oidcError('invalid_grant', 'invalid refresh_token');
    }

    // Verify client binding
    if (rt.clientId !== client.id) {
      logger.warn('Refresh token client mismatch', { tenantSlug, clientId, tokenClientId: rt.clientId });
      return oidcError('invalid_client', 'refresh token not issued to this client');
    }

    if (rt.revoked) {
      // Reuse detected => revoke session
      await (prisma as any).refreshToken.updateMany({ where: { sessionId: rt.sessionId }, data: { revoked: true } });
      await (prisma as any).session.update({ where: { id: rt.sessionId }, data: { expiresAt: new Date() } }).catch((e: any) => {
        console.error('Failed to expire session after reuse detection', e);
      });
      await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: null, action: 'token.reuse_detected', ip: ip || null, userAgent: req.headers.get('user-agent') || null } });
      return oidcError('invalid_grant', 'refresh token reuse detected');
    }

    if (new Date(rt.expiresAt).getTime() <= Date.now()) return oidcError('invalid_grant', 'refresh token expired');

    // load session + user
    const session = await (prisma as any).session.findUnique({ where: { id: rt.sessionId } });
    if (!session) return oidcError('invalid_grant', 'session not found');

    // rotate token
    await (prisma as any).refreshToken.update({ where: { id: rt.id }, data: { revoked: true } });
    const newRt = newToken();
    const created = await (prisma as any).refreshToken.create({
      data: {
        tenantId: tenant.id,
        token: newRt,
        sessionId: session.id,
        clientId: client.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Issue new tokens
    // obtain userId from session
    const userId = session.userId;
    // Preserve original granted scope per RFC 6749 Section 6
    let scope = 'openid';
    try {
      const { getRefreshMeta, setRefreshMeta } = await import('@/services/authz');
      const meta = getRefreshMeta(parse.data.refresh_token);
      if (meta && meta.scope) scope = meta.scope;
      // Persist the same scope bound to the rotated refresh token
      setRefreshMeta(created.token, scope);
    } catch (e) {
      console.error('Failed to handle refresh meta', e);
    }
    const at = await signAccessToken({ tenantId: tenant.id, sub: userId, clientId: client.clientId, scope });
    const idt = await signIdToken({ tenantId: tenant.id, sub: userId, clientId: client.clientId, authTime: Math.floor(new Date(session.createdAt).getTime() / 1000) });

    // Log token refresh with tenant context
    await tenantAuditRepo.create(tenant.id, {
      userId,
      action: 'token.refresh',
      ip: ip || null,
      userAgent: req.headers.get('user-agent') || null,
    });

    return NextResponse.json({
      token_type: 'Bearer',
      access_token: at.token,
      expires_in: Math.max(1, at.exp - Math.floor(Date.now() / 1000)),
      id_token: idt.token,
      refresh_token: created.token,
      scope,
    });
  }

  return oidcError('unsupported_grant_type', 'unsupported grant_type');
}