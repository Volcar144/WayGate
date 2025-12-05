import React from 'react';
import Link from 'next/link';

export default function FlowsPage() {
  return (
    <div>
      <div className="mb-8">
        <nav className="flex text-sm text-gray-600 gap-2 mb-4">
          <span>Dashboard</span>
          <span>/</span>
          <span>Flows</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">Auth Flows</h1>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
          <span className="text-2xl">🔄</span>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Coming Soon</h2>
        <p className="text-gray-600 mb-6 max-w-md">
          The Flows module will allow you to customize and configure advanced authentication flows,
          including conditional authentication, step-up authentication, and custom risk assessment rules.
        </p>
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            <strong>Features:</strong>
          </p>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Conditional authentication rules</li>
            <li>• Step-up authentication</li>
            <li>• Custom risk assessment</li>
            <li>• Flow templates</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
