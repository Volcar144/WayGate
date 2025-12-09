import { NextRequest, NextResponse } from 'next/server';
import { prisma, rawPrisma } from '@/lib/prisma';
import { verifyPassword } from '@/utils/password';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Find user by email (across all tenants) and explicitly select passwordHash
    // Use unchecked/pragmatic fetch (cast to any) so TypeScript doesn't block
    // while Prisma client types are regenerating. This fetch includes tenant.
    const user: any = await (prisma as any).user.findFirst({
      where: { email },
      include: { tenant: true },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Create session and set cookie
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const session = await rawPrisma.session.create({
      data: {
        tenantId: user.tenant.id,
        userId: user.id,
        expiresAt
      }
    });

    const maxAge = 30 * 24 * 60 * 60; // seconds
    const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const cookie = `waygate_session=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;

    const res = NextResponse.json({ tenantSlug: user.tenant.slug, userId: user.id }, { status: 200 });
    res.headers.append('Set-Cookie', cookie);
    return res;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Login failed' }, { status: 500 });
  }
}
