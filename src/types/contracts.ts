export type AuthMode = "BYOK" | "OAUTH";
export type ProviderType = "openai" | "google" | "anthropic" | "custom";
export type MemoryPolicy = "LOCAL_ONLY";
export type MemoryRecordType = "preference" | "fact" | "goal";
export type PlanStatus = "idle" | "running" | "paused" | "completed" | "failed" | "terminated";
export type PlanStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface WorkspaceConfig {
  id: string;
  name: string;
  defaultModel: string;
  systemPrompt: string;
  memoryPolicy: MemoryPolicy;
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
  capabilities: ProviderCapabilities;
}

export interface ModelSession {
  providerId: string;
  modelId: string;
  credentialRef: string;
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
}

export interface MemoryRecall {
  recordId: string;
  content: string;
  score: number;
}

export interface ChannelContext {
  channelId: string;
  recentMessages: Message[];
  activePlan: PlanRun | null;
  memoryRecall: MemoryRecall[];
}

export interface ChatRequest {
  modelId: string;
  messages: Message[];
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
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
  refreshToken(credentialRef: string): Promise<void>;
  revoke(credentialRef: string): Promise<void>;
  get(credentialRef: string): Promise<StoredCredential | null>;
}

export interface PlanExecutor {
  execute(step: PlanStep, context: ChannelContext): Promise<unknown>;
}
