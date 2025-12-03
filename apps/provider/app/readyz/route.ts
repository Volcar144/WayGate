import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRedis } from '@/lib/redis';

export const runtime = 'nodejs';

/**
 * Performs readiness checks for the database and Redis and returns a JSON status.
 *
 * @returns A NextResponse whose JSON body indicates readiness:
 * - `{ ok: false, db: false }` with HTTP 503 if the database check fails.
 * - `{ ok: false, db: true, redis: false }` with HTTP 503 if the Redis check fails.
 * - `{ ok: true, db: true, redis: true }` when both checks succeed.
 */
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