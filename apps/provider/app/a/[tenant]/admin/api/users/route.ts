import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { requireTenant } from '@/lib/tenant-repo';
import { RbacService, PERMISSIONS } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();

    // Fetch users with their sessions and roles
    const users = await prisma.user.findMany({
      where: { tenantId: tenant.id },
      include: {
        sessions: {
          where: { expiresAt: { gt: new Date() } },
          select: { id: true, expiresAt: true },
        },
        userRoles: {
          include: {
            role: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedUsers = users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      sessions: user.sessions,
      roles: user.userRoles.map((ur) => ({ name: ur.role.name })),
    }));

    return NextResponse.json({ users: formattedUsers });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
