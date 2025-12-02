Waygate Demo

This monorepo contains:
- Provider: a multi-tenant OpenID Provider (apps/provider)
- RP: a demo Next.js relying party (apps/rp) that authenticates against the provider using Authorization Code + PKCE, verifies tokens with JWKS, enforces auth on a protected route, and supports sign-out.

Local development (end-to-end)

Prerequisites
- Node 20+ and pnpm
- A local Postgres (the defaults below assume postgres:postgres@localhost:5432)

1) Configure and run the Provider
- Copy the example env to apps/provider/.env and adjust as needed
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

Notes
- JWKS caching and rotation: the RP uses jose's createRemoteJWKSet, which caches the provider JWKS and automatically re-fetches on unknown key IDs. This tolerates signing key rotation.
- Authorization Code + PKCE is required by the provider for public clients. Confidential clients can authenticate to the token endpoint using Basic auth with client_secret.
- The RP enforces authentication on the /protected route by redirecting to /auth/login when no session is present.
