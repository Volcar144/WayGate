import { prisma } from '@/lib/prisma';
import { getTenant } from '@/lib/tenant';

/**
 * Tenant-aware repository helpers that enforce data isolation.
 * All queries automatically include tenantId filtering to prevent cross-tenant access.
 */

export interface TenantContext {
  id: string;
  slug: string;
}

/**
 * Get the current tenant context from request headers.
 * Throws an error if tenant is not found or invalid.
 */
export async function requireTenant(): Promise<TenantContext> {
  const tenantSlug = getTenant();
  if (!tenantSlug) {
    throw new Error('Tenant required but not found in request');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true }
  });

  if (!tenant) {
    throw new Error(`Tenant '${tenantSlug}' not found`);
  }

  return tenant;
}

/**
 * Get the current tenant context or return null if not found.
 */
export async function getCurrentTenant(): Promise<TenantContext | null> {
  const tenantSlug = getTenant();
  if (!tenantSlug) return null;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true }
  });

  return tenant;
}

/**
 * Tenant-aware user repository
 */
export const tenantUserRepo = {
  async findUnique(tenantId: string, email: string) {
    return await prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      include: {
        userRoles: {
          include: {
            role: {
              select: { name: true, permissions: true }
            }
          }
        }
      }
    });
  },

  async findMany(tenantId: string, options?: { skip?: number; take?: number; where?: any }) {
    return await prisma.user.findMany({
      where: { tenantId, ...options?.where },
      include: {
        userRoles: {
          include: {
            role: {
              select: { name: true, permissions: true }
            }
          }
        }
      },
      skip: options?.skip,
      take: options?.take,
      orderBy: { createdAt: 'desc' }
    });
  },

  async create(tenantId: string, data: { email: string; name?: string }) {
    return await prisma.user.create({
      data: {
        tenantId,
        email: data.email.toLowerCase(),
        name: data.name
      }
    });
  },

  async update(tenantId: string, userId: string, data: { name?: string }) {
    // Verify user belongs to tenant before updating
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId }
    });

    if (!user) {
      throw new Error('User not found or does not belong to tenant');
    }

    return await prisma.user.update({
      where: { id: userId },
      data
    });
  },

  async delete(tenantId: string, userId: string) {
    // Verify user belongs to tenant before deleting
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId }
    });

    if (!user) {
      throw new Error('User not found or does not belong to tenant');
    }

    return await prisma.user.delete({
      where: { id: userId }
    });
  }
};

/**
 * Tenant-aware client repository
 */
export const tenantClientRepo = {
  async findUnique(tenantId: string, clientId: string) {
    return await prisma.client.findUnique({
      where: { tenantId_clientId: { tenantId, clientId } }
    });
  },

  async findMany(tenantId: string, options?: { skip?: number; take?: number }) {
    return await prisma.client.findMany({
      where: { tenantId },
      skip: options?.skip,
      take: options?.take,
      orderBy: { createdAt: 'desc' }
    });
  },

  async create(tenantId: string, data: {
    clientId: string;
    clientSecret?: string;
    name: string;
    redirectUris: string[];
    grantTypes: string[];
    firstParty?: boolean;
  }) {
    return await prisma.client.create({
      data: {
        tenantId,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        name: data.name,
        redirectUris: data.redirectUris,
        grantTypes: data.grantTypes,
        firstParty: data.firstParty || false
      }
    });
  },

  async update(tenantId: string, clientDbId: string, data: Partial<{
    clientSecret: string;
    name: string;
    redirectUris: string[];
    grantTypes: string[];
    firstParty: boolean;
  }>) {
    // Verify client belongs to tenant before updating
    const client = await prisma.client.findFirst({
      where: { id: clientDbId, tenantId }
    });

    if (!client) {
      throw new Error('Client not found or does not belong to tenant');
    }

    return await prisma.client.update({
      where: { id: clientDbId },
      data
    });
  },

  async delete(tenantId: string, clientDbId: string) {
    // Verify client belongs to tenant before deleting
    const client = await prisma.client.findFirst({
      where: { id: clientDbId, tenantId }
    });

    if (!client) {
      throw new Error('Client not found or does not belong to tenant');
    }

    return await prisma.client.delete({
      where: { id: clientDbId }
    });
  }
};

/**
 * Tenant-aware settings repository
 */
export const tenantSettingsRepo = {
  async get(tenantId: string) {
    return await prisma.tenantSettings.findUnique({
      where: { tenantId }
    });
  },

  async upsert(tenantId: string, data: {
    displayName?: string;
    logoUrl?: string;
    brandColor?: string;
    theme?: any;
    contactEmail?: string;
    privacyPolicyUrl?: string;
    termsOfServiceUrl?: string;
    rateLimitConfig?: any;
    ssoConfig?: any;
  }) {
    return await prisma.tenantSettings.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data }
    });
  }
};

/**
 * Tenant-aware audit repository
 */
export const tenantAuditRepo = {
  async create(tenantId: string, data: {
    userId?: string;
    action: string;
    ip?: string;
    userAgent?: string;
    details?: any;
  }) {
    return await prisma.audit.create({
      data: {
        tenantId,
        userId: data.userId,
        action: data.action,
        ip: data.ip,
        userAgent: data.userAgent
      }
    });
  },

  async findMany(tenantId: string, options?: {
    userId?: string;
    action?: string;
    limit?: number;
    offset?: number;
    startDate?: Date;
    endDate?: Date;
  }) {
    const where: any = { tenantId };
    
    if (options?.userId) where.userId = options.userId;
    if (options?.action) where.action = { contains: options.action, mode: 'insensitive' };
    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options?.startDate) where.createdAt.gte = options.startDate;
      if (options?.endDate) where.createdAt.lte = options.endDate;
    }

    return await prisma.audit.findMany({
      where,
      include: {
        user: {
          select: { email: true, name: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0
    });
  }
};

/**
 * Verify that a resource belongs to the specified tenant.
 * Throws an error if the resource is not found or doesn't belong to the tenant.
 */
export async function verifyTenantOwnership(
  resourceType: 'user' | 'client' | 'session' | 'authCode' | 'refreshToken' | 'consent' | 'jwkKey' | 'identityProvider' | 'audit',
  resourceId: string,
  expectedTenantId: string
): Promise<void> {
  let resource;

  switch (resourceType) {
    case 'user':
      resource = await prisma.user.findFirst({ where: { id: resourceId, tenantId: expectedTenantId } });
      break;
    case 'client':
      resource = await prisma.client.findFirst({ where: { id: resourceId, tenantId: expectedTenantId } });
      break;
    case 'session':
      resource = await prisma.session.findFirst({ where: { id: resourceId, tenantId: expectedTenantId } });
      break;
    case 'authCode':
      resource = await prisma.authCode.findFirst({ where: { id: resourceId, tenantId: expectedTenantId } });
      break;
    case 'refreshToken':
      resource = await prisma.refreshToken.findFirst({ where: { id: resourceId, tenantId: expectedTenantId } });
      break;
    case 'consent':
      resource = await prisma.consent.findFirst({ where: { id: resourceId, tenantId: expectedTenantId } });
      break;
    case 'jwkKey':
      resource = await prisma.jwkKey.findFirst({ where: { id: resourceId, tenantId: expectedTenantId } });
      break;
    case 'identityProvider':
      resource = await prisma.identityProvider.findFirst({ where: { id: resourceId, tenantId: expectedTenantId } });
      break;
    case 'audit':
      // Audit.id is a BigInt in the schema, convert incoming string id to BigInt
      try {
        const auditId = BigInt(resourceId as string);
        resource = await prisma.audit.findFirst({ where: { id: auditId as any, tenantId: expectedTenantId } });
      } catch (e) {
        throw new Error('Invalid audit id');
      }
      break;
    default:
      throw new Error(`Unknown resource type: ${resourceType}`);
  }

  if (!resource) {
    throw new Error(`${resourceType} not found or does not belong to tenant`);
  }
}