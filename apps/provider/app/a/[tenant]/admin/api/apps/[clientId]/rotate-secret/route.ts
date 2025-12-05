import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/services/audit';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const tenant = await requireTenant();
    const { clientId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, tenantId: tenant.id },
    });

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const newSecret = crypto.randomBytes(32).toString('hex');

    await prisma.client.update({
      where: { id: clientId },
      data: { clientSecret: newSecret },
    });

    // Create audit event
    await AuditService.create({
      action: 'client.secret_rotated',
      resource: 'client',
      resourceId: client.id,
      details: { clientId: client.clientId, name: client.name },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ clientSecret: newSecret });
  } catch (error) {
    console.error('Error rotating secret:', error);
    return NextResponse.json({ error: 'Failed to rotate secret' }, { status: 500 });
  }
}
