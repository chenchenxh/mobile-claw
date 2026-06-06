export type AuthMode = "BYOK" | "OAUTH";
export type ProviderType = "openai" | "google" | "anthropic" | "minimax" | "custom";
export type MemoryPolicy = "LOCAL_ONLY";
export type MemoryRecordType = "preference" | "fact" | "goal";
export type ModelTier = "small" | "large";
export type PlanStatus = "idle" | "running" | "paused" | "completed" | "failed" | "terminated";
export type PlanStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type ThemePreference = "system" | "light" | "dark";
export type OAuthWizardStep = "provider" | "auth_mode" | "param_source" | "params" | "authorize" | "exchange" | "done";
export type OAuthParamSource = "preset" | "manual";

export interface TierModelBinding {
  providerId: string;
  modelId: string;
  displayName?: string;
}

export type TierMapping = Record<ModelTier, TierModelBinding>;
export type DisplayModelNameStrategy = "model_id" | "display_name";

export interface WorkspaceConfig {
  id: string;
  name: string;
  defaultModel: string;
  systemPrompt: string;
  memoryPolicy: MemoryPolicy;
  tierMapping?: TierMapping;
  displayModelNameStrategy?: DisplayModelNameStrategy;
}

export interface ProviderCapabilities {
  supportsChat: boolean;
  supportsStream: boolean;
  supportsEmbedding: boolean;
}

export interface ModelProvider {
  id: string;
  type: ProviderType;
  authMode: AuthMode;
  authModes?: AuthMode[];
  capabilities: ProviderCapabilities;
}

export interface ModelSession {
  providerId: string;
  modelId: string;
  credentialRef: string;
  apiBaseUrl?: string;
}

export interface PlanStep {
  id: string;
  title: string;
  tool: string;
  input: Record<string, unknown>;
  status: PlanStepStatus;
  output?: unknown;
  error?: string;
}

export interface PlanRun {
  runId: string;
  status: PlanStatus;
  steps: PlanStep[];
  currentStep: number;
  error?: string;
}

export interface MemoryRecord {
  id: string;
  channelId: string;
  type: MemoryRecordType;
  content: string;
  embeddingRef: string;
  timestamp: number;
}

export interface Message {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  ts: number;
  seq?: number;
  sourceType?: "user" | "assistant" | "system" | "cron_auto";
  flowRunId?: string;
  visibility?: "immediate" | "deferred_final";
  normalizedFromToolCall?: boolean;
}

export interface MemoryRecall {
  recordId: string;
  content: string;
  score: number;
}

export interface SoulProfile {
  instruction: string;
  source: "workspace" | "channel";
}

export interface PromptAssemblySegment {
  id: string;
  source: "workspace" | "channel" | "soul" | "memory" | "tools" | "runtime";
  title: string;
  content: string;
  charCount: number;
}

export interface PromptAssemblyReport {
  id: string;
  workspaceId: string;
  channelId: string;
  createdAt: number;
  segments: PromptAssemblySegment[];
  contextFiles?: Array<{
    path: string;
    chars: number;
    truncated?: boolean;
  }>;
  truncationWarnings?: string[];
  totalChars: number;
  effectiveConfigRef?: string;
}

export interface InternalConfigDoc {
  name: string;
  path: string;
  updatedAt: number;
  contentMd: string;
}

export type AssetViewerRole = "developer" | "user";
export type AssetListScope = "workspace_shared" | "channel_session" | "cron" | "all";

export interface AssetDoc {
  name: string;
  path: string;
  updatedAt: number;
  contentMd: string;
}

export interface AssetTreeNode {
  type: "dir" | "file";
  name: string;
  path: string;
  children?: AssetTreeNode[];
}

export interface ChannelContext {
  channelId: string;
  contextType?: "main" | "shared";
  recentMessages: Message[];
  activePlan: PlanRun | null;
  memoryRecall: MemoryRecall[];
  resolvedModel?: ResolvedModel | null;
  resolvedSoul?: SoulProfile | null;
  promptReport?: PromptAssemblyReport | null;
  effectiveConfigRef?: string;
}

export interface ChatRequest {
  modelId: string;
  messages: Message[];
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ResolvedModel {
  tier?: ModelTier;
  providerId: string;
  modelId: string;
  displayName: string;
}

export interface ChatResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface EmbedRequest {
  modelId: string;
  input: string;
}

export interface AuthValidationResult {
  ok: boolean;
  reason?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  resourceUrl?: string;
}

export interface OAuthClientConfig {
  clientId: string;
  authEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
  redirectUri: string;
  apiBaseUrl?: string;
  extraAuthParams?: Record<string, string>;
}

export interface ProviderOAuthPreset {
  id: string;
  providerId: string;
  label: string;
  config: OAuthClientConfig;
}

export interface OAuthWizardSession {
  step: OAuthWizardStep;
  providerId?: string;
  minimaxRegion?: "global" | "cn";
  authMode?: AuthMode;
  parameterSource?: OAuthParamSource;
  flowMode?: "initial" | "update";
  byokKey?: string;
  configDraft?: OAuthClientConfig;
  pendingByokKey?: string;
  pendingTokens?: OAuthTokens;
  committed?: boolean;
  status?: string;
  error?: string;
  lastSuccessAt?: number;
}

export interface AppPreferences {
  themePreference: ThemePreference;
  notificationsEnabled?: boolean;
  notificationSoundEnabled?: boolean;
  notificationVibrationEnabled?: boolean;
  developerModeEnabled?: boolean;
  modelCatalog?: AppModelConfig[];
  channelModelMap?: Record<string, string>;
  providerApiBaseMap?: Record<string, string>;
  pendingCronApprovals?: CronApprovalRequest[];
  cronPermissionGrants?: CronPermissionGrant[];
  pendingPermissionRequests?: PermissionRequest[];
  permissionGrants?: PermissionGrant[];
}

export interface AppModelConfig {
  key: string;
  providerId: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
}

export interface SopCheckResult {
  id: string;
  title: string;
  status: "ok" | "warning" | "error";
  detail: string;
  actionId?: string;
}

export interface SopAction {
  id: string;
  label: string;
}

export type ToolName =
  | "cron.add"
  | "cron.update"
  | "cron.remove"
  | "cron.remove_all"
  | "cron.run"
  | "cron.status"
  | "cron.list"
  | "time.now"
  | "fs.read"
  | "fs.list"
  | "fs.write"
  | "exec.run";

export interface CapabilityDescriptor {
  tool: ToolName;
  enabled: boolean;
  requiresApproval: boolean;
  domain: "time" | "filesystem" | "cron" | "system";
}

export interface ToolPlanStep {
  tool: ToolName;
  reason: string;
}

export interface ReActRunState {
  runId: string;
  stage: "reason" | "plan" | "approve" | "act" | "done";
  stopReason?: "tool_calls" | "completed" | "aborted" | "guard_triggered" | "no_progress";
  toolTurns: number;
}

export interface ToolCallVerifierResult {
  validCalls: ToolCallRequest[];
  rejectedCalls: Array<{
    callId: string;
    tool: ToolName;
    reason: string;
  }>;
}

export interface SystemFlowGroup {
  flowRunId: string;
  messageIds: string[];
  collapsed: boolean;
  stage?: ReActRunState["stage"];
}

export interface ToolCallRequest {
  id: string;
  tool: ToolName;
  source: "assistant_structured" | "user_command";
  sessionId: string;
  agentId: string;
  payload: Record<string, unknown>;
  createdAt: number;
  sourceMessageId?: string;
}

export interface CronApprovalRequest {
  id: string;
  type: "add" | "update" | "remove" | "remove_all";
  sessionId: string;
  agentId: string;
  payload: Record<string, unknown>;
  source: "assistant_structured" | "user_command";
  sourceMessageId?: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: number;
  resolvedAt?: number;
}

export interface CronPermissionGrant {
  id: string;
  agentId: string;
  cronJobId: string;
  scope: "update";
  grantedAt: number;
}

export interface ToolLoopRunMeta {
  elapsedMs: number;
  toolTurns: number;
  loopGuardTriggered: boolean;
}

export interface ToolCallResult {
  callId: string;
  tool: ToolName;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ToolExecutionRecord {
  id: string;
  callId: string;
  tool: ToolName;
  status: "running" | "ok" | "error" | "blocked" | "aborted";
  summary: string;
  sessionId: string;
  agentId: string;
  createdAt: number;
  finishedAt?: number;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export type PermissionScope =
  | "model.call"
  | "tool.call"
  | "filesystem.read"
  | "filesystem.write"
  | "network.request"
  | "system.command"
  | "notification.send";

export type NotificationEventType =
  | "task_triggered"
  | "task_failed"
  | "task_retried"
  | "task_succeeded";

export interface NotificationEvent {
  id: string;
  type: NotificationEventType;
  title: string;
  body: string;
  ts: number;
  source: "in_app" | "system";
  relatedJobId?: string;
  relatedRunId?: string;
}

export interface PermissionGrant {
  id: string;
  scope: PermissionScope;
  granted: boolean;
  agentId?: string;
  workspaceId?: string;
  sessionId?: string;
  grantedBy?: string;
  grantedAt?: number;
  expiresAt?: number;
  note?: string;
}

export interface PermissionRequest {
  id: string;
  agentId: string;
  channelId?: string;
  scope: PermissionScope;
  action?: ToolName;
  payload?: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: number;
  resolvedAt?: number;
}

export interface AgentCapabilityPolicy {
  agentId: string;
  workspaceId?: string;
  channelId?: string;
  allow: PermissionScope[];
  deny?: PermissionScope[];
  requireApproval?: PermissionScope[];
}

export interface StoredCredential {
  id: string;
  providerId: string;
  authMode: AuthMode;
  apiKey?: string;
  oauth?: OAuthTokens;
  createdAt: number;
  updatedAt: number;
}

export interface GatewayAdapter {
  readonly provider: ModelProvider;
  listModels(): Promise<string[]>;
  chat(request: ChatRequest, session: ModelSession): Promise<ChatResponse>;
  stream?(request: ChatRequest, session: ModelSession): AsyncIterable<string>;
  embed(request: EmbedRequest, session: ModelSession): Promise<number[]>;
  validateAuth(session: ModelSession): Promise<AuthValidationResult>;
}

export interface CredentialStore {
  saveKey(providerId: string, key: string): Promise<string>;
  startOAuth(providerId: string, authCode: string): Promise<string>;
  saveOAuthTokens(providerId: string, tokens: OAuthTokens): Promise<string>;
  refreshToken(credentialRef: string): Promise<void>;
  revoke(credentialRef: string): Promise<void>;
  get(credentialRef: string): Promise<StoredCredential | null>;
}

export interface PlanExecutor {
  execute(step: PlanStep, context: ChannelContext): Promise<unknown>;
}

export interface ModelRecommendation {
  id: string;
  label: string;
  description: string;
  tierMapping: TierMapping;
}

export type WorkspaceEditableFile =
  | "workspace/AGENTS.md"
  | "workspace/SOUL.md"
  | "workspace/TOOLS.md"
  | "workspace/IDENTITY.md"
  | "workspace/USER.md"
  | "workspace/HEARTBEAT.md"
  | "workspace/MEMORY.md"
  | "workspace/BOOTSTRAP.md";

export type WorkspaceEditMode = "append" | "replace";

export interface WorkspaceEditRequest {
  channelId: string;
  text: string;
  actorRole: "user" | "developer";
  confirmed?: boolean;
}

export interface WorkspaceEditResult {
  handled: boolean;
  requiresConfirmation?: boolean;
  targetPath?: WorkspaceEditableFile;
  mode?: WorkspaceEditMode;
  summary?: string;
  blockedReason?: string;
}
