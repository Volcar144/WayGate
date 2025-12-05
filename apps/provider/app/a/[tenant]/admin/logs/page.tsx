'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
  user?: { email: string; name?: string };
}

export default function LogsPage() {
  const params = useParams<{ tenant: string }>();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState('');
  const [exporting, setExporting] = useState(false);

  const tenant = params.tenant;

  useEffect(() => {
    fetchLogs();
  }, [filterAction]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      let url = `/a/${tenant}/admin/api/logs`;
      if (filterAction) {
        url += `?action=${encodeURIComponent(filterAction)}`;
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch logs');
      const data = await response.json();
      setLogs(data.logs || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      const response = await fetch(`/a/${tenant}/admin/audit/export?format=csv`);
      if (!response.ok) throw new Error('Failed to export logs');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export logs');
    } finally {
      setExporting(false);
    }
  };

  const getActionColor = (action: string) => {
    if (action.includes('security') || action.includes('error'))
      return 'bg-red-100 text-red-800';
    if (action.includes('delete')) return 'bg-orange-100 text-orange-800';
    if (action.includes('create')) return 'bg-green-100 text-green-800';
    if (action.includes('update')) return 'bg-blue-100 text-blue-800';
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <nav className="flex text-sm text-gray-600 gap-2 mb-4">
            <Link href={`/a/${tenant}/admin`}>Dashboard</Link>
            <span>/</span>
            <span>Logs</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
        >
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <input
            type="text"
            placeholder="Filter by action..."
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No audit logs found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Action
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    IP Address
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Timestamp
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${getActionColor(log.action)}`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {log.user ? (
                        <div>
                          <div className="font-medium">{log.user.email}</div>
                          {log.user.name && (
                            <div className="text-xs text-gray-500">{log.user.name}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">System</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 font-mono text-xs">
                      {log.ip || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(log.createdAt).toLocaleString()}
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
