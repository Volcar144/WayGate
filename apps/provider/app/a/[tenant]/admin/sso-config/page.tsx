'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Provider {
  type: string;
  status: 'enabled' | 'disabled';
  clientId?: string;
  issuer?: string;
  scopes: string[];
  hasSecret?: boolean;
  callbackUrl?: string;
}

export default function SSOConfigPage() {
  const params = useParams<{ tenant: string }>();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [adminSecret, setAdminSecret] = useState('');
  const [formData, setFormData] = useState<Record<string, any>>({});

  const tenant = params.tenant;

  const providerTitles: Record<string, string> = {
    google: 'Google',
    microsoft: 'Microsoft',
    github: 'GitHub',
    oidc_generic: 'OIDC (Generic)',
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/a/${tenant}/admin/sso/providers`, {
        headers: adminSecret ? { 'x-admin-secret': adminSecret } : {},
      });
      if (!response.ok) throw new Error('Failed to fetch providers');
      const data = await response.json();
      setProviders(data.providers || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch providers');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProvider = async (provider: Provider) => {
    try {
      if (!adminSecret) {
        setError('Admin secret is required');
        return;
      }

      const response = await fetch(`/a/${tenant}/admin/sso/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret,
        },
        body: JSON.stringify({
          type: provider.type,
          clientId: formData[`${provider.type}_clientId`],
          clientSecret: formData[`${provider.type}_clientSecret`],
          issuer: formData[`${provider.type}_issuer`],
          scopes: formData[`${provider.type}_scopes`]?.split(' ') || [],
        }),
      });

      if (!response.ok) throw new Error('Failed to save provider');
      await fetchProviders();
      setSelectedProvider(null);
      setFormData({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save provider');
    }
  };

  const handleToggleProvider = async (provider: Provider) => {
    try {
      if (!adminSecret) {
        setError('Admin secret is required');
        return;
      }

      const response = await fetch(`/a/${tenant}/admin/sso/providers`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret,
        },
        body: JSON.stringify({
          type: provider.type,
          status: provider.status === 'enabled' ? 'disabled' : 'enabled',
        }),
      });

      if (!response.ok) throw new Error('Failed to toggle provider');
      await fetchProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle provider');
    }
  };

  const getIssuerFromTenant = () => {
    if (typeof window === 'undefined') return '';
    const protocol = window.location.protocol;
    const host = window.location.host;
    return `${protocol}//${host}/a/${tenant}`;
  };

  return (
    <div>
      <div className="mb-8">
        <nav className="flex text-sm text-gray-600 gap-2 mb-4">
          <Link href={`/a/${tenant}/admin`}>Dashboard</Link>
          <span>/</span>
          <span>SSO</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">SSO Configuration</h1>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          {error}
        </div>
      )}

      {/* Admin Secret */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-8">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Admin Secret (required for configuration)
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={adminSecret}
            onChange={(e) => {
              setAdminSecret(e.target.value);
            }}
            placeholder="Enter your admin secret"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Callback URL Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
        <p className="text-sm text-blue-800">
          <strong>Callback URL:</strong>{' '}
          <code className="bg-blue-100 px-2 py-1 rounded">
            {getIssuerFromTenant()}/sso/callback
          </code>
        </p>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading...</div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {providers.map((provider) => (
            <div key={provider.type} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {providerTitles[provider.type] || provider.type}
                </h3>
                <button
                  onClick={() => handleToggleProvider(provider)}
                  className={`px-3 py-1 rounded text-sm font-medium ${
                    provider.status === 'enabled'
                      ? 'bg-green-100 text-green-800 hover:bg-green-200'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  {provider.status === 'enabled' ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div className="space-y-3 mb-4">
                {provider.callbackUrl && (
                  <div>
                    <div className="text-xs text-gray-500 uppercase font-medium mb-1">
                      Callback URL
                    </div>
                    <code className="text-xs font-mono bg-gray-50 p-2 rounded block">
                      {provider.callbackUrl}
                    </code>
                  </div>
                )}

                {selectedProvider === provider.type ? (
                  <div className="space-y-3 border-t pt-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Client ID
                      </label>
                      <input
                        type="text"
                        value={formData[`${provider.type}_clientId`] || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            [`${provider.type}_clientId`]: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Client Secret
                      </label>
                      <input
                        type="password"
                        value={formData[`${provider.type}_clientSecret`] || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            [`${provider.type}_clientSecret`]: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                        placeholder="Leave blank to keep current"
                      />
                    </div>

                    {(provider.type === 'microsoft' || provider.type === 'oidc_generic') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Issuer/Authority URL
                        </label>
                        <input
                          type="url"
                          value={formData[`${provider.type}_issuer`] || ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              [`${provider.type}_issuer`]: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Scopes
                      </label>
                      <input
                        type="text"
                        value={formData[`${provider.type}_scopes`] || 'openid email profile'}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            [`${provider.type}_scopes`]: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                      />
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => handleSaveProvider(provider)}
                        className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm font-medium"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setSelectedProvider(null);
                          setFormData({});
                        }}
                        className="flex-1 px-3 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setSelectedProvider(provider.type);
                      setFormData({
                        [`${provider.type}_clientId`]: provider.clientId || '',
                        [`${provider.type}_issuer`]: provider.issuer || '',
                        [`${provider.type}_scopes`]: provider.scopes?.join(' ') || 'openid email profile',
                      });
                    }}
                    className="w-full px-3 py-2 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 text-sm font-medium"
                  >
                    Configure
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
