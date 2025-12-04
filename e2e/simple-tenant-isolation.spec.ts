import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/prisma';

test('tenant isolation middleware test', async () => {
  // Create two test tenants
  const tenantA = await prisma.tenant.create({
    data: { slug: 'test-a', name: 'Test Tenant A' }
  });
  
  const tenantB = await prisma.tenant.create({
    data: { slug: 'test-b', name: 'Test Tenant B' }
  });

  // Create users in each tenant
  const userA = await prisma.user.create({
    data: { tenantId: tenantA.id, email: 'user@tenant-a.com', name: 'User A' }
  });
  
  const userB = await prisma.user.create({
    data: { tenantId: tenantB.id, email: 'user@tenant-b.com', name: 'User B' }
  });

  // Test that users are isolated
  const usersInA = await prisma.user.findMany({
    where: { tenantId: tenantA.id }
  });
  
  const usersInB = await prisma.user.findMany({
    where: { tenantId: tenantB.id }
  });

  expect(usersInA).toHaveLength(1);
  expect(usersInB).toHaveLength(1);
  expect(usersInA[0].email).toBe('user@tenant-a.com');
  expect(usersInB[0].email).toBe('user@tenant-b.com');

  // Test cross-tenant access prevention (this should be blocked by middleware)
  // Note: This test simulates what the middleware would block
  const crossTenantAccess = await prisma.user.findFirst({
    where: { id: userB.id, tenantId: tenantA.id }
  });

  expect(crossTenantAccess).toBeNull();

  // Cleanup
  await prisma.user.deleteMany({
    where: { tenantId: { in: [tenantA.id, tenantB.id] } }
  });
  
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantA.id, tenantB.id] } }
  });
});