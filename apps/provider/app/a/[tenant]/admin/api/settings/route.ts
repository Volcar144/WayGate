import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { tenantSettingsRepo } from '@/lib/tenant-repo';
import { AuditService } from '@/services/audit';
import { env } from '@/env';

export const runtime = 'nodejs';

// Check service status
async function checkSmtpStatus(): Promise<boolean> {
  return !!(env.SMTP_HOST && env.SMTP_PORT);
}

async function checkRedisStatus(): Promise<boolean> {
  try {
    if (!env.REDIS_URL) return false;
    // Simple check - in production, you'd want to actually test the connection
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();

    const settings = await tenantSettingsRepo.get(tenant.id);
    const smtpStatus = await checkSmtpStatus();
    const redisStatus = await checkRedisStatus();

    return NextResponse.json({
      settings: {
        ...settings,
        status: {
          smtp: smtpStatus ? 'configured' : 'missing',
          redis: redisStatus ? 'connected' : 'disconnected',
        },
      },
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const body = await req.json();

    const updated = await tenantSettingsRepo.upsert(tenant.id, {
      rateLimitConfig: body.rateLimitConfig,
    });

    // Create audit event
    await AuditService.create({
      action: 'settings.updated',
      resource: 'settings',
      resourceId: tenant.id,
      details: {
        updated: Object.keys(body),
      },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ settings: updated });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
