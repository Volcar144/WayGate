import { getTenant } from '@/lib/tenant';
import { redirect } from 'next/navigation';
import AdminLoginClient from './page-client';

export default async function AdminLoginPage() {
  const tenantSlug = getTenant();
  
  if (!tenantSlug) {
    redirect('/');
  }

  return <AdminLoginClient tenantSlug={tenantSlug} />;
}
