import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/services/audit';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();

    const clients = await prisma.client.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ clients });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const body = await req.json();
    const { name, redirectUris, grantTypes } = body;

    if (!name || !redirectUris || redirectUris.length === 0) {
      return NextResponse.json(
        { error: 'Name and redirect URIs are required' },
        { status: 400 }
      );
    }

    const clientId = `client_${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = crypto.randomBytes(32).toString('hex');

    const client = await prisma.client.create({
      data: {
        tenantId: tenant.id,
        clientId,
        clientSecret,
        name,
        redirectUris,
        grantTypes: grantTypes || ['authorization_code'],
      },
    });

    // Create audit event
    await AuditService.create({
      action: 'client.created',
      resource: 'client',
      resourceId: client.id,
      details: { clientId: client.clientId, name },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }, tenant.slug);

    return NextResponse.json({
      client: {
        ...client,
        clientSecret, // Only show on creation
      },
    });
  } catch (error) {
    console.error('Error creating client:', error);
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 });
  }
}
