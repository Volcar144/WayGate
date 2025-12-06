import React from 'react';
import Link from 'next/link';

export default function ScimPage() {
  return (
    <div>
      <div className="mb-8">
        <nav className="flex text-sm text-gray-600 gap-2 mb-4">
          <span>Dashboard</span>
          <span>/</span>
          <span>SCIM</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">SCIM Configuration</h1>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
          <span className="text-2xl">🔗</span>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Coming Soon</h2>
        <p className="text-gray-600 mb-6 max-w-md">
          The SCIM module will enable System for Cross-domain Identity Management, allowing seamless
          user provisioning and deprovisioning from enterprise identity providers.
        </p>
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            <strong>Features:</strong>
          </p>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• SCIM 2.0 protocol support</li>
            <li>• User provisioning</li>
            <li>• Group management</li>
            <li>• Enterprise directory integration</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
