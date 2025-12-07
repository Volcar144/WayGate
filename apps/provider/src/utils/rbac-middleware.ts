import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { RbacService, PERMISSIONS, Permission } from '@/lib/rbac';

/**
 * Middleware to check RBAC permissions for API routes
 * Note: This is a helper that would need to be integrated with your auth system
 */
export async function withRbacCheck(
  req: NextRequest,
  requiredPermission: Permission,
  handler: (req: NextRequest) => Promise<Response>
): Promise<Response> {
  try {
    const tenant = await requireTenant();
    // Attempt to resolve the current user from common auth locations:
    // 1. `x-user-id` header (useful for internal calls / dev)
    // 2. `Authorization: Bearer <jwt>` header (decode payload without verifying signature)
    //    and use `sub` claim as the user id.
    // If neither is present, return 401.
    const headers = req.headers;
    let userId: string | null = null;

    const devUser = headers.get('x-user-id');
    if (devUser) {
      userId = devUser;
    }

    if (!userId) {
      const auth = headers.get('authorization') || headers.get('Authorization');
      if (auth && auth.toLowerCase().startsWith('bearer ')) {
        const token = auth.slice(7).trim();
        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as any;
            userId = (payload && (payload.sub || payload.userId || payload.uid)) ?? null;
          }
        } catch (err) {
          // ignore parse errors; we'll treat as unauthenticated
          userId = null;
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check permission using RBAC service
    const hasPermission = await RbacService.hasPermission(tenant.id, userId, requiredPermission);
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return await handler(req);
  } catch (error) {
    console.error('RBAC check failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Helper to check if a user has a specific permission
 */
export async function checkPermission(
  tenantId: string,
  userId: string,
  permission: Permission
): Promise<boolean> {
  return await RbacService.hasPermission(tenantId, userId, permission);
}
