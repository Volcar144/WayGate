import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-6 py-4 md:px-12">
        <div className="text-2xl font-bold text-indigo-600">🔐 Waygate</div>
        <div className="flex gap-4">
          <Link
            href="/auth/login"
            className="px-4 py-2 text-indigo-600 hover:text-indigo-700 font-medium transition"
          >
            Sign In
          </Link>
          <Link
            href="/auth/signup"
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="px-6 md:px-12 py-20 md:py-32">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Enterprise Identity,
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              {' '}Simplified
            </span>
          </h1>
          <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto leading-relaxed">
            Waygate is a multi-tenant identity provider platform that simplifies authentication, authorization, and user management for modern applications.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link
              href="/auth/signup"
              className="px-8 py-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-semibold text-lg"
            >
              Create Your Tenant →
            </Link>
            <Link
              href="/docs"
              className="px-8 py-4 border-2 border-indigo-600 text-indigo-600 rounded-lg hover:bg-indigo-50 transition font-semibold text-lg"
            >
              View Documentation
            </Link>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-3 gap-8 mt-20">
            <div className="p-8 bg-white rounded-xl shadow-sm hover:shadow-md transition">
              <div className="text-4xl mb-4">🏗️</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Multi-Tenant</h3>
              <p className="text-gray-600">Complete tenant isolation with flexible routing and per-tenant configuration.</p>
            </div>
            <div className="p-8 bg-white rounded-xl shadow-sm hover:shadow-md transition">
              <div className="text-4xl mb-4">🔄</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Flexible Flows</h3>
              <p className="text-gray-600">Customizable authentication flows with geolocation checks, MFA, and re-authentication.</p>
            </div>
            <div className="p-8 bg-white rounded-xl shadow-sm hover:shadow-md transition">
              <div className="text-4xl mb-4">🔐</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Enterprise Security</h3>
              <p className="text-gray-600">Role-based access control, audit logging, and comprehensive security policies.</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-20 py-12 px-6 md:px-12">
        <div className="max-w-6xl mx-auto text-center text-gray-600">
          <p>&copy; 2025 Waygate. Enterprise Identity Platform.</p>
        </div>
      </footer>
    </div>
  );
}
