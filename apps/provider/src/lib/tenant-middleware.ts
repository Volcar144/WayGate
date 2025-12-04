import { Prisma } from '@prisma/client';
import { getTenant } from '@/lib/tenant';

/**
 * Prisma middleware that enforces tenant isolation by automatically adding tenantId filters
 * to all queries and preventing cross-tenant access attempts.
 */

// Models that have tenantId field and should be automatically filtered
const TENANT_SCOPED_MODELS = [
  'User',
  'Client', 
  'AuthCode',
  'Session',
  'RefreshToken',
  'Consent',
  'JwkKey',
  'IdentityProvider',
  'ExternalIdentity',
  'Audit',
  'TenantRole',
  'UserRole',
  'TenantSettings'
];

// Operations that should be intercepted for tenant enforcement
const FILTERED_OPERATIONS = ['findUnique', 'findFirst', 'findMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'];

/**
 * Extract tenant slug from the current request context
 */
function getCurrentTenantSlug(): string | null {
  try {
    return getTenant();
  } catch {
    return null;
  }
}

/**
 * Add tenantId filter to query where clause
 */
function addTenantFilter(args: any, tenantId: string): any {
  const newArgs = { ...args };
  
  if (!newArgs.where) {
    newArgs.where = { tenantId };
  } else if (typeof newArgs.where === 'object') {
    // Handle composite unique constraints (e.g., tenantId_clientId)
    if (newArgs.where.tenantId_clientId) {
      // This is already properly scoped, don't modify
      return newArgs;
    } else if (newArgs.where.tenantId) {
      // TenantId already specified, ensure it matches
      if (newArgs.where.tenantId !== tenantId) {
        throw new Error(`Cross-tenant access attempted: tenantId ${newArgs.where.tenantId} does not match current tenant ${tenantId}`);
      }
    } else {
      // Add tenantId to existing where clause
      newArgs.where = { ...newArgs.where, tenantId };
    }
  }
  
  return newArgs;
}

/**
 * Validate that data being created/updated belongs to the correct tenant
 */
function validateTenantData(args: any, tenantId: string, operation: string): any {
  const newArgs = { ...args };
  
  if (newArgs.data) {
    if (typeof newArgs.data === 'object' && !Array.isArray(newArgs.data)) {
      if (newArgs.data.tenantId && newArgs.data.tenantId !== tenantId) {
        throw new Error(`Cross-tenant data modification attempted: tenantId ${newArgs.data.tenantId} does not match current tenant ${tenantId}`);
      }
      
      // For operations like upsert, we need to handle nested data structures
      if (operation === 'upsert') {
        ['create', 'update'].forEach(key => {
          if (newArgs.data[key] && typeof newArgs.data[key] === 'object' && newArgs.data[key].tenantId) {
            if (newArgs.data[key].tenantId !== tenantId) {
              throw new Error(`Cross-tenant data modification attempted in ${key}: tenantId ${newArgs.data[key].tenantId} does not match current tenant ${tenantId}`);
            }
          }
        });
      }
    }
  }
  
  // Automatically set tenantId for create operations
  if (operation === 'create' || (operation === 'upsert' && newArgs.data.create)) {
    const dataTarget = operation === 'create' ? newArgs.data : newArgs.data.create;
    if (typeof dataTarget === 'object' && !dataTarget.tenantId) {
      dataTarget.tenantId = tenantId;
    }
  }
  
  return newArgs;
}

/**
 * Create audit log entry for cross-tenant access attempts
 */
function logCrossTenantAttempt(model: string, operation: string, attemptedTenantId: string, currentTenantId: string | null) {
  console.error(`CROSS_TENANT_ACCESS_BLOCKED: ${model}.${operation} - Attempted tenant: ${attemptedTenantId}, Current tenant: ${currentTenantId || 'none'}`);
  
  // In a real implementation, you might want to create an audit entry
  // but for security reasons, we don't want to store which tenant was attempted
  // as that could leak information about other tenants
}

/**
 * Prisma middleware for tenant isolation
 */
export function tenantIsolationMiddleware() {
  return async (params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<any>) => {
    const { model, action, args } = params;
    
    // Skip tenant enforcement for Tenant model itself and non-tenant-scoped models
    if (!TENANT_SCOPED_MODELS.includes(model as string)) {
      return next(params);
    }
    
    // Only apply to specific operations
    if (!FILTERED_OPERATIONS.includes(action as string)) {
      return next(params);
    }
    
    const currentTenantSlug = getCurrentTenantSlug();
    
    // If no tenant context, allow only in development/specific cases
    if (!currentTenantSlug) {
      // In production, this should be an error, but for now we'll allow it
      // to not break existing functionality during migration
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Tenant context required for ${model}.${action} in production`);
      }
      return next(params);
    }
    
    try {
      // Get tenant ID from slug - this is a simplified approach
      // In a real implementation, you'd want to cache this or have it available in context
      const { prisma } = await import('@/lib/prisma');
      const tenant = await prisma.tenant.findUnique({
        where: { slug: currentTenantSlug },
        select: { id: true }
      });
      
      if (!tenant) {
        throw new Error(`Tenant '${currentTenantSlug}' not found`);
      }
      
      const tenantId = tenant.id;
      
      // Add tenant filtering to read operations
      if (['findUnique', 'findFirst', 'findMany'].includes(action as string)) {
        const filteredArgs = addTenantFilter(args, tenantId);
        return next({ ...params, args: filteredArgs });
      }
      
      // Validate tenant ownership for write operations
      if (['create', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'].includes(action as string)) {
        const validatedArgs = validateTenantData(args, tenantId, action as string);
        
        // For update/delete operations, also add tenant filter to where clause
        if (['update', 'updateMany', 'delete', 'deleteMany'].includes(action as string)) {
          const filteredArgs = addTenantFilter(validatedArgs, tenantId);
          return next({ ...params, args: filteredArgs });
        }
        
        // For create/upsert, just use the validated args
        return next({ ...params, args: validatedArgs });
      }
      
      return next(params);
      
    } catch (error) {
      // If this is a cross-tenant access attempt, log it
      if (error instanceof Error && error.message.includes('Cross-tenant')) {
        logCrossTenantAttempt(model as string, action as string, 'unknown', currentTenantSlug);
      }
      throw error;
    }
  };
}

/**
 * Helper function to apply tenant isolation middleware to Prisma client
 */
export function applyTenantIsolation(prismaClient: any) {
  prismaClient.$use(tenantIsolationMiddleware());
  return prismaClient;
}