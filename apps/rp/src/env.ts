import { z } from 'zod';

const schema = z.object({
  WAYGATE_TENANT_SLUG: z.string().min(1, 'WAYGATE_TENANT_SLUG is required'),
  WAYGATE_CLIENT_ID: z.string().min(1, 'WAYGATE_CLIENT_ID is required'),
  WAYGATE_CLIENT_SECRET: z.string().optional().nullable(),
  RP_REDIRECT_URI: z.string().url('RP_REDIRECT_URI must be a URL'),
  // Optional base URL for the provider. Defaults to http://localhost:3000 for local dev.
  WAYGATE_BASE_URL: z.string().url().optional(),
  // Observability
  SENTRY_DSN: z.string().url().optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse({
  WAYGATE_TENANT_SLUG: process.env.WAYGATE_TENANT_SLUG,
  WAYGATE_CLIENT_ID: process.env.WAYGATE_CLIENT_ID,
  WAYGATE_CLIENT_SECRET: process.env.WAYGATE_CLIENT_SECRET,
  RP_REDIRECT_URI: process.env.RP_REDIRECT_URI,
  WAYGATE_BASE_URL: process.env.WAYGATE_BASE_URL,
  SENTRY_DSN: process.env.SENTRY_DSN,
});
