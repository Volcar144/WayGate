import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/services/audit';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const tenant = await requireTenant();
    const { userId } = await params;

    // Verify user belongs to tenant
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: tenant.id },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get all active sessions for user
    const sessions = await prisma.session.findMany({
      where: { userId, tenantId: tenant.id },
      select: { id: true },
    });

    if (sessions.length > 0) {
      const sessionIds = sessions.map((s) => s.id);

      // Revoke refresh tokens and expire sessions
      await prisma.$transaction([
        prisma.refreshToken.updateMany({
          where: { sessionId: { in: sessionIds } },
          data: { revoked: true },
        }),
        prisma.session.updateMany({
          where: { id: { in: sessionIds } },
          data: { expiresAt: new Date() },
        }),
      ]);
    }

    // Create audit event
    await AuditService.create({
      userId: user.id,
      action: 'admin.revoke_user_sessions',
      resource: 'session',
      resourceId: userId,
      details: { revokedSessions: sessions.length },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }, tenant.slug);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error revoking sessions:', error);
    return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 });
  }
}
