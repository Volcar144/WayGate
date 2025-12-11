import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { getAdminSession } from '@/lib/auth';
import { RbacService, PERMISSIONS } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/services/audit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await RbacService.hasPermission(
      tenant.id,
      session.userId,
      PERMISSIONS.CLIENT_READ
    );
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const flows = await prisma.flow.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        name: true,
        trigger: true,
        status: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ flows });
  } catch (error) {
    console.error('Error fetching flows:', error);
    return NextResponse.json({ error: 'Failed to fetch flows' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await RbacService.hasPermission(
      tenant.id,
      session.userId,
      PERMISSIONS.CLIENT_CREATE
    );
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();

    const flow = await prisma.flow.create({
      data: {
        tenantId: tenant.id,
        name: body.name || `Flow_${Date.now()}`,
        trigger: body.trigger || 'custom',
        status: body.status || 'disabled',
        nodes: body.nodes || [],
      },
      select: {
        id: true,
        name: true,
        trigger: true,
        status: true,
        nodes: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await AuditService.create({
      action: 'flow.created',
      resource: 'flow',
      resourceId: flow.id,
      details: {
        name: flow.name,
        trigger: flow.trigger,
      },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }, tenant.slug);

    return NextResponse.json({ flow });
  } catch (error) {
    console.error('Error creating flow:', error);
    return NextResponse.json({ error: 'Failed to create flow' }, { status: 500 });
  }
}
