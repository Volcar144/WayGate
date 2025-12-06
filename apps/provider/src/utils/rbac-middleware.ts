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
    
    // TODO: Get current user from session/auth context
    // This is a placeholder - you'll need to implement session retrieval
    // For now, we'll assume the request is authenticated
    
    // const userId = await getCurrentUserId(req);
    // if (!userId) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }
    
    // const hasPermission = await RbacService.hasPermission(
    //   tenant.id,
    //   userId,
    //   requiredPermission
    // );
    
    // if (!hasPermission) {
    //   return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    // }
    
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
