import { NextRequest, NextResponse } from 'next/server';
import { consumeMagicToken, getPending, publishSSE, setPendingUser, completePending, scopesFromString, serializeParams } from '@/services/authz';
import type { PendingAuthRequest } from '@/services/authz';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug, getActivePrivateJwk } from '@/services/jwks';
import { prisma } from '@/lib/prisma';
import { SignJWT, importJWK } from 'jose';
import { getIssuerURL } from '@/utils/issuer';
import { randomBytes } from 'node:crypto';
import { startFlowRun, resumeFlow, type FlowRequestContext, type FlowPromptSubmission } from '@/services/flows';
import type { FlowPromptDescriptor } from '@/types/flows';

export const runtime = 'nodejs';

function html(body: string, status = 200, headExtras = '') {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Sign in</title>${headExtras}<style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica,Arial,sans-serif;background:#f8fafc;color:#0f172a;padding:24px;max-width:720px;margin:0 auto}
      .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:24px 0;box-shadow:0 10px 25px rgba(15,23,42,.08)}
      h1{margin-bottom:8px}
      label{display:block;font-size:14px;font-weight:600;margin-bottom:6px}
      input,select,textarea{width:100%;padding:10px 12px;border:1px solid #cbd5f5;border-radius:8px;font:inherit}
      textarea{min-height:96px}
      button{appearance:none;border:none;border-radius:9999px;padding:10px 18px;font-weight:600;cursor:pointer}
      .actions{display:flex;gap:12px;margin-top:16px;flex-wrap:wrap}
      .primary{background:#4f46e5;color:#fff}
      .secondary{background:#e2e8f0;color:#0f172a}
      .danger{background:#ef4444;color:#fff}
      .error{margin-top:16px;padding:10px 14px;border-radius:8px;background:#fee2e2;color:#b91c1c}
      .badge{display:inline-flex;align-items:center;border-radius:9999px;padding:2px 10px;background:#eef2ff;color:#3730a3;font-size:12px;font-weight:600}
      .field{margin-bottom:16px}
    </style></head><body>${body}</body></html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  );
}

function buildRequestContext(req: NextRequest): FlowRequestContext {
  const headers: Record<string, string> = {};
  const ALLOWED_HEADERS = ['user-agent', 'accept-language', 'referer', 'origin'];
  req.headers.forEach((value, key) => {
    if (ALLOWED_HEADERS.includes(key.toLowerCase())) {
      headers[key] = value;
    }
  });
  return {
    ip: (req.ip as string | null) || req.headers.get('x-forwarded-for') || null,
    userAgent: req.headers.get('user-agent'),
    headers,
  };
}

type PromptPageProps = {
  prompt: FlowPromptDescriptor;
  resumeToken: string;
  runId: string;
};

function renderFlowPromptPage(props: PromptPageProps) {
  const { prompt, resumeToken, runId } = props;
  const schema = prompt.schema;
  const headExtras = prompt.variant === 'captcha'
    ? prompt.meta?.captchaProvider === 'hcaptcha'
      ? '<script src="https://hcaptcha.com/1/api.js" async defer></script>'
      : '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';

  const errorBlock = prompt.error ? `<div class="error">${prompt.error}</div>` : '';
  const fieldBlock = schema.fields.length > 0 ? schema.fields.map(renderField).join('') : '';
  const captchaBlock = prompt.variant === 'captcha' ? renderCaptcha(prompt) : '';
  const actions = renderActions(schema);

  const body = `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div>
        <p class="badge">${prompt.flowName}</p>
        <h1>${prompt.title}</h1>
        ${prompt.description ? `<p>${prompt.description}</p>` : ''}
      </div>
    </div>
    ${errorBlock}
    <form method="POST" style="margin-top:16px">
      <input type="hidden" name="flow_run_id" value="${runId}" />
      <input type="hidden" name="flow_resume_token" value="${resumeToken}" />
      ${fieldBlock}
      ${captchaBlock}
      <div class="actions">${actions}</div>
    </form>
  </div>`;

  return html(body, 200, headExtras);
}

function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderField(field: PromptSchemaField) {
  const id = escapeHtml(field.id);
  const label = escapeHtml(field.label);
  const placeholder = escapeHtml(field.placeholder);
  const helper = field.helperText ? `<p style="font-size:13px;color:#64748b;margin:4px 0 0">${escapeHtml(field.helperText)}</p>` : '';
  const base = `<div class="field"><label for="${id}">${label}${field.required ? ' *' : ''}</label>`;
  if (field.type === 'textarea') {
    return `${base}<textarea id="${field.id}" name="${field.id}" ${field.required ? 'required' : ''} placeholder="${field.placeholder ?? ''}"></textarea>${helper}</div>`;
  }
  if (field.type === 'select') {
    const options = (field.options ?? []).map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join('');
    return `${base}<select id="${field.id}" name="${field.id}" ${field.required ? 'required' : ''}>${options}</select>${helper}</div>`;
  }
  if (field.type === 'checkbox') {
    return `<div class="field"><label style="display:flex;align-items:center;gap:8px;font-weight:500"><input type="checkbox" name="${field.id}" value="1" ${field.required ? 'required' : ''}/> ${field.label}</label>${helper}</div>`;
  }
  const inputType = field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text';
  return `${base}<input id="${field.id}" name="${field.id}" type="${inputType}" ${field.required ? 'required' : ''} placeholder="${field.placeholder ?? ''}" />${helper}</div>`;
}

type PromptSchemaField = NonNullable<FlowPromptDescriptor['schema']['fields']>[number];

type PromptSchemaConfig = FlowPromptDescriptor['schema'];

function renderActions(schema: PromptSchemaConfig) {
  const actions = schema.actions && schema.actions.length > 0
    ? schema.actions
    : [
        {
          id: 'continue',
          label: schema.submitLabel || 'Continue',
          variant: 'primary' as const,
        },
      ];
  const cancelLabel = schema.cancelLabel;
  const cancelButton = cancelLabel
    ? `<button class="secondary" name="flow_action" value="cancel" type="submit">${cancelLabel}</button>`
    : '';
  const primary = actions
    .map((action) => `<button class="${action.variant ?? 'primary'}" name="flow_action" value="${action.id}" type="submit">${action.label}</button>`)
    .join('');
  return primary + cancelButton;
}

function renderCaptcha(prompt: FlowPromptDescriptor) {
  const provider = prompt.meta?.captchaProvider;
  const siteKey = prompt.meta?.siteKey;
  if (!provider || !siteKey) {
    return '<div class="error">Captcha is not configured for this tenant.</div>';
  }
  if (provider === 'hcaptcha') {
    return `<div class="field"><div class="h-captcha" data-sitekey="${siteKey}"></div></div>`;
  }
  return `<div class="field"><div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="auto"></div></div>`;
}

function collectSubmission(form: FormData): FlowPromptSubmission {
  const action = String(form.get('flow_action') || 'submit');
  const fields: Record<string, string | null> = {};
  for (const [key, value] of form.entries()) {
    if (key === 'flow_run_id' || key === 'flow_resume_token' || key === 'flow_action') continue;
    fields[key] = typeof value === 'string' ? value : value?.toString() ?? '';
  }
  return { action, fields };
}

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return html('<h1>Error</h1><p>missing tenant</p>', 400);
  const token = req.nextUrl.searchParams.get('token') || '';

  const mt = await consumeMagicToken(token);
  if (!mt || mt.tenantSlug !== tenantSlug) return html('<h1>Invalid or expired link</h1>', 400);

  const pending = await getPending(mt.rid);
  if (!pending) return html('<h1>Your login session has expired. Please try again.</h1>', 400);

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return html('<h1>Unknown tenant</h1>', 400);

  let user = await (prisma as any).user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: mt.email } } });
  if (!user) {
    user = await (prisma as any).user.create({ data: { tenantId: tenant.id, email: mt.email, name: null } });
  }

  await setPendingUser(pending.rid, user.id);

  await (prisma as any).audit.create({ data: { tenantId: tenant.id, userId: user.id, action: 'login.magic', ip: req.ip || null, userAgent: req.headers.get('user-agent') || null } });

  const flowResult = await startFlowRun({
    tenantId: tenant.id,
    tenantSlug,
    trigger: 'signin',
    pending,
    user,
    request: buildRequestContext(req),
  });

  if (flowResult.type === 'prompt') {
    return renderFlowPromptPage({ prompt: flowResult.prompt, resumeToken: flowResult.resumeToken, runId: flowResult.runId });
  }
  if (flowResult.type === 'error') {
    return html(`<h1>Flow error</h1><p>${flowResult.message}</p>`, 500);
  }

  return finalizeAuthorization({ req, tenant, pending, user });
}

export async function POST(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return html('<h1>Error</h1><p>missing tenant</p>', 400);
  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return html('<h1>Unknown tenant</h1>', 400);

  const form = await req.formData();
  const runId = String(form.get('flow_run_id') || '');
  const resumeToken = String(form.get('flow_resume_token') || '');
  if (!runId || !resumeToken) {
    return html('<h1>Invalid flow submission</h1>', 400);
  }
  const submission = collectSubmission(form);
  const flowResult = await resumeFlow({
    tenantId: tenant.id,
    tenantSlug,
    runId,
    resumeToken,
    submission,
    request: buildRequestContext(req),
  });

  if (flowResult.type === 'prompt') {
    return renderFlowPromptPage({ prompt: flowResult.prompt, resumeToken: flowResult.resumeToken, runId: flowResult.runId });
  }
  if (flowResult.type === 'error') {
    return html(`<h1>Flow error</h1><p>${flowResult.message}</p>`, 400);
  }
  if (flowResult.type !== 'success') {
    return html('<h1>Flow is not available for this request.</h1>', 400);
  }

  const flowContext = flowResult.context;
  const pending = await getPending(flowContext.pending.rid);
  if (!pending) return html('<h1>Your login session has expired. Please try again.</h1>', 400);

  const user = await (prisma as any).user.findUnique({ where: { id: flowContext.user.id } });
  if (!user) return html('<h1>User could not be loaded.</h1>', 400);

  return finalizeAuthorization({ req, tenant, pending, user });
}

async function finalizeAuthorization(params: {
  req: NextRequest;
  tenant: { id: string };
  pending: PendingAuthRequest;
  user: { id: string };
}) {
  const { req, tenant, pending, user } = params;
  const scopes = scopesFromString(pending.scope);
  let needsConsent = true;
  if (scopes.length === 0 || !pending.scope || pending.scope.trim() === '') needsConsent = false;

  const client = await (prisma as any).client.findUnique({ where: { id: pending.clientDbId } });
  if (client && client.firstParty) needsConsent = false;

  const existing = await (prisma as any).consent.findUnique({ where: { tenantId_userId_clientId: { tenantId: tenant.id, userId: user.id, clientId: pending.clientDbId } } });
  if (existing) {
    const currentScopes: string[] = (existing.scopes || []) as any;
    const missing = scopes.filter((s) => !currentScopes.includes(s));
    if (missing.length === 0) needsConsent = false;
  }

  if (needsConsent) {
    await publishSSE(pending.rid, 'consentRequired', { rid: pending.rid });
    return html('<h1>Continue on your original device to grant consent.</h1><p>You can close this page.</p>');
  }

  const { redirect, handoff } = await issueCodeAndBuildRedirect({ pending, userId: user.id });
  await publishSSE(pending.rid, 'loginComplete', { redirect, handoff });
  await completePending(pending.rid);
  return html(`<h1>Signed in</h1><p>You may now return to your original device.</p><p><a href="${redirect}">Continue</a></p>`);
}

async function issueCodeAndBuildRedirect(params: { pending: PendingAuthRequest; userId: string }) {
  const { pending, userId } = params;
  const code = randomUrlSafe(32);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await (prisma as any).authCode.create({
    data: {
      tenantId: pending.tenantId,
      code,
      clientId: pending.clientDbId,
      userId,
      redirectUri: pending.redirectUri,
      scope: pending.scope,
      expiresAt,
    },
  });
  try {
    const { recordAuthCodeMeta } = await import('@/services/authz');
    recordAuthCodeMeta(code, {
      nonce: pending.nonce,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      authTime: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {}
  }

  const qp = serializeParams({ code, state: pending.state });
  const redirect = pending.redirectUri + qp;

  const priv = await getActivePrivateJwk(pending.tenantId);
  let handoff: string | null = null;
  if (priv) {
    try {
      const key = await importJWK(priv as any, 'RS256');
      const issuer = getIssuerURL();
      handoff = await new SignJWT({ sub: userId, rid: pending.rid, aud: pending.clientId })
        .setProtectedHeader({ alg: 'RS256', kid: (priv as any).kid })
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime('2m')
        .sign(key);
    } catch {
      handoff = null;
    }
  }

  return { redirect, code, handoff };
}

function randomUrlSafe(n: number) {
  const buf = randomBytes(n);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
