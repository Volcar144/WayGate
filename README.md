Waygate Scaffold

This repository initializes the Waygate monorepo with a Next.js 15 App Router project and Prisma configured for a multi-tenant identity provider that deploys to Vercel.

Structure
- apps/provider: Identity Provider (Next.js App Router + Prisma)
- apps/rp: Sample relying party app (Next.js App Router)
- packages/*: Shared configuration (tsconfig, etc.)

Prerequisites
- Node 18.18+ or 20+
- pnpm 9+
- A PostgreSQL database (Supabase recommended)

Quick start
1) Copy envs
cp .env.example apps/provider/.env

2) Update apps/provider/.env
- SUPABASE_DATABASE_URL: Your Supabase Postgres connection string
- SESSION_SECRET: 32+ char secret
- Optional: ISSUER_URL and SMTP/Redis configs as needed

3) Install deps
pnpm install

4) Generate Prisma client and apply migrations
cd apps/provider
pnpm prisma:generate
# For first-time local dev you can create an initial migration:
# pnpm prisma:migrate:dev --name init
# For deploy environments use:
# pnpm prisma:migrate:deploy

5) Seed sample data
pnpm prisma:seed

6) Run all apps
pnpm dev

- Provider will run on http://localhost:3000
- RP will run on http://localhost:3001

Tenant routing (/a/{tenant})
Requests are routed under a tenant prefix. The provider middleware extracts the tenant slug from the URL and attaches it to the request context via the x-tenant header.

- Path format: /a/{tenant}/...
- Local-only fallback: when running on localhost or 127.0.0.1, you can provide ?tenant={slug} if the path doesn’t include /a/{tenant}
- Access tenant in server components or routes with getTenant():

import { getTenant } from 'apps/provider/src/lib/tenant';
const tenant = getTenant();

Issuer URL detection
The issuer URL used for OIDC/OAuth flows is resolved with the following precedence:
1) ISSUER_URL (environment variable) if set. Use this in production to force a canonical value.
2) Derived from the incoming request: {scheme}://{host}/a/{tenant}
   - scheme is taken from x-forwarded-proto when present, otherwise http
   - the tenant value comes from the tenant context set by middleware

Environment variables
- SUPABASE_DATABASE_URL (required): Postgres connection string
- ISSUER_URL (optional): Explicit issuer URL override
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM (optional, TBD)
- REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD (optional)
- ENCRYPTION_KEY (optional but recommended): 32+ chars
- SESSION_SECRET (required): 32+ chars

Prisma schema (multi-tenant)
The provider app defines the following tables:
- tenants, users, credentials, clients, auth_codes, sessions, refresh_tokens, jwk_keys, consents, audits

A seed script creates a sample tenant (slug: example) and client (clientId: example-client), and prints a generated client secret.

Vercel deployment
- The apps are standard Next.js 15 App Router apps and can be deployed to Vercel.
- Set the same environment variables on Vercel for the provider app. If you rely on dynamic issuer detection behind a proxy, ensure x-forwarded-proto is forwarded, or set ISSUER_URL explicitly.

Scripts
- pnpm dev: run all apps in dev (via Turborepo)
- pnpm build: build all apps
- pnpm lint: lint all apps
- apps/provider: prisma:* scripts for schema and database management

Notes
- The tenant middleware runs only on paths under /a/*.
- In development you can hit http://localhost:3000/a/example or http://localhost:3000/a/example/api/ping to see the tenant context in action.
