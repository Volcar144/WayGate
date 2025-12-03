Incident Runbook

Scope: Provider and RP services in this monorepo.

1) Signing key compromise
- Indicators: Suspicious token audience/issuer, unknown KIDs used by tokens, elevated 401s after rotation.
- Immediate actions:
  - Revoke compromised key(s):
    - Call POST /a/{tenant}/admin/keys/revoke with header x-admin-secret and JSON { "kid": "<kid>" } to retire a specific key, or without body to retire all active keys for the tenant.
  - Rotate keys: Ensure a new staged/active key is created out-of-band and promoted to active; restart deploy if necessary.
  - Invalidate sessions: Call POST /a/{tenant}/admin/revoke/sessions to revoke all active refresh tokens and expire sessions.
  - Adjust rate‑limits via env RL_* overrides:
    - To handle a benign refresh "stampede" after rotation, temporarily raise global ceilings.
    - To throttle suspected abuse, lower per‑actor (IP/client) limits using RL_OVERRIDES_JSON.
- Follow-up:
  - Audit: Export audit logs via GET /a/{tenant}/admin/audit/export?from=...&to=...&format=csv and investigate access.
  - Update clients: Communicate KID changes and cache invalidation guidance.

2) Token abuse (refresh token reuse, brute‑force)
- Indicators: Sentry alerts on token.reuse_detected; spikes in 401s; many 429s on token endpoint.
- Immediate actions:
  - Revoke sessions for affected user(s) with POST /a/{tenant}/admin/revoke/sessions { "user_id": "..." }.
  - Tune rate limits using RL_OVERRIDES_JSON to clamp per‑client or per‑tenant caps; redeploy.
  - Inspect audit logs for suspicious IPs and client IDs.
- Follow-up:
  - Consider rotating client credentials for compromised clients.
  - Monitor Sentry for new errors; review DB breadcrumbs around token issuance.

3) SMTP account breach
- Indicators: Unusual volume of magic emails; complaints of phish; Sentry errors from email senders.
- Immediate actions:
  - Disable emailing: unset SMTP_* env or rotate SMTP credentials.
  - Monitor login volume; consider disabling magic link flows temporarily if necessary.
  - Export audits to identify abused accounts.
- Follow-up:
  - Enforce domain allowlists and additional OTP verification as needed.

Notes
- Sentry: Both apps initialize Sentry when SENTRY_DSN is set. Requests and unhandled errors are captured. Prisma DB queries are recorded as breadcrumbs (PII redacted).
- Logs: Server logs are structured JSON with basic redaction of emails and secrets.
- Health: /healthz (liveness) and /readyz (DB + Redis readiness) endpoints are available on the provider.
- Security headers: Middleware sets CSP and other headers. The authorize page uses a nonce‑based inline script to satisfy CSP.
