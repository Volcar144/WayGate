import { NextRequest, NextResponse } from 'next/server';
import { env } from '../../../../src/env';
import { discover } from '../../../../src/waygate';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const refresh_token: string = body.refresh_token;
    if (!refresh_token) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

    const cfg = await discover();

    const form = new URLSearchParams();
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', refresh_token);

    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };

    if (env.WAYGATE_CLIENT_SECRET) {
      const basic = Buffer.from(`${env.WAYGATE_CLIENT_ID}:${env.WAYGATE_CLIENT_SECRET}`).toString('base64');
      headers['authorization'] = `Basic ${basic}`;
    } else {
      form.set('client_id', env.WAYGATE_CLIENT_ID);
    }

    const res = await fetch(cfg.token_endpoint, { method: 'POST', headers, body: form.toString() });
    const json = await res.json();
    if (!res.ok) return NextResponse.json(json, { status: res.status });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
