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
import { appLogger } from "../observability/app-logger.ts";

interface OpenAIChatChoice {
  message?: { content?: string };
}

interface OpenAIChatResponse {
  choices?: OpenAIChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAIEmbedResponse {
  data?: Array<{ embedding?: number[] }>;
}

export class OpenAICompatibleAdapter implements GatewayAdapter {
  readonly provider: ModelProvider;
  private readonly credentials: InMemoryCredentialStore;
  private readonly baseUrl: string;

  constructor(
    provider: ModelProvider,
    credentials: InMemoryCredentialStore,
    baseUrl = "https://api.openai.com/v1"
  ) {
    this.provider = provider;
    this.credentials = credentials;
    this.baseUrl = baseUrl;
  }

  async listModels(): Promise<string[]> {
    return ["gpt-4o-mini", "gpt-4.1-mini"];
  }

  async chat(request: ChatRequest, session: ModelSession): Promise<ChatResponse> {
    const key = await this.getAccessToken(session);
    const targetBase = (session.apiBaseUrl?.trim() || this.baseUrl).replace(/\/+$/, "");
    appLogger.info({
      module: "gateway.openai",
      event: "request",
      message: "发送 OpenAI 兼容请求",
      context: { providerId: session.providerId, modelId: session.modelId, baseUrl: targetBase }
    });
    const res = await fetch(`${targetBase}/chat/completions`, {
      method: "POST",
      signal: request.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: session.modelId,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });
    if (!res.ok) {
      const text = await res.text();
      const detail = text.slice(0, 280).replace(/\s+/g, " ").trim();
      appLogger.error({
        module: "gateway.openai",
        event: "response_error",
        message: "OpenAI 兼容请求失败",
        context: { providerId: session.providerId, modelId: session.modelId, baseUrl: targetBase, status: res.status },
        error: detail
      });
      throw new Error(
        `chat request failed: ${res.status} (provider=${session.providerId}, baseUrl=${targetBase}, model=${session.modelId}) ${detail}`
      );
    }
    const json = (await res.json()) as OpenAIChatResponse;
    appLogger.info({
      module: "gateway.openai",
      event: "response_ok",
      message: "OpenAI 兼容响应成功",
      context: { providerId: session.providerId, modelId: session.modelId, baseUrl: targetBase }
    });
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0
      }
    };
  }

  async *stream(request: ChatRequest, session: ModelSession): AsyncIterable<string> {
    const response = await this.chat(request, session);
    for (const token of response.text.split(" ")) yield token;
  }

  async embed(request: EmbedRequest, session: ModelSession): Promise<number[]> {
    const key = await this.getAccessToken(session);
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: request.input
      })
    });
    if (!res.ok) throw new Error(`embed request failed: ${res.status}`);
    const json = (await res.json()) as OpenAIEmbedResponse;
    return json.data?.[0]?.embedding ?? [];
  }

  async validateAuth(session: ModelSession): Promise<AuthValidationResult> {
    const credential = await this.credentials.get(session.credentialRef);
    if (!credential || credential.providerId !== session.providerId) {
      return { ok: false, reason: "credential_not_found" };
    }
    const token = credential.authMode === "BYOK" ? credential.apiKey : credential.oauth?.accessToken;
    if (!token) return { ok: false, reason: "missing_access_token" };
    return { ok: true };
  }

  private async getAccessToken(session: ModelSession): Promise<string> {
    const credential = await this.credentials.get(session.credentialRef);
    if (!credential) throw new Error("credential not found");
    const token = credential.authMode === "BYOK" ? credential.apiKey : credential.oauth?.accessToken;
    if (!token) throw new Error("access token missing");
    return token;
  }
}
