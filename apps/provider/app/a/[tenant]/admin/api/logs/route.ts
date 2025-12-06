import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1000);

    const where: any = { tenantId: tenant.id };
    if (action) {
      where.action = { contains: action, mode: 'insensitive' };
    }

    const logs = await prisma.audit.findMany({
      where,
      include: {
        user: {
          select: { email: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
