import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant';
import { findTenantBySlug } from '@/services/jwks';
import { createPendingAuthRequest, findClient, serializeParams } from '@/services/authz';

/**
 * Build a minimal HTML NextResponse containing the provided HTML body.
 *
 * @param body - HTML content inserted into the <body> of the document
 * @param status - HTTP status code for the response (defaults to 200)
 * @param headers - Additional response headers to merge; `Content-Type` is set to `text/html; charset=utf-8` and preserved
 * @returns A NextResponse whose body is a complete HTML document with the given content and headers applied
 */
function html(body: string, status = 200, headers?: HeadersInit) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Authorize</title><style>
      :root{--bg:#ffffff;--fg:#0f172a;--muted:#475569;--border:#e2e8f0;--brand:#4f46e5;--btn-bg:#0f172a;--btn-fg:#ffffff}
      @media (prefers-color-scheme: dark){
        :root{--bg:#0b1220;--fg:#e2e8f0;--muted:#94a3b8;--border:#1f2a44;--btn-bg:#e2e8f0;--btn-fg:#0b1220}
      }
      *{box-sizing:border-box}
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg);padding:24px;max-width:720px;margin:0 auto}
      header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
      .logo{width:32px;height:32px;border-radius:6px;background:var(--brand);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700}
      h1{font-size:20px;margin:0}
      .card{border:1px solid var(--border);border-radius:12px;padding:16px;margin:16px 0;background:transparent}
      .row{display:flex;gap:8px;align-items:center}
      .stack{display:flex;flex-direction:column;gap:8px}
      .providers{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
      button{appearance:none;border:1px solid var(--border);background:var(--btn-bg);color:var(--btn-fg);padding:10px 12px;border-radius:8px;cursor:pointer}
      button.secondary{background:transparent;color:var(--fg)}
      button[disabled]{opacity:.6;cursor:not-allowed}
      input[type=email]{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--fg)}
      label{font-size:14px;color:var(--muted)}
      code{background:rgba(148,163,184,.15);border-radius:4px;padding:2px 4px}
      .alert{border:1px solid var(--border);padding:10px;border-radius:8px;background:rgba(79,70,229,.08)}
      .spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--brand);border-radius:50%;animation:spin 1s linear infinite}
      @keyframes spin{to{transform:rotate(360deg)}}
    </style></head><body>${body}</body></html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...(headers || {}) },
    },
  );
}

function oidcErrorRedirect(redirectUri: string, params: { error: string; error_description?: string; state?: string }) {
  const qp = serializeParams(params);
  return NextResponse.redirect(redirectUri + qp);
}

function oidcErrorJson(params: { error: string; error_description?: string }) {
  return NextResponse.json(params, { status: 400 });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const authorizeQuerySchema = z.object({
  response_type: z.literal('code', {
    errorMap: () => ({ message: 'response_type must be code' }),
  }),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  scope: z.string().optional(),
  state: z.string().optional(),
  nonce: z.string().optional(),
  code_challenge: z.string().min(43).max(128).optional(),
  code_challenge_method: z.enum(['S256', 'plain']).optional(),
});

/**
 * Handle OpenID Connect authorization GET requests for the /authorize endpoint.
 *
 * Validates the authorization request query, resolves tenant and client, enforces the registered redirect URI,
 * optionally records PKCE data, creates a pending authorization request, and returns either an OIDC error JSON
 * response for invalid requests or an HTML authorization page that initiates magic-link and Server-Sent Events (SSE)
 * flows. The HTML response includes a nonce-based Content-Security-Policy header.
 *
 * @param req - The incoming Next.js request containing the authorization query parameters
 * @returns A NextResponse containing either an OIDC error JSON payload with an appropriate HTTP status or an HTML
 * authorization page with a CSP header that drives the magic-link and consent flows
 */
export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) return NextResponse.json({ error: 'missing tenant' }, { status: 400 });

  const usp = req.nextUrl.searchParams;
  const parse = authorizeQuerySchema.safeParse(Object.fromEntries(usp.entries()));
  if (!parse.success) {
    // Cannot rely on redirect_uri safely if parsing failed; return JSON per OIDC
    return oidcErrorJson({ error: 'invalid_request', error_description: parse.error.issues.map((i) => i.message).join(', ') });
  }
  const q = parse.data;

  const tenant = await findTenantBySlug(tenantSlug);
  if (!tenant) return oidcErrorJson({ error: 'invalid_request', error_description: 'unknown tenant' });

  const client = await findClient(tenant.id, q.client_id);
  if (!client) return oidcErrorJson({ error: 'unauthorized_client', error_description: 'client not found' });

  // Validate redirect URI must exactly match one of the registered URIs
  const validRedirect = client.redirectUris.includes(q.redirect_uri);
  if (!validRedirect) return oidcErrorJson({ error: 'invalid_request', error_description: 'redirect_uri not registered for client' });

  // PKCE: allow optional, but if provided, method defaults to S256
  let codeChallenge: string | null = null;
  let codeChallengeMethod: 'S256' | 'plain' | null = null;
  if (q.code_challenge) {
    codeChallenge = q.code_challenge;
    codeChallengeMethod = (q.code_challenge_method as 'S256' | 'plain') ?? 'S256';
  }

  const pending = await createPendingAuthRequest({
    tenantId: tenant.id,
    tenantSlug,
    clientDbId: client.id,
    clientId: client.clientId,
    clientName: client.name,
    redirectUri: q.redirect_uri,
    scope: q.scope ?? null,
    state: q.state ?? null,
    nonce: q.nonce ?? null,
    codeChallenge,
    codeChallengeMethod,
  });

  // Render a minimal login UI with magic + enchanted link channel (rid)
  const scopeList = (q.scope ?? 'openid').split(' ').filter(Boolean);
  const scopes = scopeList.map(escapeHtml).join(', ');

  // Providers enabled for this tenant (per-tenant config via DB, with optional env fallback SSO_PROVIDERS)
  const envProviders = (process.env.SSO_PROVIDERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Intentionally using dynamic import to avoid bundling Prisma in edge runtime for this route.
  const dbProviders: string[] = (await (await import('@/services/idp')).getEnabledProviderTypesForTenant(tenant.id)).map((s) => s.toLowerCase());
  const supported = ['google', 'microsoft', 'github'];
  const enabledProviders = Array.from(new Set([...supported.filter((p) => envProviders.includes(p)), ...supported.filter((p) => dbProviders.includes(p))]));
  const providerButtons = enabledProviders
    .map((p) => {
      const label = p === 'google' ? 'Google' : p === 'microsoft' ? 'Microsoft' : 'GitHub';
      const icon = p === 'google'
        ? '<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12 s5.373-12,12-12c3.059,0,5.842,1.154,7.957,3.043l5.657-5.657C32.163,6.053,28.284,4,24,4C12.955,4,4,12.955,4,24 s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,16.108,18.961,14,24,14c3.059,0,5.842,1.154,7.957,3.043l5.657-5.657 C32.163,6.053,28.284,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.176,0,9.86-1.977,13.409-5.197l-6.191-5.238C29.211,35.091,26.715,36,24,36 c-5.201,0-9.616-3.317-11.276-7.946l-6.51,5.02C9.505,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.093,5.565 c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.237C36.971,39.792,44,35,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>'
        : p === 'microsoft'
        ? '<svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true"><rect width="10" height="10" x="1" y="1" fill="#f25022"/><rect width="10" height="10" x="12" y="1" fill="#7fba00"/><rect width="10" height="10" x="1" y="12" fill="#00a4ef"/><rect width="10" height="10" x="12" y="12" fill="#ffb900"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.73.5.98 5.24.98 11.5c0 4.84 3.14 8.94 7.49 10.39.55.1.76-.24.76-.54 0-.27-.01-1.17-.02-2.12-3.05.66-3.69-1.3-3.69-1.3-.5-1.28-1.22-1.62-1.22-1.62-.99-.67.08-.66.08-.66 1.09.08 1.66 1.12 1.66 1.12.98 1.67 2.57 1.19 3.2.91.1-.71.38-1.19.69-1.46-2.44-.28-5-1.22-5-5.43 0-1.2.43-2.18 1.12-2.95-.11-.28-.49-1.41.11-2.93 0 0 .92-.29 3.02 1.12.87-.24 1.8-.36 2.73-.36.93 0 1.86.12 2.73.36 2.1-1.41 3.02-1.12 3.02-1.12.6 1.52.22 2.65.11 2.93.69.77 1.12 1.75 1.12 2.95 0 4.22-2.57 5.15-5.02 5.43.39.34.74 1.02.74 2.06 0 1.49-.01 2.69-.01 3.06 0 .3.2.65.76.54A10.51 10.51 0 0 0 23 11.5C23 5.24 18.27.5 12 .5z"/></svg>';
      return `<button type=\"button\" class=\"secondary provider\" data-provider=\"${p}\" aria-label=\"Continue with ${label}\"><span style=\"display:inline-flex;gap:8px;align-items:center\">${icon}<span>${label}</span></span></button>`;
    })
    .join('');

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "connect-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
  ].join('; ');

  const escTenant = escapeHtml(tenantSlug);
  const escClientName = escapeHtml(client.name);
  const logoInitial = (tenantSlug.match(/[a-z0-9]/i)?.[0] || '#').toUpperCase();

  const body = `
<header aria-label="Tenant branding">
  <div class="logo" aria-hidden="true">${logoInitial}</div>
  <h1>${escTenant} • Sign in to ${escClientName}</h1>
</header>
<section class="card" role="region" aria-label="Cross-device hint">
  <p>Requesting scopes: <code>${scopes || 'openid'}</code></p>
  <p class="alert" role="status">Open the magic link sent to your email from another device to continue. This page will update automatically.</p>
</section>
<section class="card" aria-labelledby="login-heading">
  <h2 id="login-heading">Send magic link</h2>
  <form id=\"magic-form\" class="stack">
    <label for="email">Email</label>
    <input id="email" type=\"email\" name=\"email\" placeholder=\"you@example.com\" required aria-label="Email address" />
    <input type=\"hidden\" name=\"rid\" value=\"${pending.rid}\" />
    <div class="row">
      <button type=\"submit\" id="send-link">Send link</button>
      <button type=\"button\" id=\"use-passkey\" class="secondary" disabled aria-disabled="true" title="Passkey support coming soon">Use passkey</button>
    </div>
  </form>
  <p id=\"magic-status\" aria-live="polite"></p>
  <div id="sse-wait" class="row" aria-live="polite"><div class="spinner" aria-hidden="true"></div><span>Waiting for sign-in to complete…</span></div>
</section>
<section class="card" id="sso" ${enabledProviders.length > 0 ? '' : 'style="display:none"'} aria-labelledby="sso-heading">
  <h2 id="sso-heading">Or continue with</h2>
  <div class="providers">${providerButtons}</div>
</section>
<section class="card" id=\"consent\" style=\"display:none\" aria-labelledby="consent-heading">
  <h2 id="consent-heading">Consent required</h2>
  <p>The application <strong>${escClientName}</strong> is requesting access to:</p>
  <ul>
    ${scopeList.map((s) => {
      const map: Record<string,string> = { openid: 'Sign you in', email: 'Your email address', profile: 'Your basic profile' };
      const text = map[s] || s;
      return `<li>${escapeHtml(text)}</li>`;
    }).join('')}
  </ul>
  <form id=\"consent-form\">
    <input type=\"hidden\" name=\"rid\" value=\"${pending.rid}\" />
    <label style=\"display:flex;gap:.5rem;align-items:center\"><input type=\"checkbox\" name=\"remember\" value=\"1\" checked /> Remember my choice</label>
    <div style=\"margin-top:8px;display:flex;gap:8px\">
      <button type=\"submit\">Allow</button>
      <button type=\"button\" id=\"deny\" class="secondary">Deny</button>
    </div>
  </form>
  <p id=\"consent-status\" aria-live="polite"></p>
</section>
<script nonce=\"${nonce}\">
  const statusEl = document.getElementById('magic-status');
  const form = document.getElementById('magic-form');
  const sendBtn = document.getElementById('send-link');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = 'Sending...';
    sendBtn.setAttribute('disabled','true');
    try {
      const fd = new FormData(form);
      const res = await fetch('../magic/request', { method: 'POST', body: fd });
      const data = await res.json().catch(()=>({ ok:false }));
      if (res.ok && data.ok) {
        statusEl.textContent = data.message || 'Magic link sent. Check your email.';
        if (data.debug_link) {
          const a = document.createElement('a');
          a.href = data.debug_link; a.textContent = 'Open magic link (debug)'; a.target = '_blank';
          statusEl.appendChild(document.createTextNode(' ')); statusEl.appendChild(a);
        }
      } else {
        statusEl.textContent = data.error || 'Failed to send magic link.';
      }
    } finally {
      sendBtn.removeAttribute('disabled');
    }
  });

  // Consent handlers
  const consentSection = document.getElementById('consent');
  const consentForm = document.getElementById('consent-form');
  const consentStatus = document.getElementById('consent-status');
  const denyBtn = document.getElementById('deny');
  consentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    consentStatus.textContent = 'Processing...';
    const fd = new FormData(consentForm);
    const res = await fetch('./consent', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.redirect) {
      window.location.href = data.redirect;
    } else if (res.status === 400 && data && data.redirect) {
      window.location.href = data.redirect;
    } else {
      consentStatus.textContent = (data && data.error) || 'Failed to grant consent';
    }
  });
  denyBtn.addEventListener('click', async () => {
    const fd = new FormData(consentForm);
    fd.set('deny', '1');
    const res = await fetch('./consent', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.redirect) window.location.href = data.redirect;
  });

  // Provider chooser
  const providerBtns = document.querySelectorAll('button.provider');
  providerBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = btn.getAttribute('data-provider');
      if (!p) return;
      btn.setAttribute('disabled', 'true');
      btn.innerHTML = '<span style="display:inline-flex;gap:8px;align-items:center"><span class="spinner" aria-hidden="true"></span><span>Redirecting…</span></span>';
      const url = new URL('../external/start', window.location.href);
      url.searchParams.set('provider', p);
      url.searchParams.set('rid', '${pending.rid}');
      window.location.href = url.toString();
    });
  });

  // Enchanted link via SSE
  const ev = new EventSource('./sse?rid=${pending.rid}');
  window.addEventListener('beforeunload', () => ev.close());
  ev.addEventListener('loginComplete', (e) => {
    try { const data = JSON.parse(e.data); if (data.redirect) window.location.href = data.redirect; } catch {}
  });
  ev.addEventListener('consentRequired', (e) => {
    consentSection.style.display = 'block';
  });
  ev.onerror = (err) => { /* ignore */ };
</script>
`;

  const res = html(body, 200, { 'Content-Security-Policy': csp });
  return res;
}