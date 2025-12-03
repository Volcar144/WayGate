# Waygate Production Deploy Guide

This guide walks you through preparing and deploying Waygate to production, including environment setup, database migration/seeding, signing-key management, and automated smoke tests against your production URL.

At the end, you will have:
- A provisioned tenant with an admin user and an initial RP client
- A fresh, active RS256 signing key
- Verified OIDC discovery and end-to-end auth flows
- An HTML smoke test report archived under docs/

## Prerequisites
- Node.js 18+ and pnpm
- A production Postgres database (connection string URL)
- A Redis instance (recommended for production)
- An SMTP server (recommended for production; magic links can still be used via the built-in debug link)
- Public HTTPS domains for the Provider and your RP application

## Required environment variables
Set these in your deploy shell (or CI) before running the deploy command.

Required
- SUPABASE_DATABASE_URL: Postgres connection string for the provider (e.g., postgresql://user:pass@db.example.com:5432/waygate)
- ENCRYPTION_KEY: 32+ char secret used to encrypt private JWKs
- SESSION_SECRET: 32+ char secret used to sign user sessions

Recommended (Provider)
- ISSUER_URL: Explicit issuer URL that includes the tenant path: https://id.example.com/a/{tenant}
  - Must be https in production
  - If omitted, the issuer is derived from incoming request headers
- REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD: Redis connection
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM: SMTP config for sending magic links

Deploy configuration (used by the deploy script)
- DEPLOY_TENANT_SLUG: Your tenant slug (e.g., acme)
- DEPLOY_TENANT_NAME: Optional display name (defaults to slug)
- DEPLOY_CLIENT_ID: Initial RP client identifier
- DEPLOY_CLIENT_NAME: Optional client display name
- DEPLOY_REDIRECT_URIS: Comma-separated list of client redirect URIs (use HTTPS in production)
- DEPLOY_ADMIN_EMAIL: Optional, seeds an admin user for your tenant

Smoke test targets
- SMOKE_PROVIDER_BASE: Full provider base URL including tenant; e.g. https://id.example.com/a/acme
- SMOKE_RP_BASE: RP base URL; e.g. https://rp.example.com

## One-command deploy (migrate, seed, rotate key, smoke test)
Run the following once your env vars are set:

pnpm deploy:prod

What this does:
1) Runs Prisma migrate deploy on the production DB
2) Seeds a tenant, admin user (optional), and a client with your provided redirect URIs
   - Generates and promotes a new signing key to active during seeding
3) Verifies OIDC discovery at ${SMOKE_PROVIDER_BASE}/.well-known/openid-configuration
4) Executes end-to-end smoke tests against your production URLs
5) Archives the Playwright HTML report to:
   - docs/smoke/latest
   - docs/smoke/YYYY-MM-DD_HH-MM-SS

Example (bash):

export SUPABASE_DATABASE_URL="postgresql://postgres:secret@db.prod:5432/waygate"
export ENCRYPTION_KEY="<generate-long-random-32+>"
export SESSION_SECRET="<generate-long-random-32+>"

export DEPLOY_TENANT_SLUG="acme"
export DEPLOY_TENANT_NAME="Acme Inc"
export DEPLOY_CLIENT_ID="acme-rp"
export DEPLOY_CLIENT_NAME="Acme RP"
export DEPLOY_REDIRECT_URIS="https://rp.example.com/callback"
export DEPLOY_ADMIN_EMAIL="admin@acme.example"

export SMOKE_PROVIDER_BASE="https://id.example.com/a/acme"
export SMOKE_RP_BASE="https://rp.example.com"

# Optional but recommended in production
export ISSUER_URL="https://id.example.com/a/acme"
export REDIS_HOST="redis.prod"; export REDIS_PORT=6379
export SMTP_HOST="smtp.prod"; export SMTP_PORT=587; export EMAIL_FROM="no-reply@acme.example"

pnpm deploy:prod

## Signing key management
Keys are rotated and stored per tenant in the database. Private JWKs are encrypted using ENCRYPTION_KEY. Seeding can generate an initial active key automatically. To rotate keys later:

# Rotate signing keys for a tenant and promote the new key to active
pnpm rotate-keys acme

This will:
- Generate a new staged key
- Promote it to active
- Mark the previous active key as retired for 7 days (usable for token validation during rollover)

Recovery / rollback
- If a newly-rotated key causes issues, you can roll back by promoting the previous key to active and retiring the new one. As a last resort, use a database update to swap statuses (be sure to keep a short notAfter on the rolled-back key):

-- Example SQL (Postgres); use with caution
-- Identify IDs by tenantId and kid and swap statuses accordingly
-- update "JwkKey" set status='active', "notAfter"=null where id='<previous_active_id>';
-- update "JwkKey" set status='retired', "notAfter"=now() where id='<new_active_id>';

## RP client configuration
- Make sure DEPLOY_REDIRECT_URIS includes all production redirect URIs (HTTPS). You can re-run seeding to upsert changes for the client.

## Verification commands
Manual checks you can run against production:

# OIDC discovery
curl -fsSL "$SMOKE_PROVIDER_BASE/.well-known/openid-configuration" | jq

# JWKS
curl -fsSL "$SMOKE_PROVIDER_BASE/.well-known/jwks.json" | jq

# Authorization endpoint (expect HTML)
curl -I "$SMOKE_PROVIDER_BASE/oauth/authorize?response_type=code&client_id=$DEPLOY_CLIENT_ID&redirect_uri=$(printf %s "${DEPLOY_REDIRECT_URIS%%,*}")&scope=openid" | sed -n '1,20p'

## Where to find the smoke test report
After pnpm deploy:prod completes, the Playwright HTML report is copied to:
- docs/smoke/latest
- docs/smoke/<timestamp>

Open docs/smoke/latest/index.html in your browser to review the results.

## Troubleshooting
- Missing envs cause startup failures in production. Ensure SUPABASE_DATABASE_URL, ENCRYPTION_KEY, and SESSION_SECRET are set and valid.
- If ISSUER_URL is set in production, it must be https and include /a/{tenant}.
- If SMTP is partially configured in production, startup will fail with a clear error. Provide SMTP_HOST, SMTP_PORT, and EMAIL_FROM together.
- Redis is optional but strongly recommended for production scale; without it, in-memory fallbacks are used.
