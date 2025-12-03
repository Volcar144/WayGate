import * as Sentry from '@sentry/nextjs';
import { env } from './src/env';

/**
 * Initialize Sentry for the Edge runtime when a DSN is configured.
 *
 * Sets up a minimal Sentry configuration suitable for Edge environments and installs a
 * beforeSend hook that scrubs sensitive data from events. The scrubber redacts email-like
 * strings and values for keys that resemble credentials (for example: token, secret,
 * password, authorization, cookie) and applies sanitization to event.request, event.extra,
 * event.contexts, event.breadcrumbs, and exception values when present. If SENTRY_DSN is
 * not set, the function returns without initializing Sentry.
 */
export async function register() {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // Edge runtime does not support all options; keep minimal
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
              if (/token|secret|password|authorization|cookie/i.test(k)) {
                out[k] = '<redacted>';
              } else {
                out[k] = scrub(v);
              }
            }
            return out;
          }
          return input;
        };
        if (event.request) event.request = scrub(event.request);
        if (event.extra) event.extra = scrub(event.extra);
        if (event.contexts) event.contexts = scrub(event.contexts);
        if (event.breadcrumbs) event.breadcrumbs = scrub(event.breadcrumbs);
        if (event.exception?.values) {
          event.exception.values = event.exception.values.map((ex) => ({
            ...ex,
            value: typeof ex.value === 'string' ? scrub(ex.value) : ex.value,
          }));
        }
      } catch {}
      return event;
    },
  });
}