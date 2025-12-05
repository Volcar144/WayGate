'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Client {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  createdAt: string;
  updatedAt: string;
  firstParty: boolean;
}

export default function AppsPage() {
  const params = useParams<{ tenant: string }>();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    redirectUris: '',
    grantTypes: ['authorization_code'],
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const tenant = params.tenant;

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/a/${tenant}/admin/api/apps`);
      if (!response.ok) throw new Error('Failed to fetch clients');
      const data = await response.json();
      setClients(data.clients || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch clients');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreateLoading(true);
      const response = await fetch(`/a/${tenant}/admin/api/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          redirectUris: formData.redirectUris
            .split('\n')
            .map((u) => u.trim())
            .filter(Boolean),
          grantTypes: formData.grantTypes,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create client');
      }

      setFormData({ name: '', redirectUris: '', grantTypes: ['authorization_code'] });
      setShowCreateForm(false);
      await fetchClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleRotateSecret = async (clientId: string) => {
    if (!confirm('Rotate client secret? The old secret will no longer work.')) return;
    try {
      const response = await fetch(`/a/${tenant}/admin/api/apps/${clientId}/rotate-secret`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to rotate secret');
      const data = await response.json();
      alert(`New secret: ${data.clientSecret}\n\nMake sure to copy and save it now.`);
      await fetchClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate secret');
    }
  };

  const filteredClients = clients.filter(
    (client) =>
      client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.clientId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <nav className="flex text-sm text-gray-600 gap-2 mb-4">
            <Link href={`/a/${tenant}/admin`}>Dashboard</Link>
            <span>/</span>
            <span>Apps</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">OAuth Clients</h1>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
        >
          {showCreateForm ? 'Cancel' : 'Create Client'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          {error}
        </div>
      )}

      {showCreateForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New Client</h2>
          <form onSubmit={handleCreateClient} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client Name
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="My App"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Redirect URIs (one per line)
              </label>
              <textarea
                required
                value={formData.redirectUris}
                onChange={(e) => setFormData({ ...formData, redirectUris: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                placeholder="https://example.com/callback"
                rows={4}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Grant Types
              </label>
              <div className="space-y-2">
                {[
                  { value: 'authorization_code', label: 'Authorization Code' },
                  { value: 'refresh_token', label: 'Refresh Token' },
                ].map((grant) => (
                  <label key={grant.value} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.grantTypes.includes(grant.value)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            grantTypes: [...formData.grantTypes, grant.value],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            grantTypes: formData.grantTypes.filter((g) => g !== grant.value),
                          });
                        }
                      }}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">{grant.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={createLoading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
              >
                {createLoading ? 'Creating...' : 'Create Client'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <input
            type="text"
            placeholder="Search clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500">Loading...</div>
        ) : filteredClients.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No clients found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Client ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Redirect URIs
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Grant Types
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredClients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                      {client.name}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-600">
                      <div className="flex items-center gap-2">
                        {client.clientId}
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(client.clientId);
                            alert('Copied to clipboard');
                          }}
                          className="text-indigo-600 hover:text-indigo-800"
                        >
                          📋
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <div className="space-y-1">
                        {client.redirectUris.map((uri, idx) => (
                          <div key={idx} className="font-mono text-xs">
                            {uri}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {client.grantTypes.join(', ')}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button
                        onClick={() => handleRotateSecret(client.id)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        Rotate Secret
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
