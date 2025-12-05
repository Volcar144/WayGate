import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/tenant-repo';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/services/audit';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Helper to generate JWK key pair
function generateKeyPair() {
  // This is a simplified example - in production, use proper RSA/EC key generation
  const kid = `kid_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  
  // Simplified JWK (should be actual RSA/EC public key)
  const pubJwk = {
    kty: 'oct',
    kid,
    use: 'sig',
    alg: 'HS256',
  };

  // Simplified encrypted private key representation
  const privJwkEncrypted = crypto.randomBytes(32).toString('hex');

  return { kid, pubJwk, privJwkEncrypted };
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();

    // Get current active key
    const activeKey = await prisma.jwkKey.findFirst({
      where: { tenantId: tenant.id, status: 'active' },
    });

    // Stage a new key
    const { kid, pubJwk, privJwkEncrypted } = generateKeyPair();

    const newKey = await prisma.jwkKey.create({
      data: {
        tenantId: tenant.id,
        kid,
        pubJwk,
        privJwkEncrypted,
        status: 'staged',
        notBefore: new Date(),
      },
    });

    // If there's an active key, retire it
    if (activeKey) {
      await prisma.jwkKey.update({
        where: { id: activeKey.id },
        data: {
          status: 'retired',
          notAfter: new Date(),
        },
      });
    }

    // Create audit event
    await AuditService.create({
      action: 'key.rotated',
      resource: 'key',
      resourceId: newKey.id,
      details: {
        newKid: kid,
        retiredKid: activeKey?.kid,
      },
      ip: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ key: newKey });
  } catch (error) {
    console.error('Error rotating keys:', error);
    return NextResponse.json({ error: 'Failed to rotate keys' }, { status: 500 });
  }
}
