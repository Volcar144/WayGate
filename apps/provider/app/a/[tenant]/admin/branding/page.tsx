'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface TenantSettings {
  displayName?: string;
  logoUrl?: string;
  brandColor?: string;
  contactEmail?: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
}

export default function BrandingPage() {
  const params = useParams<{ tenant: string }>();
  const [settings, setSettings] = useState<TenantSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const tenant = params.tenant;

  useEffect(() => {
    fetchSettings();
  }, [tenant]);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/a/${tenant}/admin/api/branding`);
      if (!response.ok) throw new Error('Failed to fetch settings');
      const data = await response.json();
      setSettings(data.settings || {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setSuccess(false);
      const response = await fetch(`/a/${tenant}/admin/api/branding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save settings');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
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
          <span>Branding & Screens</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">Branding & Screens</h1>
        <p className="text-gray-600 mt-2">Customize your tenant's appearance and messaging</p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
          Branding settings updated successfully
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading...</div>
      ) : (
        <div className="grid grid-cols-3 gap-8">
          {/* Form */}
          <div className="col-span-2">
            <form onSubmit={handleSave} className="space-y-6">
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Branding</h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={settings.displayName || ''}
                      onChange={(e) =>
                        setSettings({ ...settings, displayName: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder={`${tenant} Tenant`}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Logo URL
                    </label>
                    <input
                      type="url"
                      value={settings.logoUrl || ''}
                      onChange={(e) =>
                        setSettings({ ...settings, logoUrl: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="https://example.com/logo.png"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Brand Color
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={settings.brandColor || '#4f46e5'}
                        onChange={(e) =>
                          setSettings({ ...settings, brandColor: e.target.value })
                        }
                        className="w-12 h-10 rounded border border-gray-300"
                      />
                      <input
                        type="text"
                        value={settings.brandColor || '#4f46e5'}
                        onChange={(e) =>
                          setSettings({ ...settings, brandColor: e.target.value })
                        }
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                        placeholder="#4f46e5"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Contact & Legal</h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Contact Email
                    </label>
                    <input
                      type="email"
                      value={settings.contactEmail || ''}
                      onChange={(e) =>
                        setSettings({ ...settings, contactEmail: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="support@example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Privacy Policy URL
                    </label>
                    <input
                      type="url"
                      value={settings.privacyPolicyUrl || ''}
                      onChange={(e) =>
                        setSettings({ ...settings, privacyPolicyUrl: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="https://example.com/privacy"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Terms of Service URL
                    </label>
                    <input
                      type="url"
                      value={settings.termsOfServiceUrl || ''}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          termsOfServiceUrl: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="https://example.com/terms"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>

          {/* Preview */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 h-fit sticky top-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Preview</h2>

            <div className="space-y-6">
              <div>
                <div className="text-xs text-gray-500 mb-2 uppercase font-medium">Logo</div>
                {settings.logoUrl ? (
                  <img
                    src={settings.logoUrl}
                    alt="Logo"
                    className="h-16 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center text-gray-400">
                    No logo
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2 uppercase font-medium">
                  Brand Color
                </div>
                <div
                  className="w-full h-16 rounded-lg border-2"
                  style={{ backgroundColor: settings.brandColor || '#4f46e5' }}
                ></div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2 uppercase font-medium">
                  Display Name
                </div>
                <div className="text-xl font-bold text-gray-900">
                  {settings.displayName || 'Tenant Name'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
