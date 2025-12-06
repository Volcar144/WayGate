export type FlowTrigger = 'signin' | 'signup' | 'pre_consent' | 'post_consent' | 'custom';
export type FlowStatus = 'enabled' | 'disabled';
export type FlowRunStatus = 'running' | 'success' | 'failed' | 'interrupted';
export type FlowEventType = 'enter' | 'exit' | 'prompt' | 'resume' | 'error';
export type FlowNodeType =
  | 'begin'
  | 'read_signals'
  | 'check_captcha'
  | 'prompt_ui'
  | 'metadata_write'
  | 'require_reauth'
  | 'branch'
  | 'webhook'
  | 'api_request'
  | 'email_verification'
  | 'sms_verification'
  | 'phone_verification'
  | 'document_upload'
  | 'biometric_check'
  | 'device_fingerprint'
  | 'geolocation_check'
  | 'threat_detection'
  | 'conditional_logic'
  | 'data_enrichment'
  | 'rate_limit_check'
  | 'session_binding'
  | 'notification'
  | 'mfa_challenge'
  | 'mfa_totp_verify'
  | 'mfa_sms_verify'
  | 'mfa_email_verify'
  | 'mfa_webauthn_verify'
  | 'delay'
  | 'loop'
  | 'parallel_process'
  | 'finish';

export type PromptFieldType = 'text' | 'email' | 'textarea' | 'select' | 'number' | 'password' | 'checkbox' | 'radio' | 'date' | 'tel' | 'url' | 'file' | 'color' | 'range' | 'time' | 'otp' | 'multiselect' | 'address' | 'signature';

export interface PromptFieldOption {
  label: string;
  value: string;
}

export interface PromptField {
  id: string;
  label: string;
  type: PromptFieldType;
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  options?: PromptFieldOption[];
}

export type PromptActionVariant = 'primary' | 'secondary' | 'danger';

export interface PromptAction {
  id: string;
  label: string;
  variant?: PromptActionVariant;
  description?: string;
}

export interface PromptSchema {
  fields: PromptField[];
  actions?: PromptAction[];
  submitLabel?: string;
  cancelLabel?: string;
}

export interface UiPromptDto {
  id: string;
  title: string;
  description?: string | null;
  schema: PromptSchema;
  timeoutSec?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlowNodeDto {
  id: string;
  type: FlowNodeType;
  order: number;
  config: Record<string, any>;
  nextNodeId?: string | null;
  failureNodeId?: string | null;
  uiPromptId?: string | null;
  uiPromptTitle?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlowDto {
  id: string;
  name: string;
  trigger: FlowTrigger;
  status: FlowStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  nodes: FlowNodeDto[];
}

export interface FlowRunEventDto {
  id: string;
  nodeId?: string | null;
  nodeType?: FlowNodeType;
  type: FlowEventType;
  timestamp: string;
  metadata?: Record<string, any> | null;
}

export interface FlowRunUserSummary {
  id: string;
  email: string;
  name?: string | null;
}

export interface FlowRunDto {
  id: string;
  flowId: string;
  flowName: string;
  trigger: FlowTrigger;
  status: FlowRunStatus;
  startedAt: string;
  finishedAt?: string | null;
  lastError?: string | null;
  user?: FlowRunUserSummary | null;
  events: FlowRunEventDto[];
}

export interface FlowDashboardStats {
  totalFlows: number;
  enabledFlows: number;
  recentFailedRuns: number;
  lastRunAt?: string | null;
}

export interface FlowDashboardResponse {
  flows: FlowDto[];
  prompts: UiPromptDto[];
  runs: FlowRunDto[];
  stats: FlowDashboardStats;
}

export type FlowPromptVariant = 'default' | 'captcha' | 'reauth';

export interface FlowPromptDescriptor {
  nodeId: string;
  nodeType: FlowNodeType;
  promptId?: string | null;
  flowId: string;
  flowName: string;
  flowTrigger: FlowTrigger;
  title: string;
  description?: string;
  schema: PromptSchema;
  variant?: FlowPromptVariant;
  error?: string;
  meta?: Record<string, any>;
}
