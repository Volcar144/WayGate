import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/utils/password';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantName, adminEmail, adminName, password } = body;

    if (!tenantName || !adminEmail || !password) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create tenant slug from name
    const tenantSlug = tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);

    // Check if tenant already exists
    const existingTenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
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
        slug: tenantSlug,
      },
    });

    // Create admin user (tenant-scoped)
    const user = await prisma.user.create({\n      data: {\n        tenantId: tenant.id,\n        email: adminEmail,\n        name: adminName || null,\n        passwordHash: hashedPassword,\n      },\n    });\n\n    // Assign tenant admin role\n    const adminRole = await prisma.tenantRole.findFirst({\n      where: { tenantId: tenant.id, name: 'tenant_admin' },\n    });\n\n    if (adminRole) {\n      await prisma.userRole.create({\n        data: {\n          tenantId: tenant.id,\n          userId: user.id,\n          roleId: adminRole.id,\n        },\n      });\n    }\n\n    // TODO: Set session cookie and return auth tokens\n    return NextResponse.json(\n      { tenantSlug: tenant.slug, userId: user.id },\n      { status: 201 }\n    );\n  } catch (error) {\n    console.error('Signup error:', error);\n    return NextResponse.json(\n      { error: error instanceof Error ? error.message : 'Signup failed' },\n      { status: 500 }\n    );\n  }\n}
