import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/services/audit';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const tenant = await requireTenant();
    const { keyId } = await params;

    const key = await prisma.jwkKey.findFirst({
      where: { id: keyId, tenantId: tenant.id },
    });

    if (!key) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }

    if (key.status !== 'staged') {
      return NextResponse.json(
        { error: 'Only staged keys can be promoted' },
        { status: 400 }
      );
    }

    // Retire current active key if it exists
    const currentActive = await prisma.jwkKey.findFirst({
      where: { tenantId: tenant.id, status: 'active' },
    });

    if (currentActive) {
      await prisma.jwkKey.update({
        where: { id: currentActive.id },
        data: { status: 'retired', notAfter: new Date() },
      });
    }

    // Promote new key to active
    const promoted = await prisma.jwkKey.update({
      where: { id: keyId },
      data: { status: 'active' },
    });

    // Create audit event
    await AuditService.create({
      action: 'key.promoted',
      resource: 'key',
      resourceId: keyId,
      details: {
        kid: key.kid,
        retiredKid: currentActive?.kid,
      },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ key: promoted });
  } catch (error) {
    console.error('Error promoting key:', error);
    return NextResponse.json({ error: 'Failed to promote key' }, { status: 500 });
  }
}
