import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { getIssuerURL } from '@/utils/issuer';

export const runtime = 'nodejs';

function html(body: string, status = 200, headers?: HeadersInit) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>SSO Providers</title><style>
      :root{--bg:#ffffff;--fg:#0f172a;--muted:#475569;--border:#e2e8f0;--brand:#4f46e5;--btn-bg:#0f172a;--btn-fg:#ffffff}
      @media (prefers-color-scheme: dark){:root{--bg:#0b1220;--fg:#e2e8f0;--muted:#94a3b8;--border:#1f2a44;--btn-bg:#e2e8f0;--btn-fg:#0b1220}}
      *{box-sizing:border-box}
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg);padding:24px;max-width:960px;margin:0 auto}
      header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
      .logo{width:32px;height:32px;border-radius:6px;background:var(--brand);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700}
      h1{font-size:20px;margin:0}
      .card{border:1px solid var(--border);border-radius:12px;padding:16px;margin:16px 0;background:transparent}
      .row{display:flex;gap:8px;align-items:center}
      .stack{display:flex;flex-direction:column;gap:8px}
      label{font-size:14px;color:var(--muted)}
      input, textarea, select{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--fg)}
      code{background:rgba(148,163,184,.15);border-radius:4px;padding:2px 4px}
      button{appearance:none;border:1px solid var(--border);background:var(--btn-bg);color:var(--btn-fg);padding:10px 12px;border-radius:8px;cursor:pointer}
      button.secondary{background:transparent;color:var(--fg)}
      button[disabled]{opacity:.6;cursor:not-allowed}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
      .status{display:inline-flex;align-items:center;gap:6px}
      .dot{width:10px;height:10px;border-radius:50%}
      .dot.green{background:#16a34a}
      .dot.gray{background:#94a3b8}
      .copy{display:inline-flex;gap:6px;align-items:center}
      .warn{border:1px solid var(--border);padding:10px;border-radius:8px;background:rgba(234,179,8,.12)}
      .ok{border:1px solid var(--border);padding:10px;border-radius:8px;background:rgba(16,185,129,.12)}
      .provider-card{display:flex;flex-direction:column;gap:8px}
    </style></head><body>${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', ...(headers || {}) } },
  );
}

export async function GET() {
  const tenant = getTenant();
  const issuer = getIssuerURL();
  const t = tenant || 'unknown';
  const logoInitial = (t.match(/[a-z0-9]/i)?.[0] || '#').toUpperCase();
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
  <div class="row"><div class="logo">${logoInitial}</div><h1>${t} • SSO connections</h1></div>
  <div class="row"><input id="admin-secret" type="password" placeholder="Admin secret" aria-label="Admin secret"/><button id="save-secret">Use secret</button></div>
</header>
<section class="card">
  <p>Configure external identity providers for this tenant. Changes apply immediately. The callback base for this tenant is <code>${issuer}</code>.</p>
  <p>Providers listed here will appear on the tenant login screen when enabled and properly configured.</p>
</section>
<section id="status" class="card"></section>
<section id="providers" class="grid"></section>

<template id="provider-template">
  <div class="card provider-card">
    <div class="row" style="justify-content:space-between">
      <strong class="title"></strong>
      <span class="status"><span class="dot"></span><span class="status-label"></span></span>
    </div>
    <div class="stack">
      <div class="row" style="justify-content:space-between"><span>Callback URL:</span><span class="copy"><code class="cb"></code><button class="secondary copy-btn">Copy</button></span></div>
      <div class="warn info" style="display:none"></div>
      <details>
        <summary>Configure</summary>
        <div class="stack">
          <label>Client ID<input class="clientId" type="text" placeholder="Client ID"/></label>
          <label>Client secret <small>(leave blank to keep current)</small><input class="clientSecret" type="password" placeholder="Client secret"/></label>
          <label class="issuer-wrap" style="display:none">Issuer / Authority URL<input class="issuer" type="url" placeholder="https://example.com/tenant"/></label>
          <label>Scopes<input class="scopes" type="text" placeholder="openid email profile"/></label>
          <div class="row" style="gap:8px">
            <button class="save">Save</button>
            <button class="test secondary">Test connection</button>
            <button class="toggle"></button>
            <button class="delete secondary">Delete</button>
          </div>
          <p class="result" aria-live="polite"></p>
        </div>
      </details>
    </div>
  </div>
</template>

<script nonce="${nonce}">
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const statusBox = document.getElementById('status');
  const providersEl = document.getElementById('providers');
  const tmpl = document.getElementById('provider-template');
  const secretInput = document.getElementById('admin-secret');
  const saveSecretBtn = document.getElementById('save-secret');

  function getSecret() { return localStorage.getItem('admin_secret') || ''; }
  function setSecret(v) { if (v) localStorage.setItem('admin_secret', v); }
  secretInput.value = getSecret();
  saveSecretBtn.addEventListener('click', () => { setSecret(secretInput.value); load(); });

  const titles = { google: 'Google', microsoft: 'Microsoft', github: 'GitHub', oidc_generic: 'OIDC (Generic)' };

  function computeVisibility(p) {
    const type = p.type;
    const hasClient = !!p.clientId;
    const hasSecret = !!p.hasSecret;
    const hasIssuer = type === 'microsoft' || type === 'oidc_generic' ? !!p.issuer : true;
    const complete = hasClient && hasSecret && hasIssuer;
    const visible = p.status === 'enabled' && complete;
    return { complete, visible };
  }

  async function load() {
    const secret = getSecret();
    statusBox.textContent = 'Loading…';
    providersEl.innerHTML = '';
    try {
      const res = await fetch('./sso/providers', { headers: { 'x-admin-secret': secret } });
      const data = await res.json();
      if (!res.ok) throw new Error(data && data.error || 'Failed to load providers');
      const list = data.providers || [];
      const visible = list.filter(p => computeVisibility(p).visible).map(p => titles[p.type]).join(', ');
      statusBox.innerHTML = visible ? `<div class="ok">Visible on login page: <strong>${visible}</strong></div>` : `<div class="warn">No external providers visible. Enable and configure at least one provider.</div>`;
      list.forEach(p => providersEl.appendChild(renderProvider(p)));
    } catch (e) {
      statusBox.innerHTML = `<div class="warn">${e.message || 'Error loading providers'}</div>`;
    }
  }

  function renderProvider(p) {
    const node = tmpl.content.firstElementChild.cloneNode(true);
    $('.title', node).textContent = titles[p.type] || p.type;
    $('.cb', node).textContent = p.callbackUrl;
    $('.copy-btn', node).addEventListener('click', () => { navigator.clipboard.writeText(p.callbackUrl); });
    const dot = $('.dot', node);
    const statusLabel = $('.status-label', node);
    const info = $('.info', node);
    const { complete, visible } = computeVisibility(p);
    dot.classList.add(p.status === 'enabled' ? 'green' : 'gray');
    statusLabel.textContent = p.status;
    if (!complete) { info.style.display = 'block'; info.textContent = 'Configuration incomplete: ' + (!p.clientId ? 'missing client id' : !p.hasSecret ? 'missing client secret' : (!p.issuer && (p.type === 'microsoft' || p.type === 'oidc_generic')) ? 'missing issuer' : ''); }

    const issuerWrap = $('.issuer-wrap', node);
    const issuerInput = $('.issuer', node);
    if (p.type === 'microsoft' || p.type === 'oidc_generic') { issuerWrap.style.display = 'block'; issuerInput.value = p.issuer || ''; }

    const clientId = $('.clientId', node); clientId.value = p.clientId || '';
    const clientSecret = $('.clientSecret', node); clientSecret.value = '';
    const scopes = $('.scopes', node); scopes.value = (p.scopes || []).join(' ');

    const result = $('.result', node);
    const secret = getSecret();

    $('.save', node).addEventListener('click', async () => {
      result.textContent = 'Saving…';
      try {
        const body = { type: p.type, clientId: clientId.value, clientSecret: clientSecret.value, issuer: issuerInput.value || undefined, scopes: scopes.value };
        const res = await fetch('./sso/providers', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-secret': secret }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data && (data.message || data.error) || 'Save failed');
        result.textContent = 'Saved';
        load();
      } catch (e) { result.textContent = e.message || 'Error'; }
    });

    $('.test', node).addEventListener('click', async () => {
      result.textContent = 'Testing…';
      try {
        const body = { type: p.type, issuer: issuerInput.value || undefined };
        const res = await fetch('./sso/providers/test', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-secret': secret }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data && (data.message || data.error) || 'Test failed');
        result.textContent = 'Connection OK';
      } catch (e) { result.textContent = e.message || 'Error'; }
    });

    const toggle = $('.toggle', node);
    toggle.textContent = p.status === 'enabled' ? 'Disable' : 'Enable';
    toggle.addEventListener('click', async () => {
      result.textContent = 'Updating…';
      try {
        const res = await fetch('./sso/providers', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-admin-secret': secret }, body: JSON.stringify({ type: p.type, status: p.status === 'enabled' ? 'disabled' : 'enabled' }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data && data.error || 'Toggle failed');
        result.textContent = 'Updated';
        load();
      } catch (e) { result.textContent = e.message || 'Error'; }
    });

    $('.delete', node).addEventListener('click', async () => {
      if (!confirm('Delete configuration for ' + (titles[p.type] || p.type) + '?')) return;
      result.textContent = 'Deleting…';
      try {
        const res = await fetch('./sso/providers', { method: 'DELETE', headers: { 'content-type': 'application/json', 'x-admin-secret': secret }, body: JSON.stringify({ type: p.type }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data && data.error || 'Delete failed');
        result.textContent = 'Deleted';
        load();
      } catch (e) { result.textContent = e.message || 'Error'; }
    });

    return node;
  }

  load();
</script>
`;
  return html(body, 200, { 'Content-Security-Policy': csp });
}
