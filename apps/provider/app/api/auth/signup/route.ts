import { NextRequest, NextResponse } from 'next/server';
import { prisma, rawPrisma } from '@/lib/prisma';
import { DEFAULT_ROLES } from '@/lib/rbac';
import { hashPassword } from '@/utils/password';
import { ensureActiveKeyForTenant } from '@/services/jwks';
import crypto from 'node:crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantName, adminEmail, adminName, password } = body;

    if (!tenantName || !adminEmail || !password) {
      return NextResponse.json({ error: 'Tenant name, email, and password are required' }, { status: 400 });
    }

    const slug = tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const existingTenant = await prisma.tenant.findUnique({ where: { slug } });
    if (existingTenant) {
      return NextResponse.json({ error: 'Tenant slug already exists' }, { status: 409 });
    }

    const hashedPassword = await hashPassword(password);

    // Create tenant (use prisma so middleware isn't applied to Tenant model)
    const tenant = await prisma.tenant.create({ data: { name: tenantName, slug } });

    // Ensure default roles using rawPrisma to bypass tenant middleware
    await rawPrisma.tenantRole.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: DEFAULT_ROLES.TENANT_ADMIN.name } },
      update: { description: DEFAULT_ROLES.TENANT_ADMIN.description, permissions: DEFAULT_ROLES.TENANT_ADMIN.permissions },
      create: { tenantId: tenant.id, name: DEFAULT_ROLES.TENANT_ADMIN.name, description: DEFAULT_ROLES.TENANT_ADMIN.description, permissions: DEFAULT_ROLES.TENANT_ADMIN.permissions }
    });

    await rawPrisma.tenantRole.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: DEFAULT_ROLES.TENANT_VIEWER.name } },
      update: { description: DEFAULT_ROLES.TENANT_VIEWER.description, permissions: DEFAULT_ROLES.TENANT_VIEWER.permissions },
      create: { tenantId: tenant.id, name: DEFAULT_ROLES.TENANT_VIEWER.name, description: DEFAULT_ROLES.TENANT_VIEWER.description, permissions: DEFAULT_ROLES.TENANT_VIEWER.permissions }
    });

    // Create admin user and assign role
    const user = await rawPrisma.user.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        email: adminEmail.toLowerCase(),
        name: adminName || 'Administrator',
        passwordHash: hashedPassword
      }
    });

    const adminRole = await rawPrisma.tenantRole.findFirst({ where: { tenantId: tenant.id, name: DEFAULT_ROLES.TENANT_ADMIN.name } });
    if (adminRole) {
      await rawPrisma.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: adminRole.id } });
    }

    // Initialize tenant settings
    const defaultSettings = {
      tenantId: tenant.id,
      displayName: tenantName,
      theme: { mode: 'auto', primaryColor: '#007bff', secondaryColor: '#6c757d', backgroundColor: '#ffffff', textColor: '#212529' },
      rateLimitConfig: { token: { ip: 60, client: 120, windowSec: 60 }, register: { ip: 10, windowSec: 3600 } },
      ssoConfig: { autoCreateUsers: true, allowedIdpTypes: ['google', 'microsoft', 'github'] }
    };

    await rawPrisma.tenantSettings.upsert({ where: { tenantId: tenant.id }, update: defaultSettings, create: defaultSettings });

    // Ensure JWKS
    await ensureActiveKeyForTenant(tenant.id);

    // Create session and set cookie
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const session = await rawPrisma.session.create({ data: { tenantId: tenant.id, userId: user.id, expiresAt } });

    const maxAge = 30 * 24 * 60 * 60;
    const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const cookie = `waygate_session=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;

        const res = NextResponse.json({ tenantSlug: tenant.slug, userId: user.id }, { status: 201 });
        res.headers.append('Set-Cookie', cookie);
        return res;
      } catch (error) {
        console.error('Signup error:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Signup failed' }, { status: 500 });
      }
    }
