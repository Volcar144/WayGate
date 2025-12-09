import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { createAdminSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findTenantBySlug } from '@/services/jwks';
import { consumeMagicToken } from '@/services/authz';
import { RbacService } from '@/lib/rbac';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) {
    // In production, provide a friendly error with CTA
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse(
        JSON.stringify({
          error: 'Invalid request',
          message: 'Tenant context is required to access this endpoint',
          action: 'Please access this page through the proper tenant URL (/a/{tenant}/admin-login/callback)',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new NextResponse('Missing tenant', { status: 400 });
  }

  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return new NextResponse('Missing token', { status: 400 });
  }

  try {
    // Consume magic token
    const mt = await consumeMagicToken(token);
    if (!mt) {
      console.error('Magic token not found or expired:', { token, tenantSlug });
      return new NextResponse('Invalid or expired link', { status: 400 });
    }
    
    if (mt.tenantSlug !== tenantSlug) {
      console.error('Magic token tenant mismatch:', { expected: tenantSlug, actual: mt.tenantSlug, token });
      return new NextResponse('Invalid or expired link', { status: 400 });
    }

    const tenant = await findTenantBySlug(tenantSlug);
    if (!tenant) {
      return new NextResponse('Unknown tenant', { status: 400 });
    }

    // Find or create user with role assignment in a transaction
    // This prevents race conditions for the first-user admin assignment
    // Uses Serializable isolation to prevent concurrent "first user" detection
    const { user, isFirstUser } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Try to find existing user
      let existingUser = await tx.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: mt.email } }
      });

      let isFirst = false;

      if (!existingUser) {
        // Count users before creating to determine if this is the first user
        const userCount = await tx.user.count({ where: { tenantId: tenant.id } });
        isFirst = userCount === 0;

        // Create user
        existingUser = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: mt.email,
            name: null
          }
        });

        // Assign role based on whether this is the first user
        // Pass transaction client to ensure atomicity
        const roleName = isFirst ? 'tenant_admin' : 'tenant_viewer';
        await RbacService.assignRole(tenant.id, existingUser.id, roleName, existingUser.id, tx);
      }

      return { user: existingUser, isFirstUser: isFirst };
    }, { isolationLevel: 'Serializable' });

    // Check if user has tenant_admin role
    const roles = await RbacService.getUserRoles(tenant.id, user.id);
    type UserRoleAssignment = Awaited<ReturnType<typeof RbacService.getUserRoles>>[number];
    const isAdmin = roles.some((assignment: UserRoleAssignment) => assignment.role?.name === 'tenant_admin');

    if (!isAdmin) {
      return new NextResponse('Access denied: admin role required', { status: 403 });
    }

    // Create admin session
    await createAdminSession(user.id, tenant.id);

    // Create audit log - don't block login on audit failure
    try {
      await prisma.audit.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          action: 'admin.login',
          ip: req.headers.get('x-forwarded-for') || null,
          userAgent: req.headers.get('user-agent') || null
        }
      });
    } catch (auditError) {
      console.error('Failed to create audit log for admin login:', auditError);
      // Continue with login even if audit fails
    }

    // Redirect to admin dashboard
    const redirectUrl = new URL(`/a/${tenantSlug}/admin`, req.url);
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error('Admin login error:', error);
    return new NextResponse('Login failed', { status: 500 });
  }
}
