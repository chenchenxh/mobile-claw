import type {
  AuthValidationResult,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  GatewayAdapter,
  ModelProvider,
  ModelSession
} from "../../types/contracts.ts";
import type { InMemoryCredentialStore } from "../credentials/in-memory-credential-store.ts";

export interface MockAdapterOptions {
  provider: ModelProvider;
  models: string[];
  failOnceOnChat?: boolean;
}

export class BaseMockAdapter implements GatewayAdapter {
  readonly provider: ModelProvider;
  private readonly models: string[];
  private readonly credentials: InMemoryCredentialStore;
  private failOnceOnChat: boolean;

  constructor(options: MockAdapterOptions, credentials: InMemoryCredentialStore) {
    this.provider = options.provider;
    this.models = options.models;
    this.credentials = credentials;
    this.failOnceOnChat = Boolean(options.failOnceOnChat);
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }

  async chat(request: ChatRequest, session: ModelSession): Promise<ChatResponse> {
    await this.ensureCredential(session);
    if (this.failOnceOnChat) {
      this.failOnceOnChat = false;
      throw new Error(`${this.provider.id}: simulated transient failure`);
    }
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    return {
      text: `[${this.provider.id}/${session.modelId}] ${lastUser?.content ?? ""}`.trim(),
      usage: {
        promptTokens: request.messages.length * 12,
        completionTokens: 16
      }
    };
  }

  async *stream(request: ChatRequest, session: ModelSession): AsyncIterable<string> {
    const full = await this.chat(request, session);
    for (const token of full.text.split(" ")) {
      yield token;
    }
  }

  async embed(request: EmbedRequest, session: ModelSession): Promise<number[]> {
    await this.ensureCredential(session);
    const vector = new Array(16).fill(0);
    for (let i = 0; i < request.input.length; i += 1) {
      vector[i % vector.length] += request.input.charCodeAt(i);
    }
    const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0)) || 1;
    return vector.map((x) => x / norm);
  }

  async validateAuth(session: ModelSession): Promise<AuthValidationResult> {
    const credential = await this.credentials.get(session.credentialRef);
    if (!credential) return { ok: false, reason: "credential_not_found" };
    if (credential.providerId !== session.providerId) return { ok: false, reason: "provider_mismatch" };
    if (credential.authMode === "BYOK" && !credential.apiKey) return { ok: false, reason: "empty_key" };
    if (credential.authMode === "OAUTH" && !credential.oauth?.accessToken) return { ok: false, reason: "empty_oauth_access_token" };
    return { ok: true };
  }

  private async ensureCredential(session: ModelSession): Promise<void> {
    const result = await this.validateAuth(session);
    if (!result.ok) throw new Error(`${this.provider.id}: auth invalid - ${result.reason}`);
  }
}
