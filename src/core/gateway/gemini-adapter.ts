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

interface GeminiCandidate {
  content?: {
    parts?: Array<{ text?: string }>;
  };
}

interface GeminiGenerateResponse {
  candidates?: GeminiCandidate[];
}

interface GeminiEmbedResponse {
  embedding?: {
    values?: number[];
  };
}

export class GeminiAdapter implements GatewayAdapter {
  readonly provider: ModelProvider;
  private readonly credentials: InMemoryCredentialStore;
  private readonly baseUrl: string;

  constructor(
    provider: ModelProvider,
    credentials: InMemoryCredentialStore,
    baseUrl = "https://generativelanguage.googleapis.com/v1beta"
  ) {
    this.provider = provider;
    this.credentials = credentials;
    this.baseUrl = baseUrl;
  }

  async listModels(): Promise<string[]> {
    return ["gemini-2.5-flash", "gemini-2.5-pro"];
  }

  async chat(request: ChatRequest, session: ModelSession): Promise<ChatResponse> {
    const key = await this.getAccessToken(session);
    const input = request.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const url = `${this.baseUrl}/models/${encodeURIComponent(session.modelId)}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: input }]
          }
        ]
      })
    });
    if (!res.ok) throw new Error(`chat request failed: ${res.status}`);
    const json = (await res.json()) as GeminiGenerateResponse;
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return { text };
  }

  async *stream(request: ChatRequest, session: ModelSession): AsyncIterable<string> {
    const response = await this.chat(request, session);
    for (const token of response.text.split(" ")) yield token;
  }

  async embed(request: EmbedRequest, session: ModelSession): Promise<number[]> {
    const key = await this.getAccessToken(session);
    const url = `${this.baseUrl}/models/text-embedding-004:embedContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: {
          role: "user",
          parts: [{ text: request.input }]
        }
      })
    });
    if (!res.ok) throw new Error(`embed request failed: ${res.status}`);
    const json = (await res.json()) as GeminiEmbedResponse;
    return json.embedding?.values ?? [];
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
