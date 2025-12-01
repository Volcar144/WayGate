-- Initial migration for Waygate Provider (PostgreSQL / Supabase)

-- Enable extensions used by Prisma defaults
create extension if not exists pgcrypto;

-- Tenants
create table if not exists "Tenant" (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- Users
create table if not exists "User" (
  id uuid primary key default gen_random_uuid(),
  "tenantId" uuid not null references "Tenant"(id) on delete cascade,
  email text not null,
  name text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("tenantId", email)
);
create index if not exists "User_tenant_idx" on "User"("tenantId");

-- Credentials
create table if not exists "Credential" (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references "User"(id) on delete cascade,
  type text not null,
  secret text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("userId", type)
);

-- Clients
create table if not exists "Client" (
  id uuid primary key default gen_random_uuid(),
  "tenantId" uuid not null references "Tenant"(id) on delete cascade,
  "clientId" text not null,
  "clientSecret" text,
  name text not null,
  "redirectUris" text[] not null,
  "grantTypes" text[] not null,
  "firstParty" boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("tenantId", "clientId")
);
create index if not exists "Client_tenant_idx" on "Client"("tenantId");

-- Auth Codes
create table if not exists "AuthCode" (
  id uuid primary key default gen_random_uuid(),
  "tenantId" uuid not null references "Tenant"(id) on delete cascade,
  code text not null unique,
  "clientId" uuid not null references "Client"(id) on delete cascade,
  "userId" uuid references "User"(id),
  "redirectUri" text not null,
  scope text,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now()
);
create index if not exists "AuthCode_tenant_idx" on "AuthCode"("tenantId");

-- Sessions
create table if not exists "Session" (
  id uuid primary key default gen_random_uuid(),
  "tenantId" uuid not null references "Tenant"(id) on delete cascade,
  "userId" uuid not null references "User"(id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null
);
create index if not exists "Session_tenant_idx" on "Session"("tenantId");

-- Refresh Tokens
create table if not exists "RefreshToken" (
  id uuid primary key default gen_random_uuid(),
  "tenantId" uuid not null references "Tenant"(id) on delete cascade,
  token text not null unique,
  "sessionId" uuid not null references "Session"(id) on delete cascade,
  "clientId" uuid not null references "Client"(id) on delete cascade,
  revoked boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null
);
create index if not exists "RefreshToken_tenant_idx" on "RefreshToken"("tenantId");

-- JWK Keys
create table if not exists "JwkKey" (
  id uuid primary key default gen_random_uuid(),
  "tenantId" uuid not null references "Tenant"(id) on delete cascade,
  kid text not null,
  kty text not null,
  alg text,
  use text,
  "publicJwk" jsonb not null,
  "privateJwk" jsonb,
  "createdAt" timestamptz not null default now(),
  "rotatedAt" timestamptz,
  unique ("tenantId", kid)
);
create index if not exists "JwkKey_tenant_idx" on "JwkKey"("tenantId");

-- Consents
create table if not exists "Consent" (
  id uuid primary key default gen_random_uuid(),
  "tenantId" uuid not null references "Tenant"(id) on delete cascade,
  "userId" uuid not null references "User"(id) on delete cascade,
  "clientId" uuid not null references "Client"(id) on delete cascade,
  scopes text[] not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("tenantId", "userId", "clientId")
);
create index if not exists "Consent_tenant_idx" on "Consent"("tenantId");

-- Audits
create table if not exists "Audit" (
  id bigserial primary key,
  "tenantId" uuid not null references "Tenant"(id) on delete cascade,
  "userId" uuid references "User"(id),
  action text not null,
  ip text,
  "userAgent" text,
  "createdAt" timestamptz not null default now()
);
create index if not exists "Audit_tenant_idx" on "Audit"("tenantId");

-- Triggers to keep updatedAt current
create or replace function set_updated_at() returns trigger as $
begin
  new."updatedAt" = now();
  return new;
end;
$ language plpgsql;

create trigger tenant_updated before update on "Tenant"
for each row execute procedure set_updated_at();

create trigger user_updated before update on "User"
for each row execute procedure set_updated_at();

create trigger credential_updated before update on "Credential"
for each row execute procedure set_updated_at();

create trigger client_updated before update on "Client"
for each row execute procedure set_updated_at();

create trigger consent_updated before update on "Consent"
for each row execute procedure set_updated_at();
