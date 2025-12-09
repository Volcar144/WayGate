import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/utils/password';
import { TenantInitializationService } from '@/services/tenant-init';
import { RbacService } from '@/lib/rbac';
import type { Prisma } from '@prisma/client';

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

    // Create tenant and initialize in a transaction for atomicity
    const { tenant, user } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create tenant
      const newTenant = await tx.tenant.create({
        data: {
          name: tenantName,
          slug,
        },
      });

      // Create admin user (tenant-scoped)
      const newUser = await (tx as any).user.create({
        data: {
          tenantId: newTenant.id,
          email: adminEmail,
          name: adminName || null,
          passwordHash: hashedPassword,
        },
      });

      // Assign tenant admin role via RbacService (which will lazy-create the role if needed)
      await RbacService.assignRole(newTenant.id, newUser.id, 'tenant_admin', newUser.id, tx);

      return { tenant: newTenant, user: newUser };
    });

    // Initialize tenant resources (default settings, JWK keys, etc.)
    // This runs outside the transaction to avoid timeout and to allow proper retry logic
    try {
      await TenantInitializationService.initializeTenant(tenant.id, tenant.slug, tenant.name);
    } catch (initError) {
      console.error('Tenant initialization failed (non-blocking):', initError);
      // Non-blocking: tenant and user are created successfully; initialization can be retried
    }

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
