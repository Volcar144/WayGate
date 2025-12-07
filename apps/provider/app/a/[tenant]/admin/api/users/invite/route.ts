import { NextRequest, NextResponse } from 'next/server';
import { requireTenantAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/services/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const context = await requireTenantAdmin();
    const body = await req.json();
    const { email, name } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: context.tenant.id, email: email.toLowerCase() } },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User already exists' }, { status: 409 });
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        tenantId: context.tenant.id,
        email: email.toLowerCase(),
        name,
      },
    });

    // Assign tenant_viewer role by default
    const viewerRole = await prisma.tenantRole.findFirst({
      where: { tenantId: context.tenant.id, name: 'tenant_viewer' },
    });

    if (viewerRole) {
      await prisma.userRole.create({
        data: {
          tenantId: context.tenant.id,
          userId: user.id,
          roleId: viewerRole.id,
        },
      });
    }

    // Create audit event
    await AuditService.create({
      userId: context.user.id,
      action: 'user.invited',
      resource: 'user',
      resourceId: user.id,
      details: { email, invitedUserId: user.id },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }, context.tenant.slug);

    return NextResponse.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('Error inviting user:', error);
    return NextResponse.json({ error: 'Failed to invite user' }, { status: 500 });
  }
}
