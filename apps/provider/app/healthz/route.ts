import { NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * Responds to GET requests on the health check endpoint.
 *
 * @returns A JSON response with `{ ok: true, status: 'healthy' }` indicating the service is healthy.
 */
export async function GET() {
  return NextResponse.json({ ok: true, status: 'healthy' });
}