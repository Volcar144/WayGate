'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Settings {
  rateLimitConfig?: any;
  status: {
    smtp: 'configured' | 'missing';
    redis: 'connected' | 'disconnected';
  };
}

export default function SettingsPage() {
  const params = useParams<{ tenant: string }>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateLimits, setRateLimits] = useState({
    perTenant: '100',
    perClient: '50',
    windowMs: '60000',
  });
  const [saving, setSaving] = useState(false);

  const tenant = params.tenant;

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/a/${tenant}/admin/api/settings`);
      if (!response.ok) throw new Error('Failed to fetch settings');
      const data = await response.json();
      setSettings(data.settings);
      if (data.settings.rateLimitConfig) {
        setRateLimits(data.settings.rateLimitConfig);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      const response = await fetch(`/a/${tenant}/admin/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rateLimitConfig: rateLimits }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save settings');
      }

      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <nav className="flex text-sm text-gray-600 gap-2 mb-4">
          <Link href={`/a/${tenant}/admin`}>Dashboard</Link>
          <span>/</span>
          <span>Settings</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading...</div>
      ) : (
        <div className="space-y-8">
          {/* System Status */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">System Status</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <div>
                  <div className="font-medium text-gray-900">SMTP Configuration</div>
                  <div className="text-sm text-gray-600">Email delivery service</div>
                </div>
                <div
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    settings?.status.smtp === 'configured'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}
                >
                  {settings?.status.smtp === 'configured' ? '✓ Configured' : '⚠ Not Configured'}
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <div>
                  <div className="font-medium text-gray-900">Redis Cache</div>
                  <div className="text-sm text-gray-600">Session and cache storage</div>
                </div>
                <div
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    settings?.status.redis === 'connected'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {settings?.status.redis === 'connected' ? '✓ Connected' : '✗ Disconnected'}
                </div>
              </div>
            </div>
          </div>

          {/* Rate Limiting */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Rate Limiting</h2>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Requests per Tenant (per window)
                </label>
                <input
                  type="number"
                  value={rateLimits.perTenant}
                  onChange={(e) =>
                    setRateLimits({ ...rateLimits, perTenant: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Requests per Client (per window)
                </label>
                <input
                  type="number"
                  value={rateLimits.perClient}
                  onChange={(e) =>
                    setRateLimits({ ...rateLimits, perClient: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Time Window (milliseconds)
                </label>
                <input
                  type="number"
                  value={rateLimits.windowMs}
                  onChange={(e) =>
                    setRateLimits({ ...rateLimits, windowMs: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </form>
          </div>

          {/* Environment Info */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Environment</h2>
            <div className="text-sm text-gray-600">
              <p className="mb-2">
                <strong>Tenant Slug:</strong> <code className="bg-gray-100 px-2 py-1 rounded">{tenant}</code>
              </p>
              <p>
                <strong>Configuration:</strong> Check your environment variables for detailed system configuration.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
