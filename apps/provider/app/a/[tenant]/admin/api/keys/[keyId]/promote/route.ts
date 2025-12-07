import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { requireTenantAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/services/audit';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const context = await requireTenantAdmin();
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

    // Get current active key first
    const currentActive = await prisma.jwkKey.findFirst({
      where: { tenantId: tenant.id, status: 'active' },
    });

    // Retire current active key and promote new key in a transaction to ensure atomicity
    const promoted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Retire current active key if it exists
      if (currentActive) {
        await tx.jwkKey.update({
          where: { id: currentActive.id },
          data: { status: 'retired', notAfter: new Date() },
        });
      }

      // Promote new key to active
      return tx.jwkKey.update({
        where: { id: keyId },
        data: { status: 'active' },
      });
    });

    // Create audit event
    await AuditService.create({
      userId: context.user.id,
      action: 'key.promoted',
      resource: 'key',
      resourceId: keyId,
      details: {
        kid: key.kid,
        retiredKid: currentActive?.kid,
      },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }, tenant.slug);

    return NextResponse.json({ key: promoted });
  } catch (error) {
    console.error('Error promoting key:', error);
    return NextResponse.json({ error: 'Failed to promote key' }, { status: 500 });
  }
}
