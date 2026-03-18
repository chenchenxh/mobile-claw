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
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: session.modelId,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });
    if (!res.ok) throw new Error(`chat request failed: ${res.status}`);
    const json = (await res.json()) as OpenAIChatResponse;
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
