import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { ensureActiveKeyForTenant, rotateKeysForTenant } from '../src/services/jwks';

const prisma = new PrismaClient();

async function main() {
  const tenantSlug = process.env.SEED_TENANT_SLUG || 'example';
  const tenantName = process.env.SEED_TENANT_NAME || 'Example Tenant';

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: {},
    create: {
      slug: tenantSlug,
      name: tenantName,
    },
  });

  // Key management
  const rotate = (process.env.SEED_ROTATE_KEYS || '').toLowerCase();
  if (rotate === '1' || rotate === 'true' || rotate === 'yes') {
    await rotateKeysForTenant(tenant.id);
  } else {
    // Ensure there is at least one active signing key for the tenant
    await ensureActiveKeyForTenant(tenant.id);
  }

  // Client
  const clientId = process.env.SEED_CLIENT_ID || 'example-client';
  const clientSecret = process.env.SEED_CLIENT_SECRET || crypto.randomBytes(24).toString('base64url');
  const clientName = process.env.SEED_CLIENT_NAME || 'Example App';
  const redirectUris = (process.env.SEED_REDIRECT_URIS || 'http://localhost:3001/callback')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const firstPartyEnv = (process.env.SEED_FIRST_PARTY || 'true').toLowerCase();
  const firstParty = firstPartyEnv === '1' || firstPartyEnv === 'true' || firstPartyEnv === 'yes';

  await prisma.client.upsert({
    where: {
      tenantId_clientId: {
        tenantId: tenant.id,
        clientId,
      },
    },
    update: {
      name: clientName,
      redirectUris,
      grantTypes: ['authorization_code', 'refresh_token'],
      firstParty,
    },
    create: {
      tenantId: tenant.id,
      clientId,
      clientSecret,
      name: clientName,
      redirectUris,
      grantTypes: ['authorization_code', 'refresh_token'],
      firstParty,
    },
  });

  // Optional admin user
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || '').toLowerCase();
  if (adminEmail) {
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } },
      update: {},
      create: { tenantId: tenant.id, email: adminEmail, name: 'Administrator' },
    });
  }

  console.log('Seeded tenant:', tenant.slug);
  console.log('Client ID:', clientId);
  console.log('Client Secret:', clientSecret);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
