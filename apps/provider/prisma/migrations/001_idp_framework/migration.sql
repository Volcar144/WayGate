-- Identity Provider framework: identity_providers and external_identities

-- Enums
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IdentityProviderType') THEN
    CREATE TYPE "IdentityProviderType" AS ENUM ('google','microsoft','github','oidc_generic');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProviderStatus') THEN
    CREATE TYPE "ProviderStatus" AS ENUM ('enabled','disabled');
  END IF;
END $$;

-- IdentityProvider table
CREATE TABLE IF NOT EXISTS "IdentityProvider" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  type "IdentityProviderType" NOT NULL,
  "clientId" text NOT NULL,
  "clientSecretEnc" text NOT NULL,
  issuer text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['openid','email','profile'],
  status "ProviderStatus" NOT NULL DEFAULT 'disabled',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenantId", type)
);
CREATE INDEX IF NOT EXISTS "IdentityProvider_tenant_idx" ON "IdentityProvider"("tenantId");

-- ExternalIdentity table
CREATE TABLE IF NOT EXISTS "ExternalIdentity" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "providerId" uuid NOT NULL REFERENCES "IdentityProvider"(id) ON DELETE CASCADE,
  subject text NOT NULL,
  email text,
  claims jsonb NOT NULL,
  "lastLoginAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", subject)
);
CREATE INDEX IF NOT EXISTS "ExternalIdentity_tenant_idx" ON "ExternalIdentity"("tenantId");
CREATE INDEX IF NOT EXISTS "ExternalIdentity_user_idx" ON "ExternalIdentity"("userId");

-- updatedAt triggers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'IdentityProvider' AND trigger_name = 'identityprovider_updated') THEN
    CREATE TRIGGER identityprovider_updated BEFORE UPDATE ON "IdentityProvider"
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'ExternalIdentity' AND trigger_name = 'externalidentity_updated') THEN
    CREATE TRIGGER externalidentity_updated BEFORE UPDATE ON "ExternalIdentity"
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;
END $$;
