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

interface DeepSeekChatChoice {
  message?: { content?: string };
}

interface DeepSeekChatResponse {
  choices?: DeepSeekChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export class DeepSeekCompatibleAdapter implements GatewayAdapter {
  readonly provider: ModelProvider;
  private readonly credentials: InMemoryCredentialStore;
  private readonly baseUrl: string;

  constructor(
    provider: ModelProvider,
    credentials: InMemoryCredentialStore,
    baseUrl = "https://api.deepseek.com"
  ) {
    this.provider = provider;
    this.credentials = credentials;
    this.baseUrl = baseUrl;
  }

  async listModels(): Promise<string[]> {
    return ["deepseek-v4-flash", "deepseek-v4-pro"];
  }

  async chat(request: ChatRequest, session: ModelSession): Promise<ChatResponse> {
    const key = await this.getAccessToken(session);
    const targetBase = (session.apiBaseUrl?.trim() || this.baseUrl).replace(/\/+$/, "");
    const url = `${targetBase}/chat/completions`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    };
    const body = {
      model: session.modelId,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      reasoning_effort: "low"
    };
    appLogger.info({
      module: "gateway.deepseek",
      event: "request",
      message: "发送 DeepSeek 请求",
      context: {
        providerId: session.providerId,
        modelId: session.modelId,
        baseUrl: targetBase,
        rawRequest: {
          method: "POST",
          url,
          headers,
          body
        }
      }
    });
    const res = await fetch(url, {
      method: "POST",
      signal: request.signal,
      headers,
      body: JSON.stringify(body)
    });
    const text = await res.text();
    const responseHeaders = headersToRecord(res.headers);
    if (!res.ok) {
      const detail = text.replace(/\s+/g, " ").trim();
      appLogger.error({
        module: "gateway.deepseek",
        event: "response_error",
        message: "DeepSeek 请求失败",
        context: {
          providerId: session.providerId,
          modelId: session.modelId,
          baseUrl: targetBase,
          status: res.status,
          rawRequest: {
            method: "POST",
            url,
            headers,
            body
          },
          rawResponse: {
            status: res.status,
            statusText: res.statusText,
            headers: responseHeaders,
            bodyText: text
          }
        },
        error: detail
      });
      throw new Error(
        `chat request failed: ${res.status} (provider=${session.providerId}, baseUrl=${targetBase}, model=${session.modelId}) ${detail}`
      );
    }
    const json = JSON.parse(text) as DeepSeekChatResponse;
    appLogger.info({
      module: "gateway.deepseek",
      event: "response_ok",
      message: "DeepSeek 响应成功",
      context: {
        providerId: session.providerId,
        modelId: session.modelId,
        baseUrl: targetBase,
        status: res.status,
        rawRequest: {
          method: "POST",
          url,
          headers,
          body
        },
        rawResponse: {
          status: res.status,
          statusText: res.statusText,
          headers: responseHeaders,
          body: json,
          bodyText: text
        }
      }
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

  async embed(_request: EmbedRequest, _session: ModelSession): Promise<number[]> {
    return [];
  }

  async validateAuth(session: ModelSession): Promise<AuthValidationResult> {
    const credential = await this.credentials.get(session.credentialRef);
    if (!credential || credential.providerId !== session.providerId) {
      return { ok: false, reason: "credential_not_found" };
    }
    if (credential.authMode !== "BYOK") return { ok: false, reason: "unsupported_auth_mode" };
    if (!credential.apiKey) return { ok: false, reason: "missing_access_token" };
    return { ok: true };
  }

  private async getAccessToken(session: ModelSession): Promise<string> {
    const credential = await this.credentials.get(session.credentialRef);
    if (!credential) throw new Error("credential not found");
    if (credential.authMode !== "BYOK") throw new Error("unsupported auth mode: DeepSeek only supports API Key");
    if (!credential.apiKey) throw new Error("access token missing");
    return credential.apiKey;
  }
}
