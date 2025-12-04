import { prisma } from '@/lib/prisma';
import { requireTenant, tenantSettingsRepo } from '@/lib/tenant-repo';
import { logger } from '@/utils/logger';

export interface TenantBranding {
  displayName?: string;
  logoUrl?: string;
  brandColor?: string;
  theme?: {
    mode?: 'light' | 'dark' | 'auto';
    primaryColor?: string;
    secondaryColor?: string;
    backgroundColor?: string;
    textColor?: string;
  };
}

export interface TenantContact {
  contactEmail?: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
}

export interface TenantRateLimitConfig {
  token?: {
    ip?: number;
    client?: number;
    windowSec?: number;
  };
  register?: {
    ip?: number;
    windowSec?: number;
  };
  clients?: Record<string, {
    client?: number;
    windowSec?: number;
  }>;
}

export interface TenantSSOConfig {
  defaultRedirectUri?: string;
  allowedIdpTypes?: string[];
  enforceEmailDomain?: string;
  autoCreateUsers?: boolean;
}

export interface TenantSettingsData extends TenantBranding, TenantContact {
  rateLimitConfig?: TenantRateLimitConfig;
  ssoConfig?: TenantSSOConfig;
}

/**
 * Service for managing tenant settings and branding
 */
export class TenantSettingsService {
  /**
   * Get all settings for a tenant
   */
  static async getSettings(tenantSlug?: string): Promise<TenantSettingsData | null> {
    const tenant = tenantSlug ? 
      await prisma.tenant.findUnique({ where: { slug: tenantSlug } }) :
      await requireTenant();
    
    if (!tenant) return null;

    const settings = await tenantSettingsRepo.get(tenant.id);
    if (!settings) return null;

    return {
      displayName: settings.displayName || undefined,
      logoUrl: settings.logoUrl || undefined,
      brandColor: settings.brandColor || undefined,
      theme: settings.theme as any || undefined,
      contactEmail: settings.contactEmail || undefined,
      privacyPolicyUrl: settings.privacyPolicyUrl || undefined,
      termsOfServiceUrl: settings.termsOfServiceUrl || undefined,
      rateLimitConfig: settings.rateLimitConfig as any || undefined,
      ssoConfig: settings.ssoConfig as any || undefined,
    };
  }

  /**
   * Update tenant settings
   */
  static async updateSettings(data: TenantSettingsData, tenantSlug?: string): Promise<void> {
    const tenant = tenantSlug ? 
      await prisma.tenant.findUnique({ where: { slug: tenantSlug } }) :
      await requireTenant();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    await tenantSettingsRepo.upsert(tenant.id, data);

    logger.info('Tenant settings updated', {
      tenantId: tenant.id,
      tenantSlug: tenantSlug,
      updatedFields: Object.keys(data)
    });
  }

  /**
   * Get branding information for UI rendering
   */
  static async getBranding(tenantSlug?: string): Promise<TenantBranding> {
    const settings = await this.getSettings(tenantSlug);
    
    return {
      displayName: settings?.displayName,
      logoUrl: settings?.logoUrl,
      brandColor: settings?.brandColor,
      theme: settings?.theme,
    };
  }

  /**
   * Get contact information for UI rendering
   */
  static async getContact(tenantSlug?: string): Promise<TenantContact> {
    const settings = await this.getSettings(tenantSlug);
    
    return {
      contactEmail: settings?.contactEmail,
      privacyPolicyUrl: settings?.privacyPolicyUrl,
      termsOfServiceUrl: settings?.termsOfServiceUrl,
    };
  }

  /**
   * Get rate limit configuration for a tenant
   */
  static async getRateLimitConfig(tenantSlug?: string): Promise<TenantRateLimitConfig | null> {
    const settings = await this.getSettings(tenantSlug);
    return settings?.rateLimitConfig || null;
  }

  /**
   * Get SSO configuration for a tenant
   */
  static async getSSOConfig(tenantSlug?: string): Promise<TenantSSOConfig | null> {
    const settings = await this.getSettings(tenantSlug);
    return settings?.ssoConfig || null;
  }

  /**
   * Initialize default settings for a new tenant
   */
  static async initializeDefaults(tenantId: string, tenantName: string): Promise<void> {
    const defaultSettings: TenantSettingsData = {
      displayName: tenantName,
      theme: {
        mode: 'auto',
        primaryColor: '#007bff',
        secondaryColor: '#6c757d',
        backgroundColor: '#ffffff',
        textColor: '#212529',
      },
      rateLimitConfig: {
        token: {
          ip: 60,
          client: 120,
          windowSec: 60,
        },
        register: {
          ip: 10,
          windowSec: 3600,
        },
      },
      ssoConfig: {
        autoCreateUsers: true,
        allowedIdpTypes: ['google', 'microsoft', 'github'],
      },
    };

    await tenantSettingsRepo.upsert(tenantId, defaultSettings);

    logger.info('Default tenant settings initialized', {
      tenantId,
      tenantName,
    });
  }

  /**
   * Validate tenant settings data
   */
  static validateSettings(data: Partial<TenantSettingsData>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate brand color format
    if (data.brandColor && !/^#[0-9A-Fa-f]{6}$/.test(data.brandColor)) {
      errors.push('Brand color must be a valid hex color (e.g., #007bff)');
    }

    // Validate URLs
    const urlFields = ['logoUrl', 'privacyPolicyUrl', 'termsOfServiceUrl'];
    for (const field of urlFields) {
      const value = data[field as keyof TenantSettingsData] as string;
      if (value && !this.isValidUrl(value)) {
        errors.push(`${field} must be a valid URL`);
      }
    }

    // Validate email
    if (data.contactEmail && !this.isValidEmail(data.contactEmail)) {
      errors.push('Contact email must be a valid email address');
    }

    // Validate rate limit config
    if (data.rateLimitConfig) {
      if (data.rateLimitConfig.token?.ip && data.rateLimitConfig.token.ip <= 0) {
        errors.push('Token IP rate limit must be greater than 0');
      }
      if (data.rateLimitConfig.token?.client && data.rateLimitConfig.token.client <= 0) {
        errors.push('Token client rate limit must be greater than 0');
      }
      if (data.rateLimitConfig.register?.ip && data.rateLimitConfig.register.ip <= 0) {
        errors.push('Register IP rate limit must be greater than 0');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}