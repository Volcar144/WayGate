import { prisma } from '@/lib/prisma';
import { requireTenant } from './tenant-repo';

// Permission constants
export const PERMISSIONS = {
  // User management
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  
  // Client management
  CLIENT_READ: 'client:read',
  CLIENT_CREATE: 'client:create',
  CLIENT_UPDATE: 'client:update',
  CLIENT_DELETE: 'client:delete',
  
  // Key management
  KEY_READ: 'key:read',
  KEY_CREATE: 'key:create',
  KEY_ROTATE: 'key:rotate',
  KEY_DELETE: 'key:delete',
  
  // Identity provider management
  IDP_READ: 'idp:read',
  IDP_CREATE: 'idp:create',
  IDP_UPDATE: 'idp:update',
  IDP_DELETE: 'idp:delete',
  
  // Audit and monitoring
  AUDIT_READ: 'audit:read',
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',
  
  // Tenant administration
  TENANT_ADMIN: 'tenant:admin',
  TENANT_VIEWER: 'tenant:viewer'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// Role definitions
export const DEFAULT_ROLES = {
  TENANT_ADMIN: {
    name: 'tenant_admin',
    description: 'Full administrative access to tenant resources',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.USER_DELETE,
      PERMISSIONS.CLIENT_READ,
      PERMISSIONS.CLIENT_CREATE,
      PERMISSIONS.CLIENT_UPDATE,
      PERMISSIONS.CLIENT_DELETE,
      PERMISSIONS.KEY_READ,
      PERMISSIONS.KEY_CREATE,
      PERMISSIONS.KEY_ROTATE,
      PERMISSIONS.IDP_READ,
      PERMISSIONS.IDP_CREATE,
      PERMISSIONS.IDP_UPDATE,
      PERMISSIONS.IDP_DELETE,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.SETTINGS_READ,
      PERMISSIONS.SETTINGS_UPDATE,
      PERMISSIONS.TENANT_ADMIN
    ]
  },
  
  TENANT_VIEWER: {
    name: 'tenant_viewer',
    description: 'Read-only access to tenant resources',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.CLIENT_READ,
      PERMISSIONS.KEY_READ,
      PERMISSIONS.IDP_READ,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.SETTINGS_READ,
      PERMISSIONS.TENANT_VIEWER
    ]
  }
} as const;

export type RoleName = keyof typeof DEFAULT_ROLES;

/**
 * RBAC service for tenant role-based access control
 */
export class RbacService {
  /**
   * Initialize default roles for a tenant
   */
  static async initializeTenantRoles(tenantId: string) {
    const roles = [];
    
    for (const [roleKey, roleConfig] of Object.entries(DEFAULT_ROLES)) {
      const role = await prisma.tenantRole.upsert({
        where: {
          tenantId_name: {
            tenantId,
            name: roleConfig.name
          }
        },
        update: {
          description: roleConfig.description,
          permissions: roleConfig.permissions
        },
        create: {
          tenantId,
          name: roleConfig.name,
          description: roleConfig.description,
          permissions: roleConfig.permissions
        }
      });
      roles.push(role);
    }
    
    return roles;
  }

  /**
   * Get all roles for a tenant
   */
  static async getTenantRoles(tenantId: string) {
    return await prisma.tenantRole.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' }
    });
  }

  /**
   * Assign a role to a user within a tenant
   */
  static async assignRole(tenantId: string, userId: string, roleName: string, assignedBy?: string) {
    // Verify the role exists for this tenant
    const role = await prisma.tenantRole.findFirst({
      where: { tenantId, name: roleName }
    });
    
    if (!role) {
      throw new Error(`Role '${roleName}' not found for tenant`);
    }

    // Create or update the user role assignment
    return await prisma.userRole.upsert({
      where: {
        tenantId_userId_roleId: {
          tenantId,
          userId,
          roleId: role.id
        }
      },
      update: {
        assignedBy
      },
      create: {
        tenantId,
        userId,
        roleId: role.id,
        assignedBy
      }
    });
  }

  /**
   * Remove a role from a user within a tenant
   */
  static async removeRole(tenantId: string, userId: string, roleName: string) {
    const role = await prisma.tenantRole.findFirst({
      where: { tenantId, name: roleName }
    });
    
    if (!role) {
      throw new Error(`Role '${roleName}' not found for tenant`);
    }

    const deleted = await prisma.userRole.deleteMany({
      where: {
        tenantId,
        userId,
        roleId: role.id
      }
    });

    return deleted.count > 0;
  }

  /**
   * Get all roles assigned to a user within a tenant
   */
  static async getUserRoles(tenantId: string, userId: string) {
    return await prisma.userRole.findMany({
      where: { tenantId, userId },
      include: {
        role: {
          select: { name: true, description: true, permissions: true }
        }
      }
    });
  }

  /**
   * Get all permissions for a user within a tenant
   */
  static async getUserPermissions(tenantId: string, userId: string): Promise<Permission[]> {
    const userRoles = await this.getUserRoles(tenantId, userId);
    const permissions = new Set<Permission>();
    
    for (const userRole of userRoles) {
      const rolePermissions = userRole.role.permissions as Permission[];
      rolePermissions.forEach(permission => permissions.add(permission));
    }
    
    return Array.from(permissions);
  }

  /**
   * Check if a user has a specific permission within a tenant
   */
  static async hasPermission(tenantId: string, userId: string, permission: Permission): Promise<boolean> {
    const permissions = await this.getUserPermissions(tenantId, userId);
    return permissions.includes(permission);
  }

  /**
   * Check if a user has any of the specified permissions within a tenant
   */
  static async hasAnyPermission(tenantId: string, userId: string, permissions: Permission[]): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(tenantId, userId);
    return permissions.some(permission => userPermissions.includes(permission));
  }

  /**
   * Get all users with their roles for a tenant
   */
  static async getTenantUsersWithRoles(tenantId: string) {
    return await prisma.user.findMany({
      where: { tenantId },
      include: {
        userRoles: {
          include: {
            role: {
              select: { name: true, description: true }
            }
          }
        }
      },
      orderBy: { email: 'asc' }
    });
  }

  /**
   * Create a custom role for a tenant
   */
  static async createCustomRole(
    tenantId: string, 
    name: string, 
    description: string, 
    permissions: Permission[]
  ) {
    return await prisma.tenantRole.create({
      data: {
        tenantId,
        name,
        description,
        permissions
      }
    });
  }

  /**
   * Update a custom role
   */
  static async updateRole(
    tenantId: string,
    roleName: string,
    updates: {
      description?: string;
      permissions?: Permission[];
    }
  ) {
    const role = await prisma.tenantRole.findFirst({
      where: { tenantId, name: roleName }
    });
    
    if (!role) {
      throw new Error(`Role '${roleName}' not found for tenant`);
    }

    // Prevent modification of default roles
    if (Object.values(DEFAULT_ROLES).some(defaultRole => defaultRole.name === roleName)) {
      throw new Error(`Cannot modify default role '${roleName}'`);
    }

    return await prisma.tenantRole.update({
      where: { id: role.id },
      data: updates
    });
  }

  /**
   * Delete a custom role
   */
  static async deleteRole(tenantId: string, roleName: string) {
    const role = await prisma.tenantRole.findFirst({
      where: { tenantId, name: roleName }
    });
    
    if (!role) {
      throw new Error(`Role '${roleName}' not found for tenant`);
    }

    // Prevent deletion of default roles
    if (Object.values(DEFAULT_ROLES).some(defaultRole => defaultRole.name === roleName)) {
      throw new Error(`Cannot delete default role '${roleName}'`);
    }

    // Delete all user role assignments first
    await prisma.userRole.deleteMany({
      where: { roleId: role.id }
    });

    // Delete the role
    return await prisma.tenantRole.delete({
      where: { id: role.id }
    });
  }
}

/**
 * Middleware function to check permissions
 */
export function requirePermission(permission: Permission) {
  return async (tenantId: string, userId: string): Promise<void> => {
    const hasPermission = await RbacService.hasPermission(tenantId, userId, permission);
    if (!hasPermission) {
      throw new Error(`Permission '${permission}' required`);
    }
  };
}

/**
 * Middleware function to check any of multiple permissions
 */
export function requireAnyPermission(permissions: Permission[]) {
  return async (tenantId: string, userId: string): Promise<void> => {
    const hasAnyPermission = await RbacService.hasAnyPermission(tenantId, userId, permissions);
    if (!hasAnyPermission) {
      throw new Error(`One of permissions [${permissions.join(', ')}] required`);
    }
  };
}

/**
 * Check if current user has permission (for use in API routes)
 */
export async function checkCurrentUserPermission(permission: Permission): Promise<void> {
  const tenant = await requireTenant();
  
  // This would typically get the current user from session/auth context
  // For now, we'll throw an error indicating this needs to be implemented
  // based on the specific authentication mechanism being used
  throw new Error('Current user context not implemented - integrate with your auth system');
}