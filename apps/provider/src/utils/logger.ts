type Level = 'info' | 'warn' | 'error' | 'debug';

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
