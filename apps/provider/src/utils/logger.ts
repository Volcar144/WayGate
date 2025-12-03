type Level = 'info' | 'warn' | 'error' | 'debug';

/**
 * Recursively redacts sensitive information from the given value.
 *
 * Strings: email-like substrings are replaced with `<redacted-email>` and key=value tokens
 * for `token`, `secret`, `password`, `authorization`, and `cookie` (case-insensitive) have their
 * values replaced with `<redacted>`.
 *
 * Objects: properties whose keys match `token`, `secret`, `password`, `authorization`, or `cookie`
 * (case-insensitive) are replaced with `<redacted>`; other property values are processed recursively.
 *
 * Arrays: each element is processed recursively.
 *
 * Null and undefined are returned unchanged. Non-string primitive values are returned unchanged.
 *
 * @param input - The value to sanitize (string, object, array, or other)
 * @returns The sanitized value with sensitive data redacted
 */
function redact(input: any): any {
  if (input == null) return input;
  if (typeof input === 'string') {
    let s = input;
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted-email>');
    s = s.replace(/(token|secret|password|authorization|cookie)=([^\s&]+)/gi, '$1=<redacted>');
    return s;
  }
  if (Array.isArray(input)) return input.map((v) => redact(v));
  if (typeof input === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      if (/token|secret|password|authorization|cookie/i.test(k)) out[k] = '<redacted>';
      else out[k] = redact(v);
    }
    return out;
  }
  return input;
}

/**
 * Emit a structured, redacted log entry for the given level, message, and optional metadata.
 *
 * The payload includes `level`, a redacted `msg`, redacted metadata merged into the payload, and a timestamp.
 * If structured JSON output fails, a simple fallback console output is used.
 *
 * @param level - Log severity: 'info', 'warn', 'error', or 'debug'
 * @param msg - Message to be logged; sensitive data within the message will be redacted
 * @param meta - Optional metadata object; sensitive fields within will be redacted and included in the payload
 */
function log(level: Level, msg: string, meta?: Record<string, any>) {
  const payload = { level, msg: redact(msg), ...redact(meta || {}), ts: new Date().toISOString() };
  try {
    // Use JSON for structured logging
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify(payload));
  } catch {
    // eslint-disable-next-line no-console
    console.log(`[${level}]`, msg, meta);
  }
}

export const logger = {
  info: (msg: string, meta?: Record<string, any>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, any>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, any>) => log('error', msg, meta),
  debug: (msg: string, meta?: Record<string, any>) => log('debug', msg, meta),
  redact,
};