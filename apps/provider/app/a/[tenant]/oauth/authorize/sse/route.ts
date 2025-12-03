import { NextRequest } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { getPending, subscribeSSE, unsubscribeSSE } from '@/services/authz';
import { newRedisSubscriber } from '@/lib/redis';

export const runtime = 'nodejs';

/**
 * Streams authorization-related Server-Sent Events (SSE) to the client for a validated pending request.
 *
 * @returns A Response that streams SSE frames containing authorization events. If the tenant is missing or the pending request is invalid or expired, returns a 400 Response with the body "invalid or expired".
 */
export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  const rid = req.nextUrl.searchParams.get('rid') || '';
  const pending = await getPending(rid);
  if (!tenantSlug || !pending || pending.tenantSlug !== tenantSlug) {
    return new Response('invalid or expired', { status: 400 });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const encoder = new TextEncoder();
  const write = (s: string) => writer.write(encoder.encode(s));

  await write(': ok\n\n');

  // Try Redis pub/sub first
  const sub = await newRedisSubscriber();
  let usingRedis = false;
  let channel = '';
  if (sub) {
    channel = `authz:sse:${rid}`;
    usingRedis = true;
    await sub.subscribe(channel);
    sub.on('message', (_chan: string, message: string) => {
      try {
        const { event, data } = JSON.parse(message);
        const line = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
        void writer.write(encoder.encode(line));
      } catch (e) {
        try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {}
        console.error('Failed to handle SSE message', e);
      }
    });
  } else {
    subscribeSSE(rid, writer);
  }

  // keepalive pings
  const ping = setInterval(() => {
    write(': ping\n\n');
  }, 15000);

  const headers = new Headers({
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  // Cleanup on client abort
  const onAbort = async () => {
    clearInterval(ping);
    if (usingRedis && sub) {
      try {
        await sub.unsubscribe(channel);
      } catch (e) {
        try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {}
        console.error('Failed to unsubscribe Redis channel', e);
      }
      try {
        await (sub as any).quit?.();
      } catch (e) {
        try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {}
        console.error('Failed to quit Redis subscriber', e);
      }
    } else {
      unsubscribeSSE(rid, writer);
    }
    try { await writer.close(); } catch (e) { try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {} ; console.error('Failed to close SSE writer', e); }
  };
  // @ts-ignore
  req.signal?.addEventListener?.('abort', onAbort);

  return new Response(readable, { headers });
}