# WayGate Flow Editor - Implementation Examples

This document provides practical examples for creating common authentication flows.

## Example 1: Basic Email Verification Flow

**Use Case:** Simple email-based verification

**Flow Structure:**
1. Begin
2. Prompt UI (Email Collection)
3. Email Verification
4. Metadata Write (Mark as verified)
5. Finish

**Node Configurations:**

### Node 1: Begin
```json
{
  "description": "Start email verification flow",
  "trackEntry": true
}
```

### Node 2: Prompt UI (Email Collection)
```json
{
  "uiPromptId": "<select from prompt library>",
  "timeout": 120,
  "allowSkip": false,
  "trackSubmission": true
}
```

**Associated Prompt:**
```json
{
  "title": "Email Verification",
  "description": "Please enter your email address",
  "fields": [
    {
      "id": "email_field",
      "label": "Email Address",
      "type": "email",
      "required": true,
      "placeholder": "user@example.com"
    }
  ],
  "submitLabel": "Send Code",
  "cancelLabel": "Cancel"
}
```

### Node 3: Email Verification
```json
{
  "method": "otp",
  "otpLength": 6,
  "otpExpiry": 900,
  "maxAttempts": 3,
  "successNodeId": "<UUID of Metadata Write>",
  "failureNodeId": "<UUID of Finish with error>"
}
```

### Node 4: Metadata Write
```json
{
  "metadata": {
    "email_verified": true,
    "email_verified_at": "{{timestamp}}",
    "verification_method": "otp"
  },
  "mergeBehavior": "merge",
  "successNodeId": "<UUID of Finish>"
}
```

### Node 5: Finish
```json
{
  "successMessage": "Email verified successfully",
  "trackExit": true,
  "returnToClient": true
}
```

---

## Example 2: Risk-Based Authentication with Progressive Verification

**Use Case:** MFA only for high-risk logins

**Flow Structure:**
1. Begin
2. Read Signals
3. Branch (Risk Assessment)
4. Path A (Low Risk): Finish
5. Path B (Medium Risk): SMS Verification → Finish
6. Path C (High Risk): Email + SMS → CAPTCHA → Finish

**Node Configurations:**

### Node 1: Begin
```json
{
  "description": "Risk-based auth flow",
  "trackEntry": true
}
```

### Node 2: Read Signals
```json
{
  "collectIP": true,
  "collectUserAgent": true,
  "collectGeo": true,
  "collectDevice": true,
  "geoProvider": "maxmind",
  "nextNodeId": "<UUID of Branch>"
}
```

### Node 3: Branch (Risk Assessment)
```json
{
  "conditions": [
    {
      "id": "high_risk",
      "name": "High Risk (>80)",
      "rule": "context.signals.risk.score > 80",
      "nextNodeId": "<UUID of Email Verification>"
    },
    {
      "id": "medium_risk",
      "name": "Medium Risk (40-80)",
      "rule": "context.signals.risk.score > 40",
      "nextNodeId": "<UUID of SMS Verification>"
    }
  ],
  "defaultNextNodeId": "<UUID of Finish Low Risk>"
}
```

### Node 4A: SMS Verification (Medium Risk Path)
```json
{
  "provider": "twilio",
  "otpLength": 6,
  "otpExpiry": 600,
  "maxAttempts": 3,
  "phoneField": "phone_number",
  "successNodeId": "<UUID of Finish>",
  "failureNodeId": "<UUID of Finish Error>"
}
```

### Node 4B: Email Verification (High Risk Path)
```json
{
  "method": "otp",
  "otpLength": 6,
  "otpExpiry": 900,
  "maxAttempts": 3,
  "successNodeId": "<UUID of SMS Verification>",
  "failureNodeId": "<UUID of Finish Error>"
}
```

### Node 5B2: SMS Verification (After Email - High Risk)
```json
{
  "provider": "twilio",
  "otpLength": 6,
  "otpExpiry": 600,
  "maxAttempts": 3,
  "phoneField": "phone_number",
  "successNodeId": "<UUID of CAPTCHA Check>",
  "failureNodeId": "<UUID of Finish Error>"
}
```

### Node 5B3: CAPTCHA Check
```json
{
  "provider": "recaptcha",
  "version": "v3",
  "difficulty": "hard",
  "scoreThreshold": 0.7,
  "successNodeId": "<UUID of Finish>",
  "failureNodeId": "<UUID of Finish Error>"
}
```

---

## Example 3: Multi-Factor Authentication Flow

**Use Case:** Complete MFA with multiple verification methods

**Flow Structure:**
1. Begin
2. Prompt UI (Method Selection)
3. Branch (Route by selection)
4. Path A: Email OTP → Code Entry → Verify
5. Path B: SMS OTP → Code Entry → Verify
6. Path C: TOTP → Code Entry → Verify
7. All paths → Session Binding → Finish

**Node Configurations:**

### Node 2: Prompt UI (Method Selection)
```json
{
  "title": "Choose Verification Method",
  "description": "Select how you'd like to verify",
  "fields": [
    {
      "id": "mfa_method",
      "label": "Verification Method",
      "type": "radio",
      "required": true,
      "options": [
        { "label": "Email Code", "value": "email" },
        { "label": "SMS Code", "value": "sms" },
        { "label": "Authenticator App", "value": "totp" }
      ]
    }
  ],
  "submitLabel": "Continue",
  "cancelLabel": "Cancel"
}
```

### Node 3: Branch (Route by Method)
```json
{
  "conditions": [
    {
      "id": "email_route",
      "rule": "promptResponse.mfa_method == 'email'",
      "nextNodeId": "<UUID of Email Verification>"
    },
    {
      "id": "sms_route",
      "rule": "promptResponse.mfa_method == 'sms'",
      "nextNodeId": "<UUID of SMS Verification>"
    }
  ],
  "defaultNextNodeId": "<UUID of TOTP Verification>"
}
```

### Node X: Session Binding (Final)
```json
{
  "bindToIP": true,
  "bindToUserAgent": true,
  "bindToDeviceFingerprint": true,
  "verifyOnRequest": true,
  "successNodeId": "<UUID of Finish>",
  "failureNodeId": "<UUID of Finish Error>"
}
```

---

## Example 4: KYC (Know Your Customer) Flow

**Use Case:** Document verification and identity confirmation

**Flow Structure:**
1. Begin
2. Read Signals
3. Threat Detection
4. Prompt UI (Collect Personal Info)
5. Document Upload (ID)
6. Document Upload (Proof of Address)
7. Data Enrichment
8. Metadata Write (KYC Complete)
9. Finish

**Node Configurations:**

### Node 4: Prompt UI (Personal Info)
```json
{
  "title": "Personal Information",
  "fields": [
    {
      "id": "full_name",
      "label": "Full Name",
      "type": "text",
      "required": true,
      "placeholder": "John Doe"
    },
    {
      "id": "date_of_birth",
      "label": "Date of Birth",
      "type": "date",
      "required": true
    },
    {
      "id": "address",
      "label": "Address",
      "type": "address",
      "required": true
    },
    {
      "id": "country",
      "label": "Country",
      "type": "select",
      "required": true,
      "options": [
        { "label": "United States", "value": "US" },
        { "label": "Canada", "value": "CA" },
        { "label": "United Kingdom", "value": "UK" }
      ]
    }
  ],
  "submitLabel": "Next",
  "cancelLabel": "Cancel"
}
```

### Node 5: Document Upload (ID)
```json
{
  "documentType": "national_id",
  "allowedFormats": ["pdf", "jpg", "png"],
  "maxFileSize": 5242880,
  "requireOCR": true,
  "storageLocation": "secure_vault",
  "successNodeId": "<UUID of Document Upload 2>",
  "failureNodeId": "<UUID of Finish Error>"
}
```

### Node 6: Document Upload (Proof of Address)
```json
{
  "documentType": "proof_of_address",
  "allowedFormats": ["pdf", "jpg", "png"],
  "maxFileSize": 5242880,
  "requireOCR": false,
  "storageLocation": "secure_vault",
  "successNodeId": "<UUID of Data Enrichment>",
  "failureNodeId": "<UUID of Finish Error>"
}
```

### Node 7: Data Enrichment
```json
{
  "enrichmentServices": [
    {
      "name": "identity_verification",
      "provider": "external_kyc_provider",
      "dataPoints": ["identity_match", "document_validity", "liveness"]
    },
    {
      "name": "sanctions_screening",
      "provider": "compliance_service",
      "dataPoints": ["sanctions_hit", "risk_score"]
    }
  ],
  "timeout": 15000,
  "storeResults": true,
  "nextNodeId": "<UUID of Metadata Write>"
}
```

### Node 8: Metadata Write
```json
{
  "metadata": {
    "kyc_status": "approved",
    "kyc_completed_at": "{{timestamp}}",
    "kyc_documents": ["national_id", "proof_of_address"],
    "identity_verified": true,
    "sanctions_cleared": true
  },
  "mergeBehavior": "merge",
  "successNodeId": "<UUID of Finish>"
}
```

---

## Example 5: Adaptive Verification Based on Context

**Use Case:** Different verification paths based on device, location, and history

**Flow Structure:**
1. Begin
2. Read Signals
3. Device Fingerprint
4. Conditional Logic
5. Various paths based on device/location/history
6. Finish

**Node Configurations:**

### Node 3: Device Fingerprint
```json
{
  "hashAlgorithm": "sha256",
  "components": ["user_agent", "accept_language", "accept_encoding", "screen_resolution"],
  "storeFingerprint": true,
  "verifyAgainstHistory": true,
  "unknownDeviceNodeId": "<UUID of Verification>",
  "knownDeviceNodeId": "<UUID of Finish>"
}
```

### Node 4: Conditional Logic
```json
{
  "logic": "AND",
  "conditions": [
    {
      "field": "device.is_known",
      "operator": "equals",
      "value": "true"
    },
    {
      "field": "signals.geo.country",
      "operator": "equals",
      "value": "{{user.primary_country}}"
    }
  ],
  "trueNodeId": "<UUID of Finish>",
  "falseNodeId": "<UUID of Risk Assessment Branch>"
}
```

---

## Example 6: Rate Limiting & Fraud Prevention

**Use Case:** Protect against brute force and suspicious patterns

**Flow Structure:**
1. Begin
2. Rate Limit Check
3. Threat Detection
4. Geolocation Check
5. Branch (Decision)
6. Finish or Block

**Node Configurations:**

### Node 2: Rate Limit Check
```json
{
  "action": "login_attempt",
  "limit": 5,
  "window": 300,
  "identifier": "email",
  "successNodeId": "<UUID of Threat Detection>",
  "limitExceededNodeId": "<UUID of Block Path>"
}
```

### Node 3: Threat Detection
```json
{
  "threatFeeds": [
    "blocklist_ips",
    "fraud_patterns",
    "botnet_detection",
    "tor_exit_nodes"
  ],
  "blockSuspicious": false,
  "logThreatLevel": "low",
  "successNodeId": "<UUID of Geolocation Check>",
  "threatNodeId": "<UUID of Risk Assessment>"
}
```

### Node 4: Geolocation Check
```json
{
  "checkType": "velocity",
  "maxVelocity": 900,
  "whitelist": ["US", "CA", "UK"],
  "allowUnknown": false,
  "successNodeId": "<UUID of Finish>",
  "failureNodeId": "<UUID of Verification Required>"
}
```

---

## Example 7: Webhook Integration Flow

**Use Case:** Call external service for custom validation

**Flow Structure:**
1. Begin
2. Read Signals
3. Webhook (Call custom validation)
4. Branch (Based on webhook response)
5. Finish or Require Additional Verification

**Node Configurations:**

### Node 3: Webhook
```json
{
  "url": "https://api.custom-service.com/validate",
  "method": "POST",
  "timeout": 5000,
  "retries": 2,
  "headers": {
    "Authorization": "Bearer {{webhookSecret}}",
    "X-Request-ID": "{{requestId}}"
  },
  "payload": {
    "userId": "{{user.id}}",
    "email": "{{user.email}}",
    "ip": "{{signals.ip}}",
    "country": "{{signals.geo.country}}",
    "risk_score": "{{signals.risk.score}}"
  },
  "successNodeId": "<UUID of Branch>",
  "failureNodeId": "<UUID of Error Handler>"
}
```

### Node 4: Branch (Based on response)
```json
{
  "conditions": [
    {
      "id": "approved",
      "rule": "webhookResponse.approved == true",
      "nextNodeId": "<UUID of Finish>"
    },
    {
      "id": "needs_verification",
      "rule": "webhookResponse.requires_verification == true",
      "nextNodeId": "<UUID of Email Verification>"
    }
  ],
  "defaultNextNodeId": "<UUID of Block>"
}
```

---

## Configuration Tips

### For Mobile Users
- Shorter timeouts (30-60 seconds)
- Simpler prompts with fewer fields
- Prefer SMS over email for OTP
- Use biometric authentication when available

### For High-Security Scenarios
- Multiple verification methods
- Geolocation checks
- Device binding
- Rate limiting
- Threat intelligence checks

### For Better UX
- Progressive disclosure (ask for info gradually)
- Clear error messages with recovery paths
- Session binding to prevent repeated challenges
- Remember trusted devices

### For Compliance (GDPR/CCPA)
- Log all data collection points
- Implement data retention policies
- Provide audit trails in flow runs
- Use secure document storage for uploads
