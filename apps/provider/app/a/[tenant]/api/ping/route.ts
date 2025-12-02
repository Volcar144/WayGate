import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';

export async function GET() {
  const tenant = getTenant();
  return NextResponse.json({ ok: true, tenant });
}
