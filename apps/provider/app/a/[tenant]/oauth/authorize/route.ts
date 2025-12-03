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
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Authorize</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;padding:24px;max-width:720px;margin:0 auto}header{margin-bottom:16px}code{background:#f5f5f5;border-radius:4px;padding:2px 4px}</style></head><body>${body}</body></html>`,
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
  const scopes = (q.scope ?? 'openid').split(' ').filter(Boolean).join(', ');

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

  const body = `
<header>
  <h1>${tenantSlug} • Sign in to ${client.name}</h1>
</header>
<section>
  <p>Requesting scopes: <code>${scopes || 'openid'}</code></p>
  <p>We have created an enchanted channel for this request. On your phone, open the magic link you receive to continue.</p>
</section>
<section>
  <h2>Send magic link</h2>
  <form id=\"magic-form\">
    <input type=\"email\" name=\"email\" placeholder=\"you@example.com\" required />
    <input type=\"hidden\" name=\"rid\" value=\"${pending.rid}\" />
    <button type=\"submit\">Send link</button>
  </form>
  <p id=\"magic-status\"></p>
</section>
<section id=\"consent\" style=\"display:none\">
  <h2>Consent required</h2>
  <p>This application is requesting access to: <code>${scopes || 'openid'}</code>.</p>
  <form id=\"consent-form\">
    <input type=\"hidden\" name=\"rid\" value=\"${pending.rid}\" />
    <label style=\"display:flex;gap:.5rem;align-items:center\"><input type=\"checkbox\" name=\"remember\" value=\"1\" checked /> Remember my choice</label>
    <div style=\"margin-top:8px;display:flex;gap:8px\">
      <button type=\"submit\">Allow</button>
      <button type=\"button\" id=\"deny\">Deny</button>
    </div>
  </form>
  <p id=\"consent-status\"></p>
</section>
<script nonce=\"${nonce}\">
  const statusEl = document.getElementById('magic-status');
  const form = document.getElementById('magic-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = 'Sending...';
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
    const data = await res.json();
    if (res.ok && data.redirect) {
      window.location.href = data.redirect;
    } else if (res.status === 400 && data.redirect) {
      window.location.href = data.redirect;
    } else {
      consentStatus.textContent = data.error || 'Failed to grant consent';
    }
  });
  denyBtn.addEventListener('click', async () => {
    const fd = new FormData(consentForm);
    fd.set('deny', '1');
    const res = await fetch('./consent', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.redirect) window.location.href = data.redirect;
  });

  // Enchanted link via SSE
  const ev = new EventSource('./sse?rid=${pending.rid}');
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