# Tenant Isolation Hardening Implementation

This document describes the comprehensive tenant isolation hardening implementation for the Waygate multi-tenant OAuth/OIDC provider.

## Overview

The implementation guarantees B2B/B2C-grade multi-tenancy where each tenant is a fully isolated unit with its own configuration, branding, keys, logs, SSO connections/credentials, and users.

## Components Implemented

### 1. Schema Enhancements

#### New Models Added:
- **TenantSettings**: Stores per-tenant branding, configuration, rate limits, and SSO settings
- **TenantRole**: Defines roles within a tenant (tenant_admin, tenant_viewer, custom roles)
- **UserRole**: Assigns roles to users within tenants

#### Enhanced Existing Models:
- **User**: Added `userRoles` relation for RBAC
- **Tenant**: Added `settings`, `roles`, `userRoles` relations

### 2. Data Isolation

#### Prisma Middleware (`src/lib/tenant-middleware.ts`)
- **Automatic Tenant Filtering**: All queries automatically include `tenantId` filter
- **Cross-Tenant Prevention**: Blocks queries attempting wrong tenant access
- **Comprehensive Coverage**: Applies to all tenant-scoped models
- **Audit Logging**: Logs all cross-tenant access attempts

#### Repository Helpers (`src/lib/tenant-repo.ts`)
- **Tenant-Scoped Repositories**: `tenantUserRepo`, `tenantClientRepo`, `tenantSettingsRepo`, `tenantAuditRepo`
- **Ownership Verification**: `verifyTenantOwnership()` function for resource validation
- **Automatic Context**: All helpers require tenant context
- **Error Handling**: Descriptive errors for isolation violations

### 3. RBAC System (`src/lib/rbac.ts`)

#### Permission System
```typescript
export const PERMISSIONS = {
  // User management
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  
  // Client management
  CLIENT_READ: 'client:read',
  CLIENT_CREATE: 'client:create',
  CLIENT_UPDATE: 'client:update',
  CLIENT_DELETE: 'client:delete',
  
  // Key management
  KEY_READ: 'key:read',
  KEY_CREATE: 'key:create',
  KEY_ROTATE: 'key:rotate',
  KEY_DELETE: 'key:delete',
  
  // Identity provider management
  IDP_READ: 'idp:read',
  IDP_CREATE: 'idp:create',
  IDP_UPDATE: 'idp:update',
  IDP_DELETE: 'idp:delete',
  
  // Audit and monitoring
  AUDIT_READ: 'audit:read',
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',
  
  // Tenant administration
  TENANT_ADMIN: 'tenant:admin',
  TENANT_VIEWER: 'tenant:viewer'
} as const;
```

#### Default Roles
- **tenant_admin**: Full administrative access
- **tenant_viewer**: Read-only access

#### RBAC Features
- **Role Assignment**: `assignRole()`, `removeRole()`
- **Permission Checking**: `hasPermission()`, `hasAnyPermission()`
- **Custom Roles**: Support for tenant-specific custom roles
- **Middleware Helpers**: `requirePermission()`, `requireAnyPermission()`

### 4. Redis Namespacing (`src/lib/redis.ts`)

#### Tenant Isolation
- **Namespace Prefix**: All keys prefixed with `wg:{tenant}:`
- **Automatic Detection**: Resolves tenant from request context
- **Production Enforcement**: Requires tenant context in production
- **Backward Compatibility**: Graceful fallback for development

#### Enhanced Redis Client
```typescript
export class TenantRedis {
  // Automatic tenant namespacing
  async set(key: string, value: string): Promise<any>
  async get(key: string): Promise<string | null>
  async del(key: string): Promise<number>
  async incr(key: string): Promise<number>
  async publish(channel: string, message: string): Promise<number>
  
  // Transaction support
  async multi(): Promise<TenantRedisTransaction>
}

// Usage
const redis = getTenantRedis(); // Automatically uses current tenant
await redis.set('user:123', 'session-data'); // Becomes wg:tenant-a:user:123
```

### 5. Enhanced Logging (`src/utils/logger.ts`)

#### Tenant Context
- **Automatic Detection**: Adds tenant information to all logs
- **Sentry Integration**: Sets tenant context in error reports
- **Structured Logging**: JSON logs with tenant metadata
- **Security Events**: Enhanced logging for security-sensitive actions

#### Log Structure
```json
{
  "level": "info",
  "msg": "User login successful",
  "tenantSlug": "tenant-a",
  "userId": "user-123",
  "ip": "192.168.1.1",
  "requestId": "req-456",
  "ts": "2023-12-04T12:00:00.000Z"
}
```

### 6. Tenant Settings Service (`src/services/tenant-settings.ts`)

#### Configuration Management
- **Branding**: Logo, colors, themes, display names
- **Contact Info**: Email addresses, policy URLs
- **Rate Limits**: Per-tenant rate limiting overrides
- **SSO Settings**: Identity provider configurations
- **Validation**: Comprehensive settings validation

#### Settings Interface
```typescript
interface TenantSettingsData {
  // Branding
  displayName?: string;
  logoUrl?: string;
  brandColor?: string;
  theme?: ThemeConfig;
  
  // Contact
  contactEmail?: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
  
  // Configuration
  rateLimitConfig?: TenantRateLimitConfig;
  ssoConfig?: TenantSSOConfig;
}
```

### 7. Audit Service (`src/services/audit.ts`)

#### Security Event Tracking
- **Cross-Tenant Attempts**: Logs blocked cross-tenant access
- **Permission Denied**: Records authorization failures
- **Rate Limiting**: Tracks limit exceeded events
- **Auth Failures**: Monitors authentication issues
- **Security Context**: Enhanced Sentry integration for security events

#### Audit Features
- **Tenant Isolation**: All audits automatically scoped by tenant
- **Event Classification**: Security vs. regular events
- **Search & Filtering**: Comprehensive audit querying
- **Real-time Monitoring**: Security event detection

### 8. Tenant Initialization (`src/services/tenant-init.ts`)

#### Automated Setup
- **Default Roles**: Creates tenant_admin and tenant_viewer roles
- **Default Settings**: Initializes branding and configuration
- **JWK Keys**: Ensures cryptographic keys exist
- **Admin Users**: Creates initial admin user with temporary password
- **Health Checks**: Validates tenant setup completeness

#### Initialization Process
```typescript
// Initialize complete tenant
await TenantInitializationService.initializeTenant(
  tenantId, 
  tenantSlug, 
  tenantName
);

// Creates:
// - RBAC roles and permissions
// - Default tenant settings
// - JWK cryptographic keys
// - Initial admin user
```

### 9. Enhanced Authorization Service (`src/services/authz.ts`)

#### Tenant-Scoped Operations
- **Redis Namespacing**: All auth data isolated by tenant
- **Magic Links**: Tenant-isolated passwordless authentication
- **Session Management**: Cross-tenant session prevention
- **Rate Limiting**: Tenant-specific rate limits
- **Security Logging**: Enhanced audit integration

#### Security Enhancements
- **Cross-Tenant Prevention**: Blocks tenant boundary violations
- **Token Isolation**: Tokens bound to specific tenants
- **Session Validation**: Ensures sessions stay within tenant
- **Audit Integration**: All security events logged

### 10. API Route Enhancements

#### Token Endpoint (`app/a/[tenant]/oauth/token/route.ts`)
- **Tenant Verification**: Validates tenant before processing
- **Repository Usage**: Uses tenant-scoped repositories
- **Enhanced Logging**: Tenant-contextual audit logging
- **Cross-Tenant Blocking**: Prevents token exchange across tenants
- **Rate Limiting**: Tenant-specific rate limit enforcement

#### Security Features
```typescript
// Tenant verification
const tenant = await findTenantBySlug(tenantSlug);
if (!tenant) return oidcError('invalid_request', 'unknown tenant');

// Cross-tenant prevention
if (rt.tenantId !== tenant.id) {
  logger.warn('Invalid refresh token attempt', { tenantSlug, ip });
  return oidcError('invalid_grant', 'invalid refresh_token');
}

// Enhanced audit logging
await tenantAuditRepo.create(tenant.id, {
  userId: codeRow.userId,
  action: 'token.exchange',
  ip: ip || null,
  userAgent: req.headers.get('user-agent') || null,
});
```

## Security Guarantees

### 1. Data Isolation
- **Database Level**: Prisma middleware enforces tenantId filtering
- **Application Level**: Repository helpers prevent cross-tenant access
- **API Level**: Route handlers validate tenant ownership
- **Cache Level**: Redis namespacing isolates cached data

### 2. Access Control
- **RBAC**: Role-based permissions within tenants
- **Least Privilege**: Users only get required permissions
- **Audit Trail**: All access attempts are logged
- **Security Monitoring**: Real-time threat detection

### 3. Configuration Isolation
- **Per-Tenant Settings**: Independent configuration per tenant
- **Branding Isolation**: Separate logos, colors, themes
- **Rate Limiting**: Tenant-specific limits and overrides
- **SSO Isolation**: Separate identity provider configurations

### 4. Operational Isolation
- **Logging**: Tenant-prefixed logs and error tracking
- **Monitoring**: Separate metrics per tenant
- **Backup**: Tenant-data isolation in backups
- **Recovery**: Tenant-specific disaster recovery

## Testing

### Comprehensive Test Suite (`e2e/tenant-isolation.spec.ts`)

#### Test Categories
1. **Data Isolation Tests**
   - Prevent cross-tenant user access
   - Prevent cross-tenant client access
   - Isolate audit logs by tenant

2. **RBAC Isolation Tests**
   - Isolate roles by tenant
   - Enforce tenant-scoped permissions
   - Prevent cross-tenant permission checks

3. **Settings Isolation Tests**
   - Isolate tenant settings
   - Prevent cross-tenant configuration access

4. **Redis Namespace Tests**
   - Namespace Redis keys by tenant
   - Isolate Redis channels by tenant

5. **Cross-Tenant Attack Prevention Tests**
   - Prevent client from tenant A accessing tenant B endpoints
   - Prevent token exchange across tenants
   - Log cross-tenant access attempts

6. **Security Event Logging Tests**
   - Log cross-tenant access attempts
   - Log permission denied events
   - Verify security event tracking

7. **Rate Limiting Isolation Tests**
   - Isolate rate limits by tenant
   - Prevent cross-tenant rate limit interference

## Usage Guidelines

### For Developers
1. **Always Use Tenant Repositories**: Use `tenantUserRepo`, `tenantClientRepo`, etc.
2. **Verify Tenant Context**: Use `requireTenant()` for tenant-required operations
3. **Check Permissions**: Use RBAC helpers before privileged operations
4. **Log Security Events**: Use `AuditService` for security-relevant actions
5. **Use Tenant Redis**: Use `getTenantRedis()` for cache operations

### For Operations
1. **Monitor Audit Logs**: Regular security event review
2. **Tenant Health Checks**: Use `TenantInitializationService.getTenantHealth()`
3. **Rate Limit Monitoring**: Adjust limits based on usage patterns
4. **Backup Strategy**: Ensure tenant data isolation in backups

### For Security
1. **Review Cross-Tenant Attempts**: Monitor blocked access attempts
2. **Permission Auditing**: Regular review of role assignments
3. **Configuration Validation**: Ensure proper tenant isolation settings
4. **Incident Response**: Procedures for security event handling

## Migration and Deployment

### Database Migration
- **New Models**: TenantSettings, TenantRole, UserRole added
- **Backward Compatibility**: Existing data preserved
- **Automatic Deployment**: Migration applies new schema changes

### Configuration Updates
- **Environment Variables**: No changes required
- **Service Configuration**: Automatic tenant isolation enabled
- **Feature Flags**: Tenant isolation always active

## Compliance and Standards

### Multi-Tenancy Best Practices
- ✅ **Data Isolation**: Complete tenant data separation
- ✅ **Access Control**: RBAC with least privilege
- ✅ **Audit Logging**: Comprehensive security tracking
- ✅ **Configuration Isolation**: Independent tenant settings
- ✅ **Scalability**: Tenant-aware architecture
- ✅ **Security**: Defense in depth against cross-tenant attacks

### Industry Standards
- **OAuth 2.0**: RFC 6749 compliance with tenant isolation
- **OpenID Connect**: Core specification compliance
- **JWT Security**: Tenant-specific token signing
- **GDPR**: Tenant data isolation and privacy controls
- **SOC 2**: Security controls and audit trails

## Monitoring and Alerting

### Key Metrics
- Cross-tenant access attempts
- Permission denied events
- Rate limit exceeded events
- Authentication failures
- Tenant health status

### Alerting
- Security event notifications
- Tenant isolation violations
- Unusual access patterns
- Configuration drift detection

This implementation provides enterprise-grade tenant isolation suitable for B2B/B2C multi-tenancy requirements.