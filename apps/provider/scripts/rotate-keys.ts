import { PrismaClient } from '@prisma/client';
import { rotateKeysForTenant } from '../src/services/jwks';

async function main() {
  const slug = process.argv[2] || process.env.TENANT || process.env.SEED_TENANT_SLUG;
  if (!slug) {
    console.error('Usage: tsx apps/provider/scripts/rotate-keys.ts <tenant-slug>');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      console.error(`Tenant not found: ${slug}`);
      process.exit(1);
    }
    const { kid } = await rotateKeysForTenant(tenant.id);
    console.log(`Rotated signing keys for tenant ${slug}. Active kid=${kid}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
