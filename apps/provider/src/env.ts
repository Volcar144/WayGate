import { z } from 'zod';

const serverEnvSchema = z.object({
  SUPABASE_DATABASE_URL: z.string().url({ message: 'SUPABASE_DATABASE_URL must be a valid URL' }),
  ISSUER_URL: z.string().url().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .optional(),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY should be at least 32 characters'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET should be at least 32 characters'),
  // Observability
  SENTRY_DSN: z.string().url().optional(),
  // Admin
  ADMIN_SECRET: z.string().optional(),
  // Rate limit defaults (per window)
  RL_TOKEN_IP_LIMIT: z.string().regex(/^\d+$/).transform(Number).optional(),
  RL_TOKEN_CLIENT_LIMIT: z.string().regex(/^\d+$/).transform(Number).optional(),
  RL_TOKEN_WINDOW_SEC: z.string().regex(/^\d+$/).transform(Number).optional(),
  RL_REGISTER_IP_LIMIT: z.string().regex(/^\d+$/).transform(Number).optional(),
  RL_REGISTER_WINDOW_SEC: z.string().regex(/^\d+$/).transform(Number).optional(),
  // JSON overrides structure: { tenants: { [slug]: { token?: { ip?: number, client?: number, windowSec?: number }, register?: { ip?: number, windowSec?: number }, clients?: { [clientId]: { client?: number, windowSec?: number } } } } }
  RL_OVERRIDES_JSON: z.string().optional(),
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Only warn during dev to avoid crashing dev for missing optional vars
  const formatted = parsed.error.format();
  if (process.env.NODE_ENV !== 'production') {
    console.warn('Invalid or missing environment variables for provider app:', formatted);
  } else {
    throw new Error('Invalid environment variables: ' + JSON.stringify(formatted));
  }
}

const envData = (parsed.success ? parsed.data : (process.env as any)) as z.infer<typeof serverEnvSchema>;

// Additional runtime validations
if (envData.ISSUER_URL) {
  try {
    const u = new URL(envData.ISSUER_URL);
    const path = u.pathname;
    if (!path.includes('/a/')) {
      throw new Error('ISSUER_URL must include the tenant path segment, e.g. https://id.example.com/a/{tenant}');
    }
    if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') {
      throw new Error('ISSUER_URL must use https in production');
    }
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('ISSUER_URL validation warning:', (e as Error).message);
    } else {
      throw e;
    }
  }
}

if (process.env.NODE_ENV === 'production') {
  // If any SMTP value is set, require minimal config
  const anySmtp = !!(envData.SMTP_HOST || envData.SMTP_PORT || envData.SMTP_USER || envData.SMTP_PASS || envData.EMAIL_FROM);
  if (anySmtp) {
    const missing: string[] = [];
    if (!envData.SMTP_HOST) missing.push('SMTP_HOST');
    if (!envData.SMTP_PORT) missing.push('SMTP_PORT');
    if (!envData.EMAIL_FROM) missing.push('EMAIL_FROM');
    if (missing.length > 0) {
      throw new Error('SMTP configuration incomplete: missing ' + missing.join(', '));
    }
  }
}

export const env = envData;
