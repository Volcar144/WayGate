import { NextRequest } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { getPending, subscribeSSE, unsubscribeSSE } from '@/services/authz';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const tenantSlug = getTenant();
  const rid = req.nextUrl.searchParams.get('rid') || '';
  const pending = getPending(rid);
  if (!tenantSlug || !pending || pending.tenantSlug !== tenantSlug) {
    return new Response('invalid or expired', { status: 400 });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const encoder = new TextEncoder();
  const write = (s: string) => writer.write(encoder.encode(s));

  await write(': ok\n\n');
  subscribeSSE(rid, writer);

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
  const onAbort = () => {
    clearInterval(ping);
    unsubscribeSSE(rid, writer);
    try { writer.close(); } catch {}
  };
  // @ts-ignore
  req.signal?.addEventListener?.('abort', onAbort);

  return new Response(readable, { headers });
}
