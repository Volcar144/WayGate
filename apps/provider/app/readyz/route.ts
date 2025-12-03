import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRedis } from '@/lib/redis';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await (prisma as any).$queryRaw`SELECT 1`;
  } catch (e) {
    return NextResponse.json({ ok: false, db: false }, { status: 503 });
  }
  try {
    const r = await getRedis();
    if (r) {
      const pong = await r.ping?.();
      if (pong && String(pong).toLowerCase() !== 'pong') throw new Error('redis not ready');
    }
  } catch {
    return NextResponse.json({ ok: false, db: true, redis: false }, { status: 503 });
  }
  return NextResponse.json({ ok: true, db: true, redis: true });
}
