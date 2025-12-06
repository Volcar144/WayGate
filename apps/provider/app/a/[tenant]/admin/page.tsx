import React from 'react';
import Link from 'next/link';
import { getTenant } from '@/lib/tenant';
import { requireTenant } from '@/lib/tenant-repo';
import { RbacService, PERMISSIONS } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { getIssuerURL } from '@/utils/issuer';

async function getOverviewData(tenantId: string) {
  const [clientCount, activeUserCount, settings, fullTenant] = await Promise.all([
    prisma.client.count({ where: { tenantId } }),
    prisma.session.count({ where: { tenantId, expiresAt: { gt: new Date() } } }),
    prisma.tenantSettings.findUnique({ where: { tenantId } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { createdAt: true } }),
  ]);

  return {
    clientCount,
    activeUserCount,
    settings,
    createdAt: fullTenant?.createdAt,
  };
}

export default async function AdminOverview() {
  const tenantSlug = getTenant();
  if (!tenantSlug) {
    return <div>Tenant not found</div>;
  }

  const tenant = await requireTenant();
  const issuer = getIssuerURL();

  // TODO: Add RBAC check here - for now, we'll allow all authenticated users
  const data = await getOverviewData(tenant.id);

  return (
    <div>
      {/* Breadcrumbs */}
      <div className="mb-8">
        <nav className="flex text-sm text-gray-600 gap-2">
          <span>Dashboard</span>
          <span>/</span>
          <span>Overview</span>
        </nav>
      </div>

      {/* Status badges */}
      <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-600 mb-1">OAuth Clients</div>
          <div className="text-3xl font-bold text-gray-900">{data.clientCount}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-600 mb-1">Active Users</div>
          <div className="text-3xl font-bold text-gray-900">{data.activeUserCount}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-600 mb-1">Issuer URL</div>
          <div className="text-sm font-mono text-gray-900 truncate">{issuer}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-600 mb-1">Status</div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-green-500"></span>
            <span className="font-medium text-gray-900">Operational</span>
          </div>
        </div>
      </div>

      {/* Tenant configuration */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Tenant Information</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="text-sm text-gray-600 mb-1">Tenant Slug</div>
            <div className="font-mono text-gray-900">{tenant.slug}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Tenant ID</div>
            <div className="font-mono text-gray-900">{tenant.id}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Issuer URL</div>
            <div className="font-mono text-sm text-gray-900 break-all">{issuer}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Created</div>
            <div className="text-gray-900">{data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'N/A'}</div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/a/${tenantSlug}/admin/users`}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
          >
            Invite User
          </Link>
          <Link
            href={`/a/${tenantSlug}/admin/apps`}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
          >
            Create Client
          </Link>
          <Link
            href={`/a/${tenantSlug}/admin/keys`}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
          >
            Rotate Keys
          </Link>
          <Link
            href={`/a/${tenantSlug}/admin/branding`}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
          >
            Update Branding
          </Link>
        </div>
      </div>
    </div>
  );
}
