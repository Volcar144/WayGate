# WayGate Flow Editor - Node Types & Configuration Guide

This guide documents all available node types in the WayGate flow editor, along with their configurations and data collection capabilities.

## Table of Contents

1. [Flow Control Nodes](#flow-control-nodes)
2. [User Interaction Nodes](#user-interaction-nodes)
3. [Verification Nodes](#verification-nodes)
4. [Data Collection Nodes](#data-collection-nodes)
5. [Security & Risk Nodes](#security--risk-nodes)
6. [Integration Nodes](#integration-nodes)
7. [Prompt Field Types](#prompt-field-types)

---

## Flow Control Nodes

### Begin
**Purpose:** Entry point for all flows. Every flow must start with a Begin node.

**Config:**
```json
{
  "description": "Flow entry point",
  "trackEntry": true
}
```

**Output:** Moves to next node in sequence

---

### Finish
**Purpose:** End point for flow execution. Marks the flow as complete.

**Config:**
```json
{
  "successMessage": "Authentication successful",
  "trackExit": true,
  "returnToClient": true
}
```

**Output:** Terminates flow execution

---

### Branch
**Purpose:** Create conditional branches in the flow based on context or rules.

**Config:**
```json
{
  "conditions": [
    {
      "id": "high_risk",
      "name": "High Risk",
      "rule": "context.signals.risk.score > 80",
      "nextNodeId": "uuid-of-node"
    },
    {
      "id": "medium_risk",
      "name": "Medium Risk",
      "rule": "context.signals.risk.score > 40",
      "nextNodeId": "uuid-of-node"
    }
  ],
  "defaultNextNodeId": "uuid-of-default-node"
}
```

**Output:** Routes to different nodes based on conditions

---

### Conditional Logic
**Purpose:** Advanced conditional processing with complex logic operations.

**Config:**
```json
{
  "logic": "AND",
  "conditions": [
    {
      "field": "user.email",
      "operator": "contains",
      "value": "@company.com"
    },
    {
      "field": "signals.geo.country",
      "operator": "equals",
      "value": "US"
    }
  ],
  "trueNodeId": "uuid-of-node",
  "falseNodeId": "uuid-of-node"
}
```

**Operators:** `equals`, `contains`, `startsWith`, `endsWith`, `greaterThan`, `lessThan`, `in`, `notIn`

---

### Delay
**Purpose:** Introduce a time delay in the flow execution.

**Config:**
```json
{
  "delayMs": 5000,
  "delayReason": "Rate limiting",
  "nextNodeId": "uuid-of-node"
}
```

**Parameters:**
- `delayMs`: Milliseconds to delay (min: 100, max: 300000)

---

### Loop
**Purpose:** Repeat a sequence of nodes multiple times or while a condition is true.

**Config:**
```json
{
  "type": "count",
  "iterations": 3,
  "nodeSequenceStart": "uuid-of-node",
  "nodeSequenceEnd": "uuid-of-node",
  "nextNodeId": "uuid-of-node"
}
```

Or with condition:
```json
{
  "type": "while",
  "condition": "retries < 3",
  "nodeSequenceStart": "uuid-of-node",
  "nextNodeId": "uuid-of-node"
}
```

---

### Parallel Process
**Purpose:** Execute multiple node sequences in parallel before continuing.

**Config:**
```json
{
  "parallelBranches": [
    {
      "id": "branch_1",
      "nodeSequence": ["uuid-1", "uuid-2"]
    },
    {
      "id": "branch_2",
      "nodeSequence": ["uuid-3", "uuid-4"]
    }
  ],
  "waitForAll": true,
  "timeoutMs": 30000,
  "nextNodeId": "uuid-of-node"
}
```

---

## User Interaction Nodes

### Prompt UI
**Purpose:** Display a customizable prompt/form to the user and collect responses.

**Config:**
```json
{
  "uiPromptId": "uuid-of-prompt",
  "timeout": 120,
  "allowSkip": false,
  "trackSubmission": true
}
```

**Associate with UI Prompt:** Select a prompt from the "Prompt library" dropdown

---

### Notification
**Purpose:** Send notifications to the user via email, SMS, or push.

**Config:**
```json
{
  "notificationType": "email",
  "template": "verification_code",
  "templateVariables": {
    "code": "{{verificationCode}}",
    "name": "{{user.name}}"
  },
  "deliveryTimeout": 60,
  "retryAttempts": 3,
  "nextNodeId": "uuid-of-node"
}
```

**Notification Types:** `email`, `sms`, `push`, `in_app`

---

## Verification Nodes

### Email Verification
**Purpose:** Send and verify email address with OTP or verification link.

**Config:**
```json
{
  "method": "otp",
  "otpLength": 6,
  "otpExpiry": 900,
  "maxAttempts": 3,
  "successNodeId": "uuid-of-node",
  "failureNodeId": "uuid-of-node"
}
```

**Methods:** `otp`, `link`, `code`

---

### SMS Verification
**Purpose:** Send OTP via SMS and verify.

**Config:**
```json
{
  "provider": "twilio",
  "otpLength": 6,
  "otpExpiry": 600,
  "maxAttempts": 3,
  "phoneField": "phone_number",
  "successNodeId": "uuid-of-node",
  "failureNodeId": "uuid-of-node"
}
```

**Providers:** `twilio`, `nexmo`, `aws_sns`

---

### Phone Verification
**Purpose:** Verify phone number via call or SMS.

**Config:**
```json
{
  "verificationMethod": "sms",
  "language": "en",
  "phoneField": "phone_number",
  "timeout": 300,
  "successNodeId": "uuid-of-node",
  "failureNodeId": "uuid-of-node"
}
```

---

### Require Reauth
**Purpose:** Force user to re-authenticate with elevated requirements.

**Config:**
```json
{
  "authMethod": "password",
  "maxAttempts": 3,
  "timeout": 600,
  "successNodeId": "uuid-of-node",
  "failureNodeId": "uuid-of-node"
}
```

**Auth Methods:** `password`, `mfa`, `passwordless`, `biometric`

---

### CAPTCHA Check
**Purpose:** Verify user is human using CAPTCHA.

**Config:**
```json
{
  "provider": "recaptcha",
  "version": "v3",
  "difficulty": "medium",
  "scoreThreshold": 0.5,
  "successNodeId": "uuid-of-node",
  "failureNodeId": "uuid-of-node"
}
```

**Providers:** `recaptcha`, `hcaptcha`, `cloudflare`

---

## Data Collection Nodes

### Document Upload
**Purpose:** Collect documents from user (ID, proof of address, etc.).

**Config:**
```json
{
  "documentType": "national_id",
  "allowedFormats": ["pdf", "jpg", "png"],
  "maxFileSize": 5242880,
  "requireOCR": false,
  "storageLocation": "secure_vault",
  "successNodeId": "uuid-of-node",
  "failureNodeId": "uuid-of-node"
}
```

**Document Types:** `national_id`, `passport`, `driver_license`, `proof_of_address`, `utility_bill`, `bank_statement`

---

### Metadata Write
**Purpose:** Write or update user metadata/custom attributes.

**Config:**
```json
{
  "metadata": {
    "verified_email": true,
    "verification_method": "otp",
    "consent_given": true,
    "custom_field": "{{promptResponse.custom_field}}"
  },
  "mergeBehavior": "merge",
  "successNodeId": "uuid-of-node"
}
```

**Merge Behaviors:** `merge`, `replace`, `append`

---

### Data Enrichment
**Purpose:** Enrich user data from external data sources.

**Config:**
```json
{
  "enrichmentServices": [
    {
      "name": "geo_enrichment",
      "provider": "maxmind",
      "dataPoints": ["country", "region", "city", "postal_code"]
    },
    {
      "name": "phone_enrichment",
      "provider": "twilio_lookup",
      "dataPoints": ["carrier", "line_type", "is_valid"]
    }
  ],
  "timeout": 10000,
  "storeResults": true,
  "nextNodeId": "uuid-of-node"
}
```

---

## Security & Risk Nodes

### Read Signals
**Purpose:** Collect contextual signals about the user (IP, device, geo, etc.).

**Config:**
```json
{
  "collectIP": true,
  "collectUserAgent": true,
  "collectGeo": true,
  "collectDevice": true,
  "geoProvider": "maxmind",
  "nextNodeId": "uuid-of-node"
}
```

---

### Device Fingerprint
**Purpose:** Generate and verify device fingerprint for repeated access patterns.

**Config:**
```json
{
  "hashAlgorithm": "sha256",
  "components": ["user_agent", "accept_language", "accept_encoding"],
  "storeFingerprint": true,
  "verifyAgainstHistory": true,
  "unknownDeviceNodeId": "uuid-of-node",
  "knownDeviceNodeId": "uuid-of-node"
}
```

---

### Geolocation Check
**Purpose:** Verify user location against expected patterns or whitelist.

**Config:**
```json
{
  "checkType": "velocity",
  "maxVelocity": 900,
  "whitelist": ["US", "CA"],
  "allowUnknown": false,
  "successNodeId": "uuid-of-node",
  "failureNodeId": "uuid-of-node"
}
```

**Check Types:** `velocity`, `whitelist`, `risk_score`

---

### Threat Detection
**Purpose:** Check against threat intelligence feeds and detect malicious patterns.

**Config:**
```json
{
  "threatFeeds": [
    "blocklist_ips",
    "fraud_patterns",
    "botnet_detection"
  ],
  "blockSuspicious": true,
  "logThreatLevel": "medium",
  "successNodeId": "uuid-of-node",
  "threatNodeId": "uuid-of-node"
}
```

---

### Rate Limit Check
**Purpose:** Enforce rate limits on user actions.

**Config:**
```json
{
  "action": "login_attempt",
  "limit": 5,
  "window": 300,
  "identifier": "email",
  "successNodeId": "uuid-of-node",
  "limitExceededNodeId": "uuid-of-node"
}
```

---

### Session Binding
**Purpose:** Bind session to device and prevent session hijacking.

**Config:**
```json
{
  "bindToIP": true,
  "bindToUserAgent": true,
  "bindToDeviceFingerprint": true,
  "verifyOnRequest": true,
  "successNodeId": "uuid-of-node",
  "failureNodeId": "uuid-of-node"
}
```

---

### Biometric Check
**Purpose:** Verify user with biometric authentication (fingerprint, face, etc.).

**Config:**
```json
{
  "biometricType": "fingerprint",
  "provider": "platform",
  "maxAttempts": 3,
  "timeout": 60,
  "successNodeId": "uuid-of-node",
  "failureNodeId": "uuid-of-node"
}
```

**Types:** `fingerprint`, `face`, `iris`, `voice`

---

## Integration Nodes

### Webhook
**Purpose:** Call external webhook and pass context data.

**Config:**
```json
{
  "url": "https://api.example.com/callback",
  "method": "POST",
  "timeout": 10000,
  "retries": 2,
  "headers": {
    "Authorization": "Bearer {{webhookSecret}}"
  },
  "payload": {
    "userId": "{{user.id}}",
    "email": "{{user.email}}",
    "context": "{{context}}"
  },
  "successNodeId": "uuid-of-node",
  "failureNodeId": "uuid-of-node"
}
```

---

### API Request
**Purpose:** Make HTTP requests to external APIs and process responses.

**Config:**
```json
{
  "url": "https://api.example.com/lookup",
  "method": "GET",
  "timeout": 5000,
  "authentication": {
    "type": "bearer",
    "token": "{{apiToken}}"
  },
  "params": {
    "email": "{{user.email}}"
  },
  "responseMapping": {
    "riskScore": "body.risk_score",
    "approved": "body.approved"
  },
  "successNodeId": "uuid-of-node",
  "errorNodeId": "uuid-of-node"
}
```

---

## Prompt Field Types

The following field types are available for collecting user input in prompts:

| Type | Description | Use Cases |
|------|-------------|-----------|
| `text` | Single-line text input | Names, usernames, generic input |
| `email` | Email input with validation | Email collection |
| `tel` | Telephone input | Phone number collection |
| `url` | URL input with validation | Website collection |
| `textarea` | Multi-line text input | Comments, descriptions, longer text |
| `number` | Numeric input | Age, quantity, amounts |
| `password` | Masked password input | Password collection |
| `checkbox` | Single checkbox | Consent, acknowledgments |
| `radio` | Radio button group | Single choice from options |
| `select` | Dropdown selection | Choice from predefined options |
| `multiselect` | Multiple selection | Multiple choices from options |
| `date` | Date picker | Date collection (YYYY-MM-DD) |
| `time` | Time picker | Time collection (HH:MM) |
| `color` | Color picker | Color selection |
| `range` | Slider for range selection | Numeric range (0-100) |
| `otp` | One-time password input | OTP verification codes |
| `file` | File upload | Document/file collection |
| `address` | Address input | Full address collection |
| `signature` | Digital signature pad | Signature capture |

### Example Prompt with Various Field Types

```json
{
  "fields": [
    {
      "id": "full_name",
      "label": "Full Name",
      "type": "text",
      "required": true,
      "placeholder": "John Doe"
    },
    {
      "id": "email",
      "label": "Email Address",
      "type": "email",
      "required": true,
      "placeholder": "john@example.com"
    },
    {
      "id": "phone",
      "label": "Phone Number",
      "type": "tel",
      "placeholder": "+1 (555) 000-0000"
    },
    {
      "id": "country",
      "label": "Country",
      "type": "select",
      "options": [
        { "label": "United States", "value": "US" },
        { "label": "Canada", "value": "CA" },
        { "label": "United Kingdom", "value": "UK" }
      ]
    },
    {
      "id": "verification_method",
      "label": "Verification Method",
      "type": "radio",
      "options": [
        { "label": "Email", "value": "email" },
        { "label": "SMS", "value": "sms" }
      ]
    },
    {
      "id": "document",
      "label": "Upload ID Document",
      "type": "file",
      "helperText": "Accepted formats: PDF, JPG, PNG"
    },
    {
      "id": "agree_terms",
      "label": "I agree to the terms and conditions",
      "type": "checkbox",
      "required": true
    },
    {
      "id": "otp",
      "label": "Enter OTP",
      "type": "otp",
      "placeholder": "000000"
    }
  ],
  "submitLabel": "Continue",
  "cancelLabel": "Cancel"
}
```

---

## Flow Creation Best Practices

1. **Start Simple:** Begin with Begin → Prompt UI → Finish for basic flows
2. **Add Risk Assessment:** Use Read Signals → Branch based on risk level
3. **Progressive Verification:** Stack verification nodes based on risk (Low: Email, Medium: SMS, High: MFA)
4. **Error Handling:** Always provide failure nodes for critical operations
5. **Timeout Management:** Set appropriate timeouts for external service calls
6. **Data Privacy:** Use Document Upload securely for sensitive data
7. **User Experience:** Provide clear notifications and feedback through Notification nodes
8. **Testing:** Use recent flow runs to validate flow behavior

---

## Configuration Variables

### Context Variables (available in conditions and mappings)
- `user.id` - User identifier
- `user.email` - User email address
- `user.name` - User name
- `pending.rid` - Request ID
- `pending.clientId` - OAuth client ID
- `pending.scope` - OAuth scope
- `signals.ip` - Client IP address
- `signals.geo.country` - Geolocation country
- `signals.device.os` - Device OS
- `context.metadata.*` - Custom metadata fields

### Template Variables (in payloads and notifications)
- `{{user.id}}` - User ID
- `{{user.email}}` - User email
- `{{verificationCode}}` - Generated OTP
- `{{context.*}}` - Any context field
- `{{promptResponse.*}}` - Form response data

---

## Advanced Topics

### Custom Node Configuration
Node configs accept JSON objects. Use this for:
- Conditional routing rules
- API integration settings
- Custom logic expressions
- Multi-step processes

### State Management
Flow state is preserved across nodes via the `context` object. Use this to:
- Pass data between nodes
- Make decisions based on previous steps
- Accumulate user responses

### Error Recovery
Failed nodes can route to alternative paths. Always configure:
- `successNodeId` - Path on success
- `failureNodeId` - Path on failure
- `timeout` handling for external calls
