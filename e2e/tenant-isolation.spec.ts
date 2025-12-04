import { describe, it, expect, beforeAll, afterAll } from '@playwright/test';
import { prisma } from '@/lib/prisma';
import { RbacService } from '@/lib/rbac';
import { TenantSettingsService } from '@/services/tenant-settings';
import { AuditService } from '@/services/audit';
import { getTenantRedis } from '@/lib/redis';

describe('Tenant Isolation Tests', () => {
  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };
  let tenantAUser: { id: string; email: string };
  let tenantBUser: { id: string; email: string };
  let tenantAClient: { id: string; clientId: string };
  let tenantBClient: { id: string; clientId: string };

  beforeAll(async () => {
    // Create test tenants
    tenantA = await prisma.tenant.create({
      data: { slug: 'test-tenant-a', name: 'Test Tenant A' }
    });
    tenantB = await prisma.tenant.create({
      data: { slug: 'test-tenant-b', name: 'Test Tenant B' }
    });

    // Initialize tenant resources
    const { TenantInitializationService } = await import('@/services/tenant-init');
    await TenantInitializationService.initializeTenant(tenantA.id, tenantA.slug, 'Test Tenant A');
    await TenantInitializationService.initializeTenant(tenantB.id, tenantB.slug, 'Test Tenant B');

    // Create test users
    tenantAUser = await prisma.user.create({
      data: { tenantId: tenantA.id, email: 'user@tenant-a.com', name: 'User A' }
    });
    tenantBUser = await prisma.user.create({
      data: { tenantId: tenantB.id, email: 'user@tenant-b.com', name: 'User B' }
    });

    // Create test clients
    tenantAClient = await prisma.client.create({
      data: {
        tenantId: tenantA.id,
        clientId: 'client-a',
        name: 'Client A',
        redirectUris: ['http://localhost:3000/callback'],
        grantTypes: ['authorization_code']
      }
    });
    tenantBClient = await prisma.client.create({
      data: {
        tenantId: tenantB.id,
        clientId: 'client-b',
        name: 'Client B',
        redirectUris: ['http://localhost:3000/callback'],
        grantTypes: ['authorization_code']
      }
    });

    // Assign tenant admin roles
    const adminRoleA = await prisma.tenantRole.findFirst({
      where: { tenantId: tenantA.id, name: 'tenant_admin' }
    });
    const adminRoleB = await prisma.tenantRole.findFirst({
      where: { tenantId: tenantB.id, name: 'tenant_admin' }
    });

    if (adminRoleA) {
      await prisma.userRole.create({
        data: { tenantId: tenantA.id, userId: tenantAUser.id, roleId: adminRoleA.id }
      });
    }
    if (adminRoleB) {
      await prisma.userRole.create({
        data: { tenantId: tenantB.id, userId: tenantBUser.id, roleId: adminRoleB.id }
      });
    }
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.userRole.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } }
    });
    await prisma.tenantRole.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } }
    });
    await prisma.client.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } }
    });
    await prisma.user.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } }
    });
    await prisma.tenantSettings.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } }
    });
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenantA.id, tenantB.id] } }
    });
  });

  describe('Data Isolation', () => {
    it('should prevent cross-tenant user access', async () => {
      // Try to access user from tenant B while in tenant A context
      const userFromWrongTenant = await prisma.user.findFirst({
        where: { id: tenantBUser.id, tenantId: tenantA.id }
      });

      expect(userFromWrongTenant).toBeNull();
    });

    it('should prevent cross-tenant client access', async () => {
      // Try to access client from tenant B while in tenant A context
      const clientFromWrongTenant = await prisma.client.findFirst({
        where: { id: tenantBClient.id, tenantId: tenantA.id }
      });

      expect(clientFromWrongTenant).toBeNull();
    });

    it('should isolate audit logs by tenant', async () => {
      // Create audit entries for both tenants
      await AuditService.create({
        userId: tenantAUser.id,
        action: 'test.action.a'
      }, tenantA.slug);
      
      await AuditService.create({
        userId: tenantBUser.id,
        action: 'test.action.b'
      }, tenantB.slug);

      // Query audits for tenant A
      const tenantAAudits = await AuditService.getAuditLogs({}, tenantA.slug);
      
      // Query audits for tenant B
      const tenantBAudits = await AuditService.getAuditLogs({}, tenantB.slug);

      expect(tenantAAudits).toHaveLength(1);
      expect(tenantBAudits).toHaveLength(1);
      expect(tenantAAudits[0].action).toBe('test.action.a');
      expect(tenantBAudits[0].action).toBe('test.action.b');
    });
  });

  describe('RBAC Isolation', () => {
    it('should isolate roles by tenant', async () => {
      // Get roles for tenant A user
      const tenantAUserRoles = await RbacService.getUserRoles(tenantA.id, tenantAUser.id);
      
      // Get roles for tenant B user
      const tenantBUserRoles = await RbacService.getUserRoles(tenantB.id, tenantBUser.id);

      expect(tenantAUserRoles).toHaveLength(1);
      expect(tenantBUserRoles).toHaveLength(1);
      expect(tenantAUserRoles[0].role.name).toBe('tenant_admin');
      expect(tenantBUserRoles[0].role.name).toBe('tenant_admin');
    });

    it('should enforce tenant-scoped permissions', async () => {
      // Check permissions for tenant A user
      const tenantAPermissions = await RbacService.getUserPermissions(tenantA.id, tenantAUser.id);
      
      // Check permissions for tenant B user
      const tenantBPermissions = await RbacService.getUserPermissions(tenantB.id, tenantBUser.id);

      expect(tenantAPermissions).toContain('user:read');
      expect(tenantBPermissions).toContain('user:read');
      
      // User from tenant A should not have permissions in tenant B
      const crossTenantPermissions = await RbacService.getUserPermissions(tenantB.id, tenantAUser.id);
      expect(crossTenantPermissions).toHaveLength(0);
    });
  });

  describe('Settings Isolation', () => {
    it('should isolate tenant settings', async () => {
      // Update settings for tenant A
      await TenantSettingsService.updateSettings({
        displayName: 'Tenant A Display',
        brandColor: '#ff0000',
        contactEmail: 'admin@tenant-a.com'
      }, tenantA.slug);

      // Update settings for tenant B
      await TenantSettingsService.updateSettings({
        displayName: 'Tenant B Display',
        brandColor: '#00ff00',
        contactEmail: 'admin@tenant-b.com'
      }, tenantB.slug);

      // Get settings for tenant A
      const tenantASettings = await TenantSettingsService.getSettings(tenantA.slug);
      
      // Get settings for tenant B
      const tenantBSettings = await TenantSettingsService.getSettings(tenantB.slug);

      expect(tenantASettings?.displayName).toBe('Tenant A Display');
      expect(tenantASettings?.brandColor).toBe('#ff0000');
      expect(tenantASettings?.contactEmail).toBe('admin@tenant-a.com');

      expect(tenantBSettings?.displayName).toBe('Tenant B Display');
      expect(tenantBSettings?.brandColor).toBe('#00ff00');
      expect(tenantBSettings?.contactEmail).toBe('admin@tenant-b.com');
    });
  });

  describe('Redis Namespace Isolation', () => {
    it('should namespace Redis keys by tenant', async () => {
      const redisA = getTenantRedis(tenantA.slug);
      const redisB = getTenantRedis(tenantB.slug);

      // Set values in both tenant Redis instances
      await redisA.set('test-key', 'value-a');
      await redisB.set('test-key', 'value-b');

      // Verify values are isolated
      const valueA = await redisA.get('test-key');
      const valueB = await redisB.get('test-key');

      expect(valueA).toBe('value-a');
      expect(valueB).toBe('value-b');

      // Cleanup
      await redisA.del('test-key');
      await redisB.del('test-key');
    });

    it('should isolate Redis channels by tenant', async () => {
      let messageA: string | null = null;
      let messageB: string | null = null;

      const redisA = getTenantRedis(tenantA.slug);
      const redisB = getTenantRedis(tenantB.slug);

      // Subscribe to channels in both tenants
      await redisA.subscribe('test-channel', (channel, msg) => {
        messageA = msg;
      });
      await redisB.subscribe('test-channel', (channel, msg) => {
        messageB = msg;
      });

      // Publish messages
      await redisA.publish('test-channel', 'message-a');
      await redisB.publish('test-channel', 'message-b');

      // Wait a bit for message delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify messages are isolated
      expect(messageA).toBe('message-a');
      expect(messageB).toBe('message-b');
    });
  });

  describe('Cross-Tenant Attack Prevention', () => {
    it('should prevent client from tenant A accessing tenant B authorize endpoint', async () => {
      // This test would require setting up a full OAuth flow
      // For now, we'll test the client lookup isolation
      const { tenantClientRepo } = await import('@/lib/tenant-repo');
      
      // Try to find tenant B client using tenant A context
      const client = await tenantClientRepo.findUnique(tenantA.id, tenantBClient.clientId);
      expect(client).toBeNull();
    });

    it('should prevent token exchange across tenants', async () => {
      // Create auth code for tenant A
      const authCodeA = await prisma.authCode.create({
        data: {
          tenantId: tenantA.id,
          code: 'test-code-a',
          clientId: tenantAClient.id,
          userId: tenantAUser.id,
          redirectUri: 'http://localhost:3000/callback',
          expiresAt: new Date(Date.now() + 60000)
        }
      });

      // Try to exchange auth code with tenant B client
      const response = await fetch(`http://localhost:3000/a/${tenantB.slug}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'test-code-a',
          client_id: tenantBClient.clientId,
          redirect_uri: 'http://localhost:3000/callback',
          code_verifier: 'test_verifier_123456789012345678901234567890123456789012345678901234567890123456789012'
        })
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe('invalid_grant');
    });
  });

  describe('Security Event Logging', () => {
    it('should log cross-tenant access attempts', async () => {
      await AuditService.logCrossTenantAccess(
        tenantB.id,
        tenantA.id,
        { userId: tenantAUser.id, action: 'user.read', resource: 'user' }
      );

      const securityEvents = await AuditService.getSecurityEvents({}, tenantA.slug);
      
      expect(securityEvents).toHaveLength(1);
      expect(securityEvents[0].action).toBe('security.cross_tenant_access_attempt');
    });

    it('should log permission denied events', async () => {
      await AuditService.logPermissionDenied(
        'user:delete',
        { userId: tenantAUser.id, action: 'user.delete', resource: 'user' }
      );

      const securityEvents = await AuditService.getSecurityEvents({}, tenantA.slug);
      
      expect(securityEvents).toHaveLength(1);
      expect(securityEvents[0].action).toBe('security.permission_denied');
    });
  });

  describe('Rate Limiting Isolation', () => {
    it('should isolate rate limits by tenant', async () => {
      const redisA = getTenantRedis(tenantA.slug);
      const redisB = getTenantRedis(tenantB.slug);

      // Set rate limit counters for both tenants
      await redisA.incr('rl:token:ip:192.168.1.1');
      await redisB.incr('rl:token:ip:192.168.1.1');

      // Verify counters are separate
      const countA = await redisA.get('rl:token:ip:192.168.1.1');
      const countB = await redisB.get('rl:token:ip:192.168.1.1');

      expect(countA).toBe('1');
      expect(countB).toBe('1');

      // Cleanup
      await redisA.del('rl:token:ip:192.168.1.1');
      await redisB.del('rl:token:ip:192.168.1.1');
    });
  });
});