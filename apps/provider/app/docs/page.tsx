import Link from 'next/link';

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <nav className="flex items-center justify-between px-6 py-4 md:px-12 border-b border-gray-200 bg-white">
        <Link href="/" className="text-2xl font-bold text-indigo-600 hover:text-indigo-700">
          🔐 Waygate
        </Link>
        <div className="flex gap-4">
          <Link href="/auth/login" className="text-gray-600 hover:text-gray-900 font-medium">
            Sign In
          </Link>
          <Link href="/auth/signup" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium">
            Get Started
          </Link>
        </div>
      </nav>

      <main className="px-6 md:px-12 py-16 md:py-24">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-gray-900 mb-6">Documentation</h1>
          <p className="text-lg text-gray-600 mb-12">Comprehensive guides for implementing Waygate in your application.</p>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Getting Started</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="p-6 bg-white rounded-lg shadow-sm hover:shadow-md transition">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">👤 Create a Tenant</h3>
                <p className="text-gray-600 mb-4">
                  Start by creating your first tenant on Waygate. Each tenant is completely isolated and represents a separate identity domain.
                </p>
                <Link href="/auth/signup" className="text-indigo-600 hover:text-indigo-700 font-medium">
                  Create Tenant →
                </Link>
              </div>
              <div className="p-6 bg-white rounded-lg shadow-sm hover:shadow-md transition">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">🔑 Authentication Flows</h3>
                <p className="text-gray-600 mb-4">
                  Learn how to integrate Waygate's flexible authentication flows into your application using OpenID Connect.
                </p>
                <a href="#" className="text-indigo-600 hover:text-indigo-700 font-medium">
                  Read Guide →
                </a>
              </div>
              <div className="p-6 bg-white rounded-lg shadow-sm hover:shadow-md transition">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">🛡️ Security Best Practices</h3>
                <p className="text-gray-600 mb-4">
                  Understand how to securely implement tenant isolation, role-based access control, and audit logging.
                </p>
                <a href="#" className="text-indigo-600 hover:text-indigo-700 font-medium">
                  Security Guide →
                </a>
              </div>
              <div className="p-6 bg-white rounded-lg shadow-sm hover:shadow-md transition">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">⚙️ API Reference</h3>
                <p className="text-gray-600 mb-4">
                  Complete API documentation for all Waygate endpoints and management interfaces.
                </p>
                <a href="#" className="text-indigo-600 hover:text-indigo-700 font-medium">
                  API Docs →
                </a>
              </div>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Key Features</h2>
            <div className="space-y-4">
              <div className="p-4 bg-white rounded-lg border-l-4 border-indigo-600">
                <h4 className="font-semibold text-gray-900 mb-2">🏢 Multi-Tenant Architecture</h4>
                <p className="text-gray-600 text-sm">Complete tenant isolation with separate configuration, user databases, and audit logs for each tenant.</p>
              </div>
              <div className="p-4 bg-white rounded-lg border-l-4 border-indigo-600">
                <h4 className="font-semibold text-gray-900 mb-2">🔀 Flexible Auth Flows</h4>
                <p className="text-gray-600 text-sm">Drag-and-drop flow builder with support for geolocation checks, MFA, re-authentication, and custom conditions.</p>
              </div>
              <div className="p-4 bg-white rounded-lg border-l-4 border-indigo-600">
                <h4 className="font-semibold text-gray-900 mb-2">👥 RBAC & Permissions</h4>
                <p className="text-gray-600 text-sm">Fine-grained role-based access control with customizable permissions per tenant.</p>
              </div>
              <div className="p-4 bg-white rounded-lg border-l-4 border-indigo-600">
                <h4 className="font-semibold text-gray-900 mb-2">📊 Audit Logging</h4>
                <p className="text-gray-600 text-sm">Comprehensive audit trails for all user actions, sign-in events, and administrative changes.</p>
              </div>
              <div className="p-4 bg-white rounded-lg border-l-4 border-indigo-600">
                <h4 className="font-semibold text-gray-900 mb-2">🔐 Enterprise Security</h4>
                <p className="text-gray-600 text-sm">Support for OIDC, MFA, SSO integrations, and comprehensive security policies.</p>
              </div>
            </div>
          </section>

          <section className="mb-12 p-8 bg-white rounded-lg shadow-sm">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Quick Links</h2>
            <div className="grid md:grid-cols-3 gap-4">
              <a href="#" className="p-4 border border-gray-300 rounded-lg hover:border-indigo-600 hover:bg-indigo-50 transition">
                <div className="font-semibold text-gray-900 mb-1">GitHub Repository</div>
                <p className="text-sm text-gray-600">View source code and contribute</p>
              </a>
              <a href="#" className="p-4 border border-gray-300 rounded-lg hover:border-indigo-600 hover:bg-indigo-50 transition">
                <div className="font-semibold text-gray-900 mb-1">Community Forum</div>
                <p className="text-sm text-gray-600">Get help and discuss with others</p>
              </a>
              <a href="#" className="p-4 border border-gray-300 rounded-lg hover:border-indigo-600 hover:bg-indigo-50 transition">
                <div className="font-semibold text-gray-900 mb-1">Email Support</div>
                <p className="text-sm text-gray-600">support@waygate.dev</p>
              </a>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-gray-200 mt-20 py-12 px-6 md:px-12 bg-white">
        <div className="max-w-6xl mx-auto text-center text-gray-600">
          <p>&copy; 2025 Waygate. Enterprise Identity Platform.</p>
        </div>
      </footer>
    </div>
  );
}
