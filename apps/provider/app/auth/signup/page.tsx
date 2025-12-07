'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SignUpPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    tenantName: '',
    adminEmail: '',
    adminName: '',
    password: '',
    confirmPassword: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validation
    if (!formData.tenantName.trim()) {
      setError('Tenant name is required');
      setLoading(false);
      return;
    }
    if (!formData.adminEmail.includes('@')) {
      setError('Valid email is required');
      setLoading(false);
      return;
    }
    if (formData.password.length < 8) {\n      setError('Password must be at least 8 characters');\n      setLoading(false);\n      return;\n    }\n    if (formData.password !== formData.confirmPassword) {\n      setError('Passwords do not match');\n      setLoading(false);\n      return;\n    }\n\n    try {\n      const response = await fetch('/api/auth/signup', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({\n          tenantName: formData.tenantName,\n          adminEmail: formData.adminEmail,\n          adminName: formData.adminName,\n          password: formData.password,\n        }),\n      });\n\n      if (!response.ok) {\n        const data = await response.json();\n        throw new Error(data.error || 'Signup failed');\n      }\n\n      // Redirect to tenant dashboard\n      const data = await response.json();\n      router.push(`/a/${data.tenantSlug}/admin`);\n    } catch (err) {\n      setError(err instanceof Error ? err.message : 'An error occurred');\n    } finally {\n      setLoading(false);\n    }\n  };\n\n  return (\n    <div className=\"min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center px-4\">\n      <div className=\"w-full max-w-md\">\n        {/* Header */}\n        <div className=\"text-center mb-8\">\n          <Link href=\"/\" className=\"text-2xl font-bold text-indigo-600 hover:text-indigo-700 inline-block\">\n            🔐 Waygate\n          </Link>\n          <h1 className=\"text-3xl font-bold text-gray-900 mt-6 mb-2\">Create Your Tenant</h1>\n          <p className=\"text-gray-600\">Start managing your identity infrastructure</p>\n        </div>\n\n        {/* Form Card */}\n        <div className=\"bg-white rounded-xl shadow-lg p-8\">\n          {error && (\n            <div className=\"mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm\">\n              {error}\n            </div>\n          )}\n\n          <form onSubmit={handleSubmit} className=\"space-y-5\">\n            {/* Tenant Name */}\n            <div>\n              <label className=\"block text-sm font-medium text-gray-700 mb-2\">Tenant Name</label>\n              <input\n                type=\"text\"\n                name=\"tenantName\"\n                value={formData.tenantName}\n                onChange={handleChange}\n                placeholder=\"e.g., ACME Corp\"\n                className=\"input-field\"\n                required\n              />\n              <p className=\"text-xs text-gray-500 mt-1\">This will be used to create your tenant slug</p>\n            </div>\n\n            {/* Admin Name */}\n            <div>\n              <label className=\"block text-sm font-medium text-gray-700 mb-2\">Full Name</label>\n              <input\n                type=\"text\"\n                name=\"adminName\"\n                value={formData.adminName}\n                onChange={handleChange}\n                placeholder=\"Your full name\"\n                className=\"input-field\"\n              />\n            </div>\n\n            {/* Admin Email */}\n            <div>\n              <label className=\"block text-sm font-medium text-gray-700 mb-2\">Email Address</label>\n              <input\n                type=\"email\"\n                name=\"adminEmail\"\n                value={formData.adminEmail}\n                onChange={handleChange}\n                placeholder=\"admin@example.com\"\n                className=\"input-field\"\n                required\n              />\n            </div>\n\n            {/* Password */}\n            <div>\n              <label className=\"block text-sm font-medium text-gray-700 mb-2\">Password</label>\n              <input\n                type=\"password\"\n                name=\"password\"\n                value={formData.password}\n                onChange={handleChange}\n                placeholder=\"At least 8 characters\"\n                className=\"input-field\"\n                required\n              />\n            </div>\n\n            {/* Confirm Password */}\n            <div>\n              <label className=\"block text-sm font-medium text-gray-700 mb-2\">Confirm Password</label>\n              <input\n                type=\"password\"\n                name=\"confirmPassword\"\n                value={formData.confirmPassword}\n                onChange={handleChange}\n                placeholder=\"Confirm your password\"\n                className=\"input-field\"\n                required\n              />\n            </div>\n\n            {/* Submit Button */}\n            <button\n              type=\"submit\"\n              disabled={loading}\n              className=\"w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed mt-6\"\n            >\n              {loading ? 'Creating Tenant...' : 'Create Tenant & Sign In'}\n            </button>\n          </form>\n\n          {/* Divider */}\n          <div className=\"my-6 flex items-center\">\n            <div className=\"flex-1 border-t border-gray-300\"></div>\n            <span className=\"px-3 text-gray-500 text-sm\">or</span>\n            <div className=\"flex-1 border-t border-gray-300\"></div>\n          </div>\n\n          {/* Sign In Link */}\n          <p className=\"text-center text-gray-600 text-sm\">\n            Already have a tenant?{' '}\n            <Link href=\"/auth/login\" className=\"text-indigo-600 hover:text-indigo-700 font-semibold\">\n              Sign In\n            </Link>\n          </p>\n        </div>\n\n        {/* Footer */}\n        <p className=\"text-center text-gray-500 text-xs mt-8\">\n          By creating a tenant, you agree to our Terms of Service and Privacy Policy\n        </p>\n      </div>\n    </div>\n  );\n}
