import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { getAdminSession } from '@/lib/auth';
import { RbacService, PERMISSIONS } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/services/audit';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
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

    const flow = await prisma.flow.findFirst({
      where: { id: params.id, tenantId: tenant.id },
    });

    if (!flow) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
    }

    // Ensure nodes is always an array
    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];

    return NextResponse.json({ 
      flow: {
        ...flow,
        nodes,
      }
    });
  } catch (error) {
    console.error('Error fetching flow:', error);
    return NextResponse.json({ error: 'Failed to fetch flow' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  try {
    const tenant = await requireTenant();
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await RbacService.hasPermission(
      tenant.id,
      session.userId,
      PERMISSIONS.CLIENT_UPDATE
    );
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();

    const flow = await prisma.flow.update({
      where: { id: params.id },
      data: {
        name: body.name,
        status: body.status,
        trigger: body.trigger,
        nodes: body.nodes || [],
      },
    });

    await AuditService.create({
      action: 'flow.updated',
      resource: 'flow',
      resourceId: flow.id,
      details: {
        name: body.name,
        status: body.status,
      },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }, tenant.slug);

    return NextResponse.json({ 
      flow: {
        ...flow,
        nodes: Array.isArray(flow.nodes) ? flow.nodes : [],
      }
    });
  } catch (error) {
    console.error('Error updating flow:', error);
    return NextResponse.json({ error: 'Failed to update flow' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  try {
    const tenant = await requireTenant();
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await RbacService.hasPermission(
      tenant.id,
      session.userId,
      PERMISSIONS.CLIENT_DELETE
    );
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify flow belongs to tenant
    const flow = await prisma.flow.findFirst({
      where: { id: params.id, tenantId: tenant.id },
    });

    if (!flow) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
    }

    await prisma.flow.delete({
      where: { id: params.id },
    });

    await AuditService.create({
      action: 'flow.deleted',
      resource: 'flow',
      resourceId: params.id,
      details: { name: flow.name },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }, tenant.slug);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting flow:', error);
    return NextResponse.json({ error: 'Failed to delete flow' }, { status: 500 });
  }
}
