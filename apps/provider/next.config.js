/**** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Configure path aliases for production builds
  webpack: (config) => {
    // Resolve path aliases defined in tsconfig.json
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, 'src'),
      '@/lib': path.resolve(__dirname, 'src/lib'),
      '@/services': path.resolve(__dirname, 'src/services'),
      '@/utils': path.resolve(__dirname, 'src/utils'),
      '@/env': path.resolve(__dirname, 'src/env.ts'),
    };
    return config;
  },
};

module.exports = nextConfig;
