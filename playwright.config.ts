import { defineConfig, devices } from '@playwright/test';

const SUPABASE_DATABASE_URL =
  process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || process.env.DIRECT_URL ||
  'postgresql://postgres:postgres@localhost:5432/waygate';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || '6379';
const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = process.env.SMTP_PORT || '1025';
const EMAIL_FROM = process.env.EMAIL_FROM || 'no-reply@example.test';

export default defineConfig({
  testDir: 'e2e/tests',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'test-results/playwright/results.xml' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm --filter provider dev',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'development',
        SUPABASE_DATABASE_URL,
        REDIS_HOST,
        REDIS_PORT,
        SMTP_HOST,
        SMTP_PORT,
        EMAIL_FROM,
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'dev_encryption_key_change_me_please_32_chars',
        SESSION_SECRET: process.env.SESSION_SECRET || 'dev_session_secret_change_me_please_32_chars',
      },
    },
    {
      command: 'pnpm --filter rp dev',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'development',
        WAYGATE_TENANT_SLUG: 'example',
        WAYGATE_CLIENT_ID: 'example-client',
        RP_REDIRECT_URI: 'http://localhost:3001/callback',
        WAYGATE_BASE_URL: 'http://localhost:3000',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: require.resolve('./e2e/global-setup'),
  globalTeardown: require.resolve('./e2e/global-teardown'),
});
