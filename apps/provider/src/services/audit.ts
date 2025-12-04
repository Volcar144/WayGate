import { prisma } from '@/lib/prisma';
import { requireTenant, tenantAuditRepo } from '@/lib/tenant-repo';
import { logger } from '@/utils/logger';
import { headers } from 'next/headers';

export interface AuditContext {
  userId?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: any;
  ip?: string;
  userAgent?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Enhanced audit service with tenant context and security event tracking
 */
export class AuditService {
  /**
   * Create an audit entry with automatic tenant context
   */
  static async create(context: AuditContext, tenantSlug?: string): Promise<void> {
    const tenant = tenantSlug ? 
      await prisma.tenant.findUnique({ where: { slug: tenantSlug } }) :
      await requireTenant();
    
    if (!tenant) {
      logger.error('Audit failed: tenant not found', { tenantSlug, action: context.action });
      return;
    }

    // Get request context
    const requestHeaders = headers();
    const ip = context.ip || requestHeaders.get('x-forwarded-for') || requestHeaders.get('x-real-ip') || null;
    const userAgent = context.userAgent || requestHeaders.get('user-agent') || null;
    const requestId = requestHeaders.get('x-request-id') || undefined;

    // Log security-sensitive events
    if (this.isSecurityEvent(context.action)) {
      logger.warn('Security event detected', {
        tenantId: tenant.id,
        tenantSlug,
        action: context.action,
        userId: context.userId,
        resource: context.resource,
        resourceId: context.resourceId,
        ip,
        severity: context.severity || 'medium',
        requestId,
        ...context.details
      });

      // Set Sentry context for security events
      try {
        const Sentry = require('@sentry/nextjs');
        Sentry.withScope((scope: any) => {
          scope.setTag('security_event', 'true');
          scope.setTag('action', context.action);
          scope.setTag('severity', context.severity || 'medium');
          scope.setExtra('tenantId', tenant.id);
          scope.setExtra('userId', context.userId);
          scope.setExtra('resource', context.resource);
          scope.setExtra('ip', ip);
          Sentry.captureMessage(`Security event: ${context.action}`);
        });
      } catch {
        // Sentry not available
      }
    }

    await tenantAuditRepo.create(tenant.id, {
      userId: context.userId,
      action: context.action,
      ip,
      userAgent,
    });

    logger.debug('Audit entry created', {
      tenantId: tenant.id,
      tenantSlug,
      action: context.action,
      userId: context.userId,
      resourceId: context.resourceId,
      requestId,
    });
  }

  /**
   * Log cross-tenant access attempt
   */
  static async logCrossTenantAccess(
    attemptedTenantId: string,
    actualTenantId: string,
    context: { userId?: string; action: string; resource?: string }
  ): Promise<void> {
    const severity: 'high' | 'critical' = context.action.includes('delete') ? 'critical' : 'high';

    await this.create({
      userId: context.userId,
      action: 'security.cross_tenant_access_attempt',
      resource: context.resource,
      details: {
        attemptedTenantId,
        actualTenantId,
        originalAction: context.action,
        severity
      },
      severity
    });

    logger.error('Cross-tenant access attempt blocked', {
      attemptedTenantId,
      actualTenantId,
      userId: context.userId,
      action: context.action,
      resource: context.resource,
      severity
    });
  }

  /**
   * Log permission denied event
   */
  static async logPermissionDenied(
    permission: string,
    context: { userId?: string; action: string; resource?: string }
  ): Promise<void> {
    await this.create({
      userId: context.userId,
      action: 'security.permission_denied',
      resource: context.resource,
      details: {
        requiredPermission: permission,
        attemptedAction: context.action,
        severity: 'medium'
      },
      severity: 'medium'
    });

    logger.warn('Permission denied', {
      permission,
      userId: context.userId,
      action: context.action,
      resource: context.resource
    });
  }

  /**
   * Log rate limit exceeded
   */
  static async logRateLimitExceeded(
    limitType: 'ip' | 'client',
    context: { clientId?: string; limit: number; windowMs: number }
  ): Promise<void> {
    await this.create({
      action: 'security.rate_limit_exceeded',
      details: {
        limitType,
        clientId: context.clientId,
        limit: context.limit,
        windowMs: context.windowMs,
        severity: 'medium'
      },
      severity: 'medium'
    });

    logger.warn('Rate limit exceeded', {
      limitType,
      clientId: context.clientId,
      limit: context.limit,
      windowMs: context.windowMs
    });
  }

  /**
   * Log authentication failure
   */
  static async logAuthFailure(
    reason: string,
    context: { email?: string; clientId?: string; ip?: string }
  ): Promise<void> {
    await this.create({
      action: 'security.auth_failure',
      details: {
        reason,
        email: context.email,
        clientId: context.clientId,
        severity: 'medium'
      },
      ip: context.ip,
      severity: 'medium'
    });

    logger.warn('Authentication failure', {
      reason,
      email: context.email,
      clientId: context.clientId,
      ip: context.ip
    });
  }

  /**
   * Log successful authentication
   */
  static async logAuthSuccess(
    method: string,
    context: { userId: string; email?: string; clientId?: string }
  ): Promise<void> {
    await this.create({
      userId: context.userId,
      action: 'auth.success',
      details: {
        method,
        email: context.email,
        clientId: context.clientId,
        severity: 'low'
      },
      severity: 'low'
    });

    logger.info('Authentication successful', {
      method,
      userId: context.userId,
      email: context.email,
      clientId: context.clientId
    });
  }

  /**
   * Get audit logs for a tenant with filtering
   */
  static async getAuditLogs(
    filters: {
      userId?: string;
      action?: string;
      resource?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    },
    tenantSlug?: string
  ) {
    const tenant = tenantSlug ? 
      await prisma.tenant.findUnique({ where: { slug: tenantSlug } }) :
      await requireTenant();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return await tenantAuditRepo.findMany(tenant.id, {
      userId: filters.userId,
      action: filters.action && `*${filters.action}*`,
      limit: filters.limit || 50,
      offset: filters.offset || 0,
      startDate: filters.startDate,
      endDate: filters.endDate,
    });
  }

  /**
   * Check if an action is a security-sensitive event
   */
  private static isSecurityEvent(action: string): boolean {
    const securityActions = [
      'security.',
      'auth.failure',
      'token.reuse_detected',
      'permission_denied',
      'cross_tenant_access_attempt',
      'rate_limit_exceeded',
      'admin.',
      'delete',
      'create',
      'update'
    ];

    return securityActions.some(pattern => action.includes(pattern));
  }

  /**
   * Get security events for monitoring
   */
  static async getSecurityEvents(
    filters: {
      severity?: 'medium' | 'high' | 'critical';
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    },
    tenantSlug?: string
  ) {
    const tenant = tenantSlug ? 
      await prisma.tenant.findUnique({ where: { slug: tenantSlug } }) :
      await requireTenant();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const securityActions = [
      'security.cross_tenant_access_attempt',
      'security.permission_denied',
      'security.rate_limit_exceeded',
      'security.auth_failure',
      'token.reuse_detected'
    ];

    return await tenantAuditRepo.findMany(tenant.id, {
      action: securityActions.join(','),
      limit: filters.limit || 100,
      startDate: filters.startDate,
      endDate: filters.endDate,
    });
  }
}