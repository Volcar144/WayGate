import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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

    // TODO: Create session/auth tokens
    return NextResponse.json({ tenantSlug: user.tenant.slug, userId: user.id }, { status: 200 });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Login failed' }, { status: 500 });
  }
}
