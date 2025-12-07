import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { RbacService } from '@/lib/rbac';
import { getTenant } from '@/lib/tenant';

const ADMIN_SESSION_COOKIE = 'wg_admin_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const CSRF_COOKIE = 'wg_csrf';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_MAX_AGE = 60 * 60 * 12; // 12 hours

export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Insufficient permissions') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class CsrfError extends Error {
  constructor(message = 'Invalid CSRF token') {
    super(message);
    this.name = 'CsrfError';
  }
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  tenantId: string;
  tenantSlug: string;
}

export interface TenantContext {
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  user: AdminUser;
  roles: string[];
  permissions: string[];
}

function randomToken(byteLength = 32) {
  return randomBytes(byteLength).toString('hex');
}

async function setSessionCookie(sessionId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

async function setCsrfCookie(token?: string): Promise<string> {
  const cookieStore = await cookies();
  const csrfToken = token ?? randomToken();
  cookieStore.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: CSRF_MAX_AGE,
    path: '/',
  });
  return csrfToken;
}

async function deleteCookie(name: string) {
  const cookieStore = await cookies();
  cookieStore.delete(name);
}

/**
 * Get the current admin session from cookies
 */
export async function getAdminSession(): Promise<{ sessionId: string; userId: string; tenantId: string } | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE);
  
  if (!sessionCookie) {
    return null;
  }

  const sessionId = sessionCookie.value;
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  if (!session) {
    return null;
  }

  return {
    sessionId: session.id,
    userId: session.userId,
    tenantId: session.tenantId,
  };
}

/**
 * Create a new admin session and issue CSRF token
 */
export async function createAdminSession(userId: string, tenantId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

  const session = await prisma.session.create({
    data: {
      userId,
      tenantId,
      expiresAt,
    },
  });

  await setSessionCookie(session.id);
  await setCsrfCookie();

  return session.id;
}

/**
 * Destroy the current admin session and clear cookies
 */
export async function destroyAdminSession(): Promise<void> {
  const session = await getAdminSession();

  if (session) {
    await prisma.session
      .delete({
        where: { id: session.sessionId },
      })
      .catch(() => {
        // Session might already be deleted
      });
  }

  await deleteCookie(ADMIN_SESSION_COOKIE);
  await deleteCookie(CSRF_COOKIE);
}

/**
 * Get the full tenant context including user, roles, and permissions
 */
export async function getTenantContext(): Promise<TenantContext | null> {
  const session = await getAdminSession();

  if (!session) {
    return null;
  }

  const tenantSlug = getTenant();
  if (!tenantSlug) {
    return null;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
  });

  if (!tenant || tenant.id !== session.tenantId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });

  if (!user || user.tenantId !== tenant.id) {
    return null;
  }

  const userRoles = await RbacService.getUserRoles(tenant.id, user.id);
  const permissions = await RbacService.getUserPermissions(tenant.id, user.id);

  return {
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      tenantSlug: tenant.slug,
    },
    roles: userRoles.map((assignment) => assignment.role.name),
    permissions,
  };
}

/**
 * Require authentication and return tenant context
 */
export async function requireAuth(): Promise<TenantContext> {
  const context = await getTenantContext();

  if (!context) {
    throw new UnauthorizedError();
  }

  return context;
}

/**
 * Require a specific role
 */
export async function requireTenantRole(roleName: string | string[]): Promise<TenantContext> {
  const context = await requireAuth();
  const requiredRoles = Array.isArray(roleName) ? roleName : [roleName];
  const hasRole = requiredRoles.some((role) => context.roles.includes(role));

  if (!hasRole) {
    throw new ForbiddenError(`Requires one of roles [${requiredRoles.join(', ')}]`);
  }

  return context;
}

/**
 * Require tenant admin role
 */
export async function requireTenantAdmin(): Promise<TenantContext> {
  return requireTenantRole('tenant_admin');
}

export async function isAuthenticated(): Promise<boolean> {
  const context = await getTenantContext();
  return context !== null;
}

export async function hasRole(roleName: string): Promise<boolean> {
  const context = await getTenantContext();
  return context ? context.roles.includes(roleName) : false;
}

/**
 * Assert CSRF token for mutating admin requests
 */
export async function assertCsrfToken(req: NextRequest): Promise<void> {
  const headerToken = req.headers.get(CSRF_HEADER);
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(CSRF_COOKIE)?.value;

  if (!headerToken || !cookieToken) {
    throw new CsrfError();
  }

  // Use constant-time comparison to prevent timing attacks
  try {
    const headerBuffer = Buffer.from(headerToken, 'utf-8');
    const cookieBuffer = Buffer.from(cookieToken, 'utf-8');
    
    if (headerBuffer.length !== cookieBuffer.length) {
      throw new CsrfError();
    }
    
    if (!timingSafeEqual(headerBuffer, cookieBuffer)) {
      throw new CsrfError();
    }
  } catch (error) {
    if (error instanceof CsrfError) {
      throw error;
    }
    // If buffer operations fail, reject the token
    throw new CsrfError();
  }
}

/**
 * Map auth-related errors to HTTP responses for route handlers
 */
export function handleAdminAuthError(req: NextRequest, error: unknown): NextResponse | null {
  const tenantSlug = getTenant();

  if (error instanceof UnauthorizedError) {
    const target = tenantSlug ? `/a/${tenantSlug}/admin-login` : '/';
    return NextResponse.redirect(new URL(target, req.url));
  }

  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (error instanceof CsrfError) {
    return NextResponse.json({ error: 'invalid_csrf' }, { status: 403 });
  }

  return null;
}
