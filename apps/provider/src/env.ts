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
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .optional(),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY should be at least 32 characters').optional(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET should be at least 32 characters'),
});

const _env = serverEnvSchema.safeParse(process.env);

if (!_env.success) {
  // Only warn during dev to avoid crashing dev for missing optional vars
  const formatted = _env.error.format();
  if (process.env.NODE_ENV !== 'production') {
    console.warn('Invalid or missing environment variables for provider app:', formatted);
  } else {
    throw new Error('Invalid environment variables: ' + JSON.stringify(formatted));
  }
}

export const env = (_env.success ? _env.data : (process.env as any)) as z.infer<typeof serverEnvSchema>;
