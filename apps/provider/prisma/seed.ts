import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { ensureActiveKeyForTenant } from '../src/services/jwks';

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

  // Ensure there is at least one active signing key for the tenant
  await ensureActiveKeyForTenant(tenant.id);

  const clientId = 'example-client';
  const clientSecret = crypto.randomBytes(24).toString('base64url');

  await prisma.client.upsert({
    where: {
      tenantId_clientId: {
        tenantId: tenant.id,
        clientId,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      clientId,
      clientSecret,
      name: 'Example App',
      redirectUris: ['http://localhost:4000/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      firstParty: true,
    },
  });

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
