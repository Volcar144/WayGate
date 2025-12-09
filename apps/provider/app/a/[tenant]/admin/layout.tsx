import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AdminLayoutClient from './layout-client';
import { requireTenantAdmin, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { getTenant } from '@/lib/tenant';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    // Require tenant admin role - throws on auth failure
    const context = await requireTenantAdmin();
    return <AdminLayoutClient context={context}>{children}</AdminLayoutClient>;
  } catch (error) {
    const tenantSlug = getTenant();
    
    if (error instanceof UnauthorizedError) {
      redirect(tenantSlug ? `/a/${tenantSlug}/admin-login` : '/');
    }
    
    if (error instanceof ForbiddenError) {
      redirect(tenantSlug ? `/a/${tenantSlug}/admin/access-denied` : '/');
    }
    
    throw error;
  }
}
