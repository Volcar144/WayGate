import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();

    const keys = await prisma.jwkKey.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        kid: true,
        status: true,
        notBefore: true,
        notAfter: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ keys });
  } catch (error) {
    console.error('Error fetching keys:', error);
    return NextResponse.json({ error: 'Failed to fetch keys' }, { status: 500 });
  }
}
