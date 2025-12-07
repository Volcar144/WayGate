import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/utils/password';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantName, adminEmail, adminName, password } = body;

    if (!tenantName || !adminEmail || !password) {
      return NextResponse.json(
        { error: 'Tenant name, email, and password are required' },
        { status: 400 }
      );
    }

    // Generate slug from tenant name
    const slug = tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check if slug already exists
    const existingTenant = await prisma.tenant.findUnique({
      where: { slug },
    });

    if (existingTenant) {
      return NextResponse.json(
        { error: 'Tenant slug already exists' },
        { status: 409 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: tenantName,
        slug,
      },
    });

    // Create admin user (tenant-scoped)
    // Cast `data` as any here to avoid type mismatches if Prisma client
    // hasn't been regenerated yet to include the new `passwordHash` field.
    // Use unchecked create via `any` cast on prisma to avoid type mismatch
    // issues if the TypeScript server has stale Prisma types.
    const user = await (prisma as any).user.create({
      data: {
        tenantId: tenant.id,
        email: adminEmail,
        name: adminName || null,
        passwordHash: hashedPassword,
      },
    });

    // Assign tenant admin role
    const adminRole = await prisma.tenantRole.findFirst({
      where: { tenantId: tenant.id, name: 'tenant_admin' },
    });

    if (adminRole) {
      await prisma.userRole.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          roleId: adminRole.id,
        },
      });
    }

    // TODO: Set session cookie and return auth tokens
    return NextResponse.json(
      { tenantSlug: tenant.slug, userId: user.id },
      { status: 201 }
    );
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Signup failed' },
      { status: 500 }
    );
  }
}
