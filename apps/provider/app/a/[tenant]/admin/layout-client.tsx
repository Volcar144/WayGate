'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

export default function AdminLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ tenant: string }>();
  const pathname = usePathname();
  const tenant = params.tenant || '';
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navItems = [
    { label: 'Overview', href: `/a/${tenant}/admin`, icon: '📊' },
    { label: 'Users', href: `/a/${tenant}/admin/users`, icon: '👥' },
    { label: 'Apps', href: `/a/${tenant}/admin/apps`, icon: '🔧' },
    { label: 'Keys', href: `/a/${tenant}/admin/keys`, icon: '🔑' },
    { label: 'Branding & Screens', href: `/a/${tenant}/admin/branding`, icon: '🎨' },
    { label: 'SSO', href: `/a/${tenant}/admin/sso-config`, icon: '🔐' },
    { label: 'Logs', href: `/a/${tenant}/admin/logs`, icon: '📝' },
    { label: 'Settings', href: `/a/${tenant}/admin/settings`, icon: '⚙️' },
    { label: 'Flows', href: `/a/${tenant}/admin/flows`, icon: '🔄' },
    { label: 'SCIM', href: `/a/${tenant}/admin/scim`, icon: '🔗', disabled: true },
  ];

  const isActive = (href: string) => {
    if (href === `/a/${tenant}/admin`) {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-white border-r border-gray-200 transition-all duration-300 flex flex-col`}>
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold">
              {tenant[0]?.toUpperCase() || '?'}
            </div>
            {sidebarOpen && (
              <div>
                <div className="font-semibold text-sm text-gray-900">{tenant}</div>
                <div className="text-xs text-gray-500">Admin</div>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.disabled ? '#' : item.href}
                onClick={(e) => item.disabled && e.preventDefault()}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  item.disabled
                    ? 'text-gray-400 cursor-not-allowed opacity-50'
                    : active
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                title={item.disabled ? 'Coming soon' : ''}
              >
                <span className="text-lg">{item.icon}</span>
                {sidebarOpen && <span>{item.label}</span>}
                {sidebarOpen && item.disabled && (
                  <span className="ml-auto text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
                    Soon
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-full flex items-center justify-center p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            title={sidebarOpen ? 'Collapse' : 'Expand'}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Tenant Dashboard</h1>
          <div className="flex items-center gap-4">
            <button className="text-gray-500 hover:text-gray-700">Help</button>
            <button className="text-gray-500 hover:text-gray-700">Account</button>
          </div>
        </header>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-8 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
