import { getTenant } from '@/lib/tenant';
import Link from 'next/link';

export default function AccessDenied() {
  const tenantSlug = getTenant();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <span className="text-3xl">🚫</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
          <p className="text-gray-600 mb-6">
            You don't have permission to access this page. 
            You need the tenant_admin role to access the admin dashboard.
          </p>
          <div className="space-y-3">
            {tenantSlug && (
              <Link
                href={`/a/${tenantSlug}/admin-login`}
                className="block w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition"
              >
                Try different account
              </Link>
            )}
            <Link
              href="/"
              className="block w-full py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold rounded-lg transition"
            >
              Go to homepage
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
