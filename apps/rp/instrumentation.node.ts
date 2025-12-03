import * as Sentry from '@sentry/nextjs';
import { env } from './src/env';

/**
 * Initializes Sentry for the application when a DSN is configured.
 *
 * If no SENTRY_DSN is provided, the function is a no-op. When initialized, Sentry
 * is configured with environment and tracing settings and a before-send hook
 * that redacts sensitive information (such as emails, tokens, secrets,
 * passwords, authorization headers, and cookies) from events before they are sent.
 */
export async function register() {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    autoSessionTracking: true,
    beforeSend(event) {
      try {
        const scrub = (input: any): any => {
          if (input == null) return input;
          if (typeof input === 'string') {
            let s = input;
            s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted-email>');
            s = s.replace(/(token|secret|password|authorization|cookie)=([^\s&]+)/gi, '$1=<redacted>');
            return s;
          }
          if (Array.isArray(input)) return input.map((v) => scrub(v));
          if (typeof input === 'object') {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(input)) {
              if (/token|secret|password|authorization|cookie/i.test(k)) out[k] = '<redacted>';
              else out[k] = scrub(v);
            }
            return out;
          }
          return input;
        };
        if (event.request) event.request = scrub(event.request);
        if (event.extra) event.extra = scrub(event.extra);
        if (event.contexts) event.contexts = scrub(event.contexts);
      } catch {}
      return event;
    },
  });
}