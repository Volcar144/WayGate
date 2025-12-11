Waygate Demo

This monorepo contains:
- Provider: a multi-tenant OpenID Provider (apps/provider)
- RP: a demo Next.js relying party (apps/rp) that authenticates against the provider using Authorization Code + PKCE, verifies tokens with JWKS, enforces auth on a protected route, and supports sign-out.

Observability & Security
- Sentry: Set SENTRY_DSN in apps/provider/.env and/or apps/rp/.env to enable error reporting. DB queries are sent as breadcrumbs (PII redacted).
- Rate limits: Configure RL_* env vars (see apps/provider/src/env.ts) and RL_OVERRIDES_JSON for per-tenant/client caps.
- Health endpoints (provider): /healthz and /readyz.
- Admin runbook and endpoints: see docs/runbook.md. Admin API requires x-admin-secret header matching ADMIN_SECRET env.
- Security headers: CSP and other headers are enabled via middleware. Cookies are HTTP‑only and Secure in production.

Local development (end-to-end)

Prerequisites
- Node 20+ and pnpm
- A local Postgres (the defaults below assume postgres:postgres@localhost:5432)

1) Configure and run the Provider
- Copy the example env to apps/provider/.env and adjust as neededg
  cp .env.example apps/provider/.env
- Ensure SUPABASE_DATABASE_URL is set in apps/provider/.env
- From apps/provider, generate Prisma client, run migrations, and seed a tenant + client
  pnpm prisma:generate
  pnpm prisma:migrate:dev
  pnpm prisma:seed
- The seed prints the client credentials. By default:
  - Tenant slug: example
  - Client ID: example-client
  - Redirect URI (pre-registered): http://localhost:3001/callback
- Start the Provider (port 3000)
  pnpm dev

2) Configure the RP
- Create apps/rp/.env with at least:
  WAYGATE_TENANT_SLUG=example
  WAYGATE_CLIENT_ID=example-client
  WAYGATE_CLIENT_SECRET=<value printed by seed>  # optional; omit for public client
  RP_REDIRECT_URI=http://localhost:3001/callback
  # Optional: override provider base URL (defaults to http://localhost:3000)
  WAYGATE_BASE_URL=http://localhost:3000
- Start the RP (port 3001)
  pnpm --filter rp dev

3) Sign-in flow
- Visit http://localhost:3001
- Click "Sign in" which will
  - generate PKCE verifier/challenge and nonce
  - redirect to http://localhost:3000/a/example/oauth/authorize
- On the provider authorize page, enter an email and send a magic link
  - For local dev, the UI renders a "debug" magic link you can click directly
- After authenticating and consenting, you will be redirected back to the RP callback
  - The RP exchanges the code via a server API route (/api/waygate/token) using the PKCE verifier
  - The RP verifies the ID token (iss/aud/nonce) and access token using jose and the provider JWKS
  - A session cookie is set in the RP
- Visit http://localhost:3001/protected to see ID/access token claims and userinfo

4) Sign-out
- From the protected page (or home when authenticated) click "Sign out"
- The RP calls the provider logout endpoint (/a/{tenant}/logout) with the refresh token and clears the local session

Configurable auth flows

Tenant admins can compose authentication flows under **/a/{tenant}/admin/flows**. Each flow is scoped to a trigger (sign-in, sign-up, consent, etc.) and is built from ordered nodes. The first enabled flow matching the trigger runs automatically during the OAuth authorize pipeline.

Built-in nodes:
- **ReadSignals** – captures request IP, geo hints and basic device fingerprinting
- **CheckCaptcha** – verifies Cloudflare Turnstile or hCaptcha tokens and prevents replay via Redis
- **PromptUI** – renders a server-driven prompt (built with the Prompt Library) and resumes the flow when the user submits inputs
- **MetadataWrite** – writes JSON blobs to the per-user metadata namespace
- **RequireReauth, Branch, Webhook, API Request, Finish** – scaffolding for step-up auth, routing and external callbacks

To build the acceptance flow described in the ticket:
1. Create a sign-in flow and enable it.
2. Add nodes in this order: `ReadSignals` → `CheckCaptcha` (set provider to Turnstile and use test site/secret keys if needed) → `PromptUI` (pick a prompt from the library, e.g., “extra email confirmation”) → `MetadataWrite` (namespace `signin`, values `{ "confirmed": true }`) → `Finish`.
3. Create prompts under the Prompt Library using JSON schemas. Each schema defines fields, helper text, and optional button actions.
4. Runs are streamed to `/a/{tenant}/admin/flows` so you can inspect node events, errors, and context.

Local E2E test harness

You can run a full end‑to‑end test suite locally without any external services.
This will:
- start Docker services (Postgres, Redis, and a mock SMTP inbox with web UI)
- apply Prisma migrations and seed a tenant + client
- start both Next.js apps (provider on 3000, RP on 3001)
- run Playwright tests to exercise discovery, authorize (magic + enchanted links), token exchange, refresh, userinfo, and logout

Commands
- Install Playwright browsers: pnpm e2e:install
- Run the E2E suite: pnpm e2e

The mock SMTP inbox is available at http://localhost:8025 (SMTP on 1025). The provider will send magic links if SMTP is configured via env (defaults are set by the test harness).
