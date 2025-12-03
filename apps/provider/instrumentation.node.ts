import * as Sentry from '@sentry/nextjs';
import { env } from './src/env';

/**
 * Initializes Sentry only when SENTRY_DSN is provided, configuring environment, sampling, session tracking, and a scrubber for sensitive data.
 *
 * The registration is a no-op if env.SENTRY_DSN is not set. When initialized, Sentry is configured with a default environment of `process.env.NODE_ENV` or `'development'`, traces and profiles sampling rates, and automatic session tracking. A `beforeSend` hook redacts sensitive information (email addresses and values or keys that look like tokens, secrets, passwords, authorization, or cookies) from event.request, event.extra, event.contexts, event.breadcrumbs, and string values in event.exception.values.
 */
export async function register() {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.0,
    autoSessionTracking: true,
    beforeSend(event) {
      try {
        const scrub = (input: any): any => {
          if (input == null) return input;
          if (typeof input === 'string') {
            let s = input;
            // redact email addresses
            s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted-email>');
            // redact anything that looks like a token/secret
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