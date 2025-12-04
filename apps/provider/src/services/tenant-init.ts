import { prisma } from '@/lib/prisma';
import { RbacService, DEFAULT_ROLES } from '@/lib/rbac';
import { TenantSettingsService } from '@/services/tenant-settings';
import { logger } from '@/utils/logger';

/**
 * Service for initializing tenant resources and defaults
 */
export class TenantInitializationService {
  /**
   * Initialize a new tenant with default settings and roles
   */
  static async initializeTenant(tenantId: string, tenantSlug: string, tenantName: string): Promise<void> {
    logger.info('Initializing tenant', { tenantId, tenantSlug, tenantName });

    try {
      // Initialize default RBAC roles
      await this.initializeRoles(tenantId);
      
      // Initialize default settings
      await TenantSettingsService.initializeDefaults(tenantId, tenantName);
      
      // Ensure JWK key exists for tenant
      await this.ensureJwkKey(tenantId);

      logger.info('Tenant initialization completed', { tenantId, tenantSlug });
    } catch (error) {
      logger.error('Tenant initialization failed', {
        tenantId,
        tenantSlug,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Initialize default RBAC roles for a tenant
   */
  private static async initializeRoles(tenantId: string): Promise<void> {
    logger.info('Initializing default roles', { tenantId });

    try {
      const roles = await RbacService.initializeTenantRoles(tenantId);
      
      logger.info('Default roles initialized', {
        tenantId,
        rolesCreated: roles.length,
        roleNames: roles.map(r => r.name)
      });
    } catch (error) {
      logger.error('Failed to initialize roles', {
        tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Ensure JWK key exists for tenant
   */
  private static async ensureJwkKey(tenantId: string): Promise<void> {
    try {
      const { ensureActiveKeyForTenant } = await import('@/services/jwks');
      await ensureActiveKeyForTenant(tenantId);
      
      logger.info('JWK key ensured for tenant', { tenantId });
    } catch (error) {
      logger.error('Failed to ensure JWK key', {
        tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Create a first admin user for the tenant
   */
  static async createAdminUser(
    tenantId: string, 
    adminEmail: string, 
    adminName?: string
  ): Promise<{ userId: string; tempPassword: string }> {
    logger.info('Creating admin user', { tenantId, adminEmail });

    try {
      // Create user
      const user = await prisma.user.create({
        data: {
          tenantId,
          email: adminEmail.toLowerCase(),
          name: adminName || 'Administrator',
        }
      });

      // Assign tenant admin role
      const adminRole = await prisma.tenantRole.findFirst({
        where: { tenantId, name: DEFAULT_ROLES.TENANT_ADMIN.name }
      });

      if (adminRole) {
        await prisma.userRole.create({
          data: {
            tenantId,
            userId: user.id,
            roleId: adminRole.id,
            assignedBy: user.id // Self-assigned
          }
        });
      }

      // Generate temporary password
      const tempPassword = this.generateTempPassword();
      const { hashPassword } = await import('@/utils/password');
      const hashedPassword = await hashPassword(tempPassword);

      // Create password credential
      await prisma.credential.create({
        data: {
          userId: user.id,
          type: 'password',
          secret: hashedPassword
        }
      });

      logger.info('Admin user created', {
        tenantId,
        userId: user.id,
        email: adminEmail
      });

      return {
        userId: user.id,
        tempPassword
      };
    } catch (error) {
      logger.error('Failed to create admin user', {
        tenantId,
        adminEmail,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Validate tenant configuration
   */
  static async validateTenant(tenantId: string): Promise<{
    valid: boolean;
    issues: string[];
    warnings: string[];
  }> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      // Check if tenant exists
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { settings: true }
      });

      if (!tenant) {
        issues.push('Tenant not found');
        return { valid: false, issues, warnings };
      }

      // Check if roles exist
      const roles = await prisma.tenantRole.findMany({
        where: { tenantId }
      });

      const requiredRoles = [DEFAULT_ROLES.TENANT_ADMIN.name, DEFAULT_ROLES.TENANT_VIEWER.name];
      const existingRoleNames = roles.map(r => r.name);
      
      for (const requiredRole of requiredRoles) {
        if (!existingRoleNames.includes(requiredRole)) {
          issues.push(`Missing required role: ${requiredRole}`);
        }
      }

      // Check if JWK key exists
      const activeKey = await prisma.jwkKey.findFirst({
        where: { tenantId, status: 'active' }
      });

      if (!activeKey) {
        warnings.push('No active JWK key found');
      }

      // Check settings
      if (!tenant.settings) {
        warnings.push('No tenant settings configured');
      } else {
        // Validate settings
        const settingsValidation = TenantSettingsService.validateSettings(tenant.settings as any);
        if (!settingsValidation.valid) {
          issues.push(...settingsValidation.errors);
        }
      }

      // Check for admin users
      const adminRole = roles.find(r => r.name === DEFAULT_ROLES.TENANT_ADMIN.name);
      if (adminRole) {
        const adminUsers = await prisma.userRole.count({
          where: { tenantId, roleId: adminRole.id }
        });

        if (adminUsers === 0) {
          warnings.push('No users with tenant admin role');
        }
      } else {
        warnings.push('No tenant admin role found');
      }

      return {
        valid: issues.length === 0,
        issues,
        warnings
      };
    } catch (error) {
      logger.error('Tenant validation failed', {
        tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        valid: false,
        issues: ['Validation failed due to error'],
        warnings: []
      };
    }
  }

  /**
   * Generate a temporary password
   */
  private static generateTempPassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /**
   * Get tenant health status
   */
  static async getTenantHealth(tenantId: string): Promise<{
    healthy: boolean;
    checks: {
      name: string;
      status: 'pass' | 'fail' | 'warn';
      message: string;
    }[];
  }> {
    const checks = [];

    // Check tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (!tenant) {
      checks.push({
        name: 'tenant_exists',
        status: 'fail',
        message: 'Tenant not found'
      });
      return { healthy: false, checks };
    }

    checks.push({
      name: 'tenant_exists',
      status: 'pass',
      message: 'Tenant exists'
    });

    // Check roles
    const roles = await prisma.tenantRole.findMany({
      where: { tenantId }
    });

    const hasRequiredRoles = [DEFAULT_ROLES.TENANT_ADMIN.name, DEFAULT_ROLES.TENANT_VIEWER.name]
      .every(roleName => roles.some(r => r.name === roleName));

    checks.push({
      name: 'rbac_configured',
      status: hasRequiredRoles ? 'pass' : 'fail',
      message: hasRequiredRoles ? 'RBAC roles configured' : 'Missing required RBAC roles'
    });

    // Check JWK key
    const activeKey = await prisma.jwkKey.findFirst({
      where: { tenantId, status: 'active' }
    });

    checks.push({
      name: 'jwk_key',
      status: activeKey ? 'pass' : 'warn',
      message: activeKey ? 'Active JWK key exists' : 'No active JWK key'
    });

    // Check settings
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId }
    });

    checks.push({
      name: 'settings_configured',
      status: settings ? 'pass' : 'warn',
      message: settings ? 'Settings configured' : 'No settings configured'
    });

    const healthy = checks.every(check => check.status !== 'fail');
    
    return { healthy, checks };
  }
}