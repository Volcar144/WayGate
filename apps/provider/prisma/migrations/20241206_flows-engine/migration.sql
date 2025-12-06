-- Create enums for the flows engine
CREATE TYPE "FlowTrigger" AS ENUM ('signin', 'signup', 'pre_consent', 'post_consent', 'custom');
CREATE TYPE "FlowStatus" AS ENUM ('enabled', 'disabled');
CREATE TYPE "FlowRunStatus" AS ENUM ('running', 'success', 'failed', 'interrupted');
CREATE TYPE "FlowEventType" AS ENUM ('enter', 'exit', 'prompt', 'resume', 'error');
CREATE TYPE "FlowNodeType" AS ENUM ('begin', 'read_signals', 'check_captcha', 'prompt_ui', 'metadata_write', 'require_reauth', 'branch', 'webhook', 'api_request', 'finish');

-- Flow definitions
CREATE TABLE "Flow" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "FlowTrigger" NOT NULL,
    "status" "FlowStatus" NOT NULL DEFAULT 'disabled',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "Flow_tenantId_trigger_status_idx" ON "Flow"("tenantId", "trigger", "status");

-- Flow nodes
CREATE TABLE "FlowNode" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "flowId" UUID NOT NULL,
    "type" "FlowNodeType" NOT NULL,
    "config" JSONB NOT NULL,
    "order" INTEGER NOT NULL,
    "nextNodeId" UUID,
    "failureNodeId" UUID,
    "uiPromptId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "FlowNode_flowId_order_idx" ON "FlowNode"("flowId", "order");
CREATE INDEX "FlowNode_tenantId_idx" ON "FlowNode"("tenantId");

-- Flow runs
CREATE TABLE "FlowRun" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "flowId" UUID NOT NULL,
    "userId" UUID,
    "requestRid" TEXT,
    "trigger" "FlowTrigger" NOT NULL,
    "status" "FlowRunStatus" NOT NULL DEFAULT 'running',
    "context" JSONB NOT NULL,
    "currentNodeId" UUID,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "finishedAt" TIMESTAMPTZ,
    "lastError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX "FlowRun_tenantId_status_idx" ON "FlowRun"("tenantId", "status");
CREATE INDEX "FlowRun_tenantId_flowId_idx" ON "FlowRun"("tenantId", "flowId");
CREATE UNIQUE INDEX "FlowRun_tenant_request_trigger_key" ON "FlowRun"("tenantId", "requestRid", "trigger");

-- Flow events
CREATE TABLE "FlowEvent" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "flowRunId" UUID NOT NULL,
    "nodeId" UUID,
    "type" "FlowEventType" NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "FlowEvent_flowRunId_idx" ON "FlowEvent"("flowRunId");
CREATE INDEX "FlowEvent_tenant_type_idx" ON "FlowEvent"("tenantId", "type");

-- Prompt definitions
CREATE TABLE "UiPrompt" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "schema" JSONB NOT NULL,
    "timeoutSec" INTEGER DEFAULT 120,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "UiPrompt_tenantId_idx" ON "UiPrompt"("tenantId");
CREATE UNIQUE INDEX "UiPrompt_tenant_title_key" ON "UiPrompt"("tenantId", "title");

-- User metadata store
CREATE TABLE "UserMetadata" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "UserMetadata_namespace_unique" ON "UserMetadata"("tenantId", "userId", "namespace");
CREATE INDEX "UserMetadata_tenantId_idx" ON "UserMetadata"("tenantId");

-- Foreign keys
ALTER TABLE "Flow"
  ADD CONSTRAINT "Flow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;

ALTER TABLE "FlowNode"
  ADD CONSTRAINT "FlowNode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "FlowNode_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "FlowNode_nextNodeId_fkey" FOREIGN KEY ("nextNodeId") REFERENCES "FlowNode"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "FlowNode_failureNodeId_fkey" FOREIGN KEY ("failureNodeId") REFERENCES "FlowNode"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "FlowNode_uiPromptId_fkey" FOREIGN KEY ("uiPromptId") REFERENCES "UiPrompt"("id") ON DELETE SET NULL;

ALTER TABLE "FlowRun"
  ADD CONSTRAINT "FlowRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "FlowRun_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "FlowRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "FlowRun_currentNodeId_fkey" FOREIGN KEY ("currentNodeId") REFERENCES "FlowNode"("id") ON DELETE SET NULL;

ALTER TABLE "FlowEvent"
  ADD CONSTRAINT "FlowEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "FlowEvent_flowRunId_fkey" FOREIGN KEY ("flowRunId") REFERENCES "FlowRun"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "FlowEvent_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "FlowNode"("id") ON DELETE SET NULL;

ALTER TABLE "UiPrompt"
  ADD CONSTRAINT "UiPrompt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;

ALTER TABLE "UserMetadata"
  ADD CONSTRAINT "UserMetadata_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "UserMetadata_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
