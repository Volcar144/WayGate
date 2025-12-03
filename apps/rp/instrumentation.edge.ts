import * as Sentry from '@sentry/nextjs';
import { env } from './src/env';

/**
 * Initializes Sentry when a SENTRY_DSN is configured and registers a before-send hook that redacts sensitive data from events.
 *
 * When a DSN is present, configures Sentry with the current NODE_ENV (or "development") and a low tracesSampleRate.
 * The beforeSend hook sanitizes event.request, event.extra, and event.contexts by redacting email addresses and values or keys related to `token`, `secret`, `password`, `authorization`, and `cookie` across strings, arrays, and objects.
 */
export async function register() {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.05,
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