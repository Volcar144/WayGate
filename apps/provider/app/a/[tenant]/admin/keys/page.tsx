'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface JwkKey {
  id: string;
  kid: string;
  status: 'staged' | 'active' | 'retired';
  notBefore: string;
  notAfter?: string;
  createdAt: string;
}

export default function KeysPage() {
  const params = useParams<{ tenant: string }>();
  const [keys, setKeys] = useState<JwkKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tenant = params.tenant;

  useEffect(() => {
    fetchKeys();
  }, [tenant]);

  const fetchKeys = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/a/${tenant}/admin/api/keys`);
      if (!response.ok) throw new Error('Failed to fetch keys');
      const data = await response.json();
      setKeys(data.keys || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch keys');
    } finally {
      setLoading(false);
    }
  };

  const handlePromoteKey = async (keyId: string) => {
    if (!confirm('Promote this key to active status? It will become the primary key.')) return;
    try {
      const response = await fetch(`/a/${tenant}/admin/api/keys/${keyId}/promote`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to promote key');
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote key');
    }
  };

  const handleRotateKeys = async () => {
    if (!confirm('Rotate keys? This will stage a new key and retire the current active key.')) return;
    try {
      const response = await fetch(`/a/${tenant}/admin/api/keys/rotate`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to rotate keys');
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate keys');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'staged':
        return 'bg-blue-100 text-blue-800';
      case 'retired':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const stagedKeys = keys.filter((k) => k.status === 'staged');
  const activeKeys = keys.filter((k) => k.status === 'active');
  const retiredKeys = keys.filter((k) => k.status === 'retired');

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <nav className="flex text-sm text-gray-600 gap-2 mb-4">
            <Link href={`/a/${tenant}/admin`}>Dashboard</Link>
            <span>/</span>
            <span>Keys</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">JSON Web Keys (JWK)</h1>
        </div>
        <button
          onClick={handleRotateKeys}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
        >
          Rotate Keys
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          {error}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
        <p className="text-sm text-blue-800">
          <strong>Key Rotation:</strong> Click "Rotate Keys" to stage a new key and retire the current active key.
          The staged key can then be promoted to active when ready.
        </p>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading...</div>
      ) : (
        <div className="space-y-8">
          {/* Active Keys */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Keys</h2>
            {activeKeys.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">
                No active keys
              </div>
            ) : (
              <div className="space-y-3">
                {activeKeys.map((key) => (
                  <div key={key.id} className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="font-mono text-sm font-semibold text-gray-900">
                            {key.kid}
                          </span>
                          <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${getStatusColor(key.status)}`}>
                            {key.status}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          <div>Created: {new Date(key.createdAt).toLocaleString()}</div>
                          <div>Valid from: {new Date(key.notBefore).toLocaleString()}</div>
                          {key.notAfter && (
                            <div>Valid until: {new Date(key.notAfter).toLocaleString()}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Staged Keys */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Staged Keys</h2>
            {stagedKeys.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">
                No staged keys
              </div>
            ) : (
              <div className="space-y-3">
                {stagedKeys.map((key) => (
                  <div key={key.id} className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="font-mono text-sm font-semibold text-gray-900">
                            {key.kid}
                          </span>
                          <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${getStatusColor(key.status)}`}>
                            {key.status}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          <div>Created: {new Date(key.createdAt).toLocaleString()}</div>
                          <div>Valid from: {new Date(key.notBefore).toLocaleString()}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => handlePromoteKey(key.id)}
                        className="px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm font-medium"
                      >
                        Promote to Active
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Retired Keys */}
          {retiredKeys.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Retired Keys</h2>
              <div className="space-y-3">
                {retiredKeys.map((key) => (
                  <div key={key.id} className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-mono text-sm font-semibold text-gray-900">
                        {key.kid}
                      </span>
                      <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${getStatusColor(key.status)}`}>
                        {key.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      <div>Created: {new Date(key.createdAt).toLocaleString()}</div>
                      <div>Valid from: {new Date(key.notBefore).toLocaleString()}</div>
                      {key.notAfter && (
                        <div>Valid until: {new Date(key.notAfter).toLocaleString()}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
