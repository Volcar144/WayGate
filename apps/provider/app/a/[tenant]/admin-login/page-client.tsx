"use client";

import { useState } from 'react';

interface AdminLoginClientProps {
  tenantSlug: string;
}

export default function AdminLoginClient({ tenantSlug }: AdminLoginClientProps) {
  const [email, setEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      const response = await fetch(`/a/${tenantSlug}/admin-login/api/magic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send magic link');
      }

      const data = await response.json();
      
      // In development, show debug link
      if (data.debug_link && process.env.NODE_ENV === 'development') {
        console.log('Magic link (dev):', data.debug_link);
        window.location.href = data.debug_link;
        return;
      }

      setMagicLinkSent(true);
    } catch (error) {
      console.error('Failed to send magic link', error);
      setError(error instanceof Error ? error.message : 'Failed to send magic link');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-100 text-indigo-600 text-xl font-semibold mb-4">
            {tenantSlug[0]?.toUpperCase() || 'T'}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Tenant Admin Login</h1>
          <p className="text-gray-500 mt-2">Sign in to manage your tenant</p>
        </div>

        {magicLinkSent ? (
          <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-green-800 text-sm">
            Magic link sent! Check your email to continue.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Work email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />
            </div>

            {error && (
              <div className="text-sm text-red-600">{error}</div>
            )}

            <button
              type="submit"
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition"
            >
              Send magic link
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-sm text-gray-500">
          Need help? Contact your administrator
        </div>
      </div>
    </div>
  );
}
