# WayGate Flow Execution Engine - How Nodes Are Interpreted & Run

This document explains how the flow engine interprets node types and makes them execute specific actions.

## The Flow Execution Lifecycle

### 1. Flow Triggering
When a user performs an action (e.g., login), the flow is triggered:

```typescript
// File: /workspaces/WayGate/apps/provider/app/a/[tenant]/oauth/magic/consume/route.ts
const flowResult = await startFlowRun({
  tenantId: tenant.id,
  tenantSlug,
  trigger: 'signin',  // Matches Flow.trigger in database
  pending,            // OAuth request context
  user,               // User object {id, email, name}
  request: buildRequestContext(req),  // IP, user-agent, headers
});
```

### 2. Loading the Active Flow
The engine looks up the ENABLED flow matching the trigger:

```typescript
// File: /workspaces/WayGate/apps/provider/src/services/flows/engine.ts line ~265
async function loadActiveFlow(tenantId: string, trigger: FlowTrigger): Promise<FlowWithNodes | null> {
  return prisma.flow.findFirst({
    where: { tenantId, trigger, status: 'enabled' },  // Only ENABLED flows run
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    include: {
      nodes: {
        include: { uiPrompt: true },
        orderBy: { order: 'asc' },  // Execute in order
      },
    },
  });
}
```

### 3. Building Initial Context
The context carries all state through the flow:

```typescript
// File: /workspaces/WayGate/apps/provider/src/services/flows/engine.ts line ~206
function buildInitialContext(options: FlowStartOptions): FlowContext {
  return {
    user: {
      id: options.user.id,
      email: options.user.email,
      name: options.user.name ?? null,
    },
    pending: {
      rid: options.pending.rid,           // Request ID
      clientId: options.pending.clientId, // OAuth client
      clientName: options.pending.clientName,
      scope: options.pending.scope ?? null,
    },
    prompts: {},     // Stores prompt responses
    metadata: {},    // Stores user metadata
  };
}
```

### 4. The Main Node Execution Loop
Nodes are executed sequentially in a while loop:

```typescript
// File: /workspaces/WayGate/apps/provider/src/services/flows/engine.ts line ~595
async function runLoop(args: RunLoopArgs): Promise<FlowEngineResult> {
  const flow = args.run.flow;
  const ordered = flow.nodes;
  const map = nodesMap(flow);
  
  let current: FlowNodeWithPrompt | null = selectEntryNode(flow);  // Start at 'begin'
  let steps = 0;
  
  while (current && steps < maxIterations) {
    steps += 1;
    
    // Each node type has specific handling logic
    if (current.type === 'read_signals') {
      // Extract IP, device, geo data
      enhanceSignals(args.context, args.request);
      current = nextNodeResolver(current, flow);  // Move to next node
      continue;
    }
    
    if (current.type === 'require_reauth') {
      // Trigger re-authentication prompt
      const result = await handlePromptNode(args, flow, current);
      if (result.kind === 'prompt') {
        // Return to user for action
        return promptResult(args.run, flow, current, result.prompt, ttl, tenantSlug, context);
      }
      current = nextNodeResolver(current, flow, result.nextNodeId);
      continue;
    }
    
    if (current.type === 'metadata_write') {
      // Persist data to database
      const ok = await handleMetadataWriteNode(args, current);
      current = nextNodeResolver(current, flow);
      continue;
    }
    
    // ... more node types ...
  }
}
```

---

## How Each Node Type Is Interpreted

### **read_signals** - Extract Context Data
**What it does:** Captures IP address, device type, geolocation, user-agent.

**Code location:** `/workspaces/WayGate/apps/provider/src/services/flows/engine.ts` line ~620

```typescript
if (current.type === 'read_signals') {
  enhanceSignals(args.context, args.request);  // Extracts: IP, device OS/browser, geo
  await updateRunContext(args.run.id, args.context, current.id);
  current = nextNodeResolver(current, flow);  // Continues to next node
  continue;
}
```

**What it populates in context:**
```typescript
context.signals = {
  ip: "203.0.113.42",
  userAgent: "Mozilla/5.0...",
  geo: { country: "US", region: "CA", city: "San Francisco" },
  device: { os: "macOS", browser: "Chrome" },
  risk: { score: 45, reasons: [...] }
};
```

---

### **geolocation_check** - Verify Location Match
**What it does:** Checks if current location matches previously stored location. If mismatch, routes to failure node.

**How it's interpreted:**

1. **Load previous country** from `context.metadata`
2. **Get current country** from signals
3. **Compare them**
4. **Route decision:**
   - If match: Continue to next node
   - If mismatch: Go to `failureNodeId` (e.g., require_reauth node)

**Configuration:**
```json
{
  "namespace": "security",
  "key": "last_login_country",
  "requireSame": true,
  "treatMissingAsMismatch": false
}
```

---

### **require_reauth** - Force Re-Authentication
**What it does:** Displays a prompt to user demanding proof of identity (password, MFA code, etc.).

**Code location:** `/workspaces/WayGate/apps/provider/src/services/flows/engine.ts` line ~637

```typescript
if (current.type === 'require_reauth') {
  const result = await handlePromptNode(args, flow, current);
  
  if (result.kind === 'prompt') {
    // INTERRUPT FLOW: Return HTML form to user
    return promptResult(args.run, flow, current, result.prompt, ttlSeconds, tenantSlug, context);
  }
  
  // User submitted the form, resume continues here
  if (result.kind === 'failure') {
    return { type: 'error', message: 'reauthentication_failed' };
  }
  
  current = nextNodeResolver(current, flow);
  continue;
}
```

**How it's rendered to user:**
```typescript
// File: /workspaces/WayGate/apps/provider/app/a/[tenant]/oauth/magic/consume/route.ts line ~60
function renderFlowPromptPage(props: PromptPageProps) {
  // Generates HTML form with fields defined in uiPrompt.schema
  // Posts back to /consume with flow_run_id, flow_resume_token, and field values
}
```

**Flow interruption:**
- Flow execution **stops** and returns to user
- A resume token is issued (valid for 10 minutes)
- When user submits, `resumeFlow()` is called with the token
- Engine resumes execution at the same node with the submission data

---

### **metadata_write** - Persist User Data
**What it does:** Saves data to the `UserMetadata` database table.

**Code location:** `/workspaces/WayGate/apps/provider/src/services/flows/engine.ts` line ~917

```typescript
async function handleMetadataWriteNode(args: RunLoopArgs, node: FlowNodeWithPrompt) {
  const cfg = sanitizeConfig<MetadataWriteConfig>(node.config, {
    namespace: 'default',
    values: {}
  });
  
  // Save to database
  await writeUserMetadata(args.run.tenantId, args.context.user.id, cfg);
  
  // Update in-memory context
  if (!args.context.metadata) args.context.metadata = {};
  args.context.metadata[cfg.namespace] = cfg.values;
  
  current = nextNodeResolver(current, flow);
  continue;
}
```

**Database operation:**
```typescript
// File: /workspaces/WayGate/apps/provider/src/services/flows/engine.ts line ~476
async function writeUserMetadata(tenantId: string, userId: string, cfg: MetadataWriteConfig) {
  await prisma.userMetadata.upsert({
    where: {
      tenantId_userId_namespace: { tenantId, userId, namespace: cfg.namespace }
    },
    update: { data: cfg.values },
    create: { tenantId, userId, namespace: cfg.namespace, data: cfg.values }
  });
}
```

**Example: Store last login country**
```json
{
  "namespace": "security",
  "values": {
    "last_login_country": "US",
    "last_login_at": "2025-12-06T10:30:00Z"
  }
}
```

---

### **prompt_ui** - Display Custom Form
**What it does:** Shows a form to collect user input (email, verification codes, preferences, etc.).

**Similar to `require_reauth`**, it:
1. **Interrupts** the flow
2. **Renders HTML form** based on uiPrompt schema
3. **Issues resume token**
4. **Waits for user submission**

---

### **check_captcha** - Verify Human
**What it does:** Displays CAPTCHA widget and verifies response.

**Code location:** `/workspaces/WayGate/apps/provider/src/services/flows/engine.ts` line ~829

```typescript
async function handleCaptchaNode(args, flow, node) {
  const cfg = node.config;  // { provider: 'turnstile'|'hcaptcha', siteKey, secretKey }
  
  if (!args.resumeSubmission) {
    // First pass: render CAPTCHA widget to user
    return { kind: 'prompt', prompt, ttlSeconds };
  }
  
  // Second pass: user submitted CAPTCHA
  const token = submission.fields['cf-turnstile-response'];
  
  // Verify with provider's API
  const verification = await verifyCaptcha(cfg, token, args.request.ip);
  
  if (!verification.success) {
    // CAPTCHA failed - re-display
    return { kind: 'prompt', prompt, ttlSeconds };
  }
  
  // Success - store and continue
  args.context.captcha = { provider: cfg.provider, verifiedAt, score };
  current = nextNodeResolver(current, flow);
}
```

---

### **finish** - End Flow
**What it does:** Marks flow as successful and returns to authorization.

**Code location:** `/workspaces/WayGate/apps/provider/src/services/flows/engine.ts` line ~717

```typescript
if (current.type === 'finish') {
  await recordEvent(args.run.tenantId, args.run.id, current.id, 'exit');
  await markRunSuccess(args.run.id, args.context);
  return { type: 'success', runId: args.run.id, context: args.context };
}
```

After `finish`, execution returns to `/a/[tenant]/oauth/magic/consume/route.ts POST handler:
```typescript
if (flowResult.type === 'success') {
  const flowContext = flowResult.context;
  // Continue with authorization: issue auth code, redirect to client
  return finalizeAuthorization({ req, tenant, pending, user });
}
```

---

## Complete Flow Example: Location Check with Re-auth

Here's how a real flow executes:

```
User logs in at https://app.example.com → 
  Hits /a/[tenant]/oauth/magic/consume?token=XXX →
  Triggers flow.trigger='signin' →
  
  [Node 1: begin]
    - No-op, continues
  
  [Node 2: read_signals]
    - Extracts IP, device, geo
    - context.signals.geo.country = "UK"
    - Continues
  
  [Node 3: geolocation_check]
    - Reads context.metadata.security.last_login_country = "US" (from previous login)
    - Detects MISMATCH: "US" != "UK"
    - Routes to failureNodeId → Node 5
  
  [Node 5: require_reauth]
    - Displays HTML form asking for password
    - Issues resume token: "abc123def456..."
    - INTERRUPTS - Returns to user's browser
  
  User enters password and submits →
    Form POSTs to /a/[tenant]/oauth/magic/consume
    Validates password (app logic, not shown here)
    Calls resumeFlow(runId, token, submission)
    
    Engine resumes at Node 5 with submission data
    User interaction recorded in context
    
  [Node 6: metadata_write]
    - Saves { last_login_country: "UK", last_reauth_at: "2025-12-06T..." }
    - To database: UserMetadata(namespace='security')
    - Continues
  
  [Node 7: finish]
    - Marks flow as success
    - Execution returns control to finalizeAuthorization()
    - Issues auth code
    - Redirects to client's redirect_uri
    
Final: User authenticated and logged in
```

---

## Flow State Persistence

### Where State Lives

**During Execution:**
- `context` object in memory (user, pending, signals, prompts, metadata)

**Between Interruptions:**
- `FlowRun.context` in database (JSON)
- `FlowRun.currentNodeId` = node waiting for resume
- `FlowRun.status` = 'interrupted'
- Resume token in Redis or memory store

**Permanent Storage:**
- `UserMetadata` table (persisted by metadata_write nodes)
- `FlowEvent` table (audit trail)
- `FlowRun` table (execution history)

### Loading User Data on Flow Start

```typescript
// File: /workspaces/WayGate/apps/provider/src/services/flows/engine.ts line ~510
export async function startFlowRun(options: FlowStartOptions) {
  const context = buildInitialContext(options);
  
  // Load user's existing metadata
  const metas = await prisma.userMetadata.findMany({
    where: { tenantId: options.tenantId, userId: options.user.id }
  });
  
  for (const m of metas) {
    context.metadata[m.namespace] = m.data;  // Now nodes can READ previous values
  }
  
  // Start execution with full context
  return runLoop({ run, context, ... });
}
```

This allows nodes like `geolocation_check` to read `context.metadata.security.last_login_country` from a previous login.

---

## Summary: Node Execution Framework

| Node Type | Interpreter | Action | Returns To Flow |
|-----------|-----------|--------|-----------------|
| `begin` | Inline in runLoop | No-op | Next node |
| `read_signals` | Inline in runLoop | Populate context.signals | Next node |
| `geolocation_check` | Inline + failureNodeId logic | Compare geo, route | Next or failure node |
| `prompt_ui` | `handlePromptNode()` → interrupt | Show form, issue token | (Pauses until resume) |
| `require_reauth` | `handlePromptNode()` → interrupt | Show form, issue token | (Pauses until resume) |
| `check_captcha` | `handleCaptchaNode()` → interrupt | Show widget, verify | Next node (or re-prompt) |
| `metadata_write` | `handleMetadataWriteNode()` | Save to DB, update context | Next node |
| `finish` | Inline in runLoop | Mark success, exit | (Execution complete) |

**Key Pattern:** Most nodes just update `context` and continue. **Interrupt nodes** (prompt_ui, require_reauth, check_captcha) pause execution and return to the user, resuming later with a token.
