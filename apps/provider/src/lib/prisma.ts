import { PrismaClient } from '@prisma/client';
import { applyTenantIsolation } from './tenant-middleware';

// In development, use a global cached instance to prevent exhausting database connections
const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined };

export const prisma: PrismaClient =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
  });

// Apply tenant isolation middleware
applyTenantIsolation(prisma);

// Sentry DB breadcrumbs
try {
  // Lazy import to avoid bundling issues if Sentry not installed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Sentry = require('@sentry/nextjs');
  (prisma as any).$on('query', (e: any) => {
    try {
      const sanitize = (q: string) => q.replace(/'(?:[^'\\]|\\.)*'/g, "'<redacted>'");
      Sentry.addBreadcrumb({
        category: 'db.query',
        level: 'info',
        data: {
          query: sanitize(e.query || ''),
          duration_ms: e.duration,
          target: e.target,
        },
      });
    } catch {}
  });
} catch {}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
