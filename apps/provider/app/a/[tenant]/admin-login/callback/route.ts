import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { createAdminSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findTenantBySlug } from '@/services/jwks';
import { consumeMagicToken } from '@/services/authz';
import { RbacService } from '@/lib/rbac';

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  if (!tenantSlug) {
    return new NextResponse('Missing tenant', { status: 400 });
  }

  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return new NextResponse('Missing token', { status: 400 });
  }

  try {
    // Consume magic token
    const mt = await consumeMagicToken(token);
    if (!mt || mt.tenantSlug !== tenantSlug) {
      return new NextResponse('Invalid or expired link', { status: 400 });
    }

    const tenant = await findTenantBySlug(tenantSlug);
    if (!tenant) {
      return new NextResponse('Unknown tenant', { status: 400 });
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: mt.email } }
    });

    if (!user) {
      // Create user
      user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: mt.email,
          name: null
        }
      });

      // Check if this is the first user in the tenant - if so, make them admin
      const userCount = await prisma.user.count({ where: { tenantId: tenant.id } });
      if (userCount === 1) {
        await RbacService.assignRole(tenant.id, user.id, 'tenant_admin', user.id);
      } else {
        // Otherwise assign viewer role
        await RbacService.assignRole(tenant.id, user.id, 'tenant_viewer', user.id);
      }
    }

    // Check if user has tenant_admin role
    const roles = await RbacService.getUserRoles(tenant.id, user.id);
    type UserRoleAssignment = Awaited<ReturnType<typeof RbacService.getUserRoles>>[number];
    const isAdmin = roles.some((assignment: UserRoleAssignment) => assignment.role?.name === 'tenant_admin');

    if (!isAdmin) {
      return new NextResponse('Access denied: admin role required', { status: 403 });
    }

    // Create admin session
    await createAdminSession(user.id, tenant.id);

    // Create audit log
    await prisma.audit.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: 'admin.login',
        ip: req.headers.get('x-forwarded-for') || null,
        userAgent: req.headers.get('user-agent') || null
      }
    });

    // Redirect to admin dashboard
    const redirectUrl = new URL(`/a/${tenantSlug}/admin`, req.url);
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error('Admin login error:', error);
    return new NextResponse('Login failed', { status: 500 });
  }
}
