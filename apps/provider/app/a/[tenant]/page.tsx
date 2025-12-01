import { getTenant } from '@/lib/tenant';

export default function TenantHome() {
  const tenant = getTenant();
  return (
    <main style={{ padding: 24 }}>
      <h1>Tenant: {tenant ?? 'unknown'}</h1>
      <p>This page is tenant-aware via middleware-provided context.</p>
    </main>
  );
}
