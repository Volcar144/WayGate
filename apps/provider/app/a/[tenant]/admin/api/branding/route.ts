import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { tenantSettingsRepo } from '@/lib/tenant-repo';
import { AuditService } from '@/services/audit';
import { getAdminSession } from '@/lib/auth';
import { RbacService, PERMISSIONS } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check read permission
    const hasPermission = await RbacService.hasPermission(
      tenant.id,
      session.userId,
      PERMISSIONS.SETTINGS_READ
    );
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const settings = await tenantSettingsRepo.get(tenant.id);

    return NextResponse.json({
      settings: {
        displayName: settings?.displayName,
        logoUrl: settings?.logoUrl,
        brandColor: settings?.brandColor,
        contactEmail: settings?.contactEmail,
        privacyPolicyUrl: settings?.privacyPolicyUrl,
        termsOfServiceUrl: settings?.termsOfServiceUrl,
      },
    });
  } catch (error) {
    console.error('Error fetching branding settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check update permission
    const hasPermission = await RbacService.hasPermission(
      tenant.id,
      session.userId,
      PERMISSIONS.SETTINGS_UPDATE
    );
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const body = await req.json();

    const updated = await tenantSettingsRepo.upsert(tenant.id, {
      displayName: body.displayName,
      logoUrl: body.logoUrl,
      brandColor: body.brandColor,
      contactEmail: body.contactEmail,
      privacyPolicyUrl: body.privacyPolicyUrl,
      termsOfServiceUrl: body.termsOfServiceUrl,
    });

    // Create audit event
    await AuditService.create({
      action: 'branding.updated',
      resource: 'settings',
      resourceId: tenant.id,
      details: {
        displayName: body.displayName,
        brandColor: body.brandColor,
      },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    }, tenant.slug);

    return NextResponse.json({ settings: updated });
  } catch (error) {
    console.error('Error updating branding settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
