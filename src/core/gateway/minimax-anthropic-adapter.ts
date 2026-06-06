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

interface AnthropicMessageResponse {
  content?: Array<{ type?: string; text?: string } | string>;
  text?: string;
  output_text?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; type?: string };
}

export class MiniMaxAnthropicAdapter implements GatewayAdapter {
  readonly provider: ModelProvider;
  private readonly credentials: InMemoryCredentialStore;
  private readonly defaultBaseUrl: string;

  constructor(
    provider: ModelProvider,
    credentials: InMemoryCredentialStore,
    defaultBaseUrl = "https://api.minimax.io/anthropic"
  ) {
    this.provider = provider;
    this.credentials = credentials;
    this.defaultBaseUrl = defaultBaseUrl;
  }

  async listModels(): Promise<string[]> {
    return ["MiniMax-M2.5", "MiniMax-M2.7"];
  }

  async chat(request: ChatRequest, session: ModelSession): Promise<ChatResponse> {
    const { token, resourceUrl, authMode } = await this.getAccess(session);
    const baseUrl = this.resolveBaseUrl(session.apiBaseUrl, resourceUrl);
    const region = /minimaxi\.com/i.test(baseUrl) ? "cn" : "global";
    appLogger.info({
      module: "gateway.minimax",
      event: "request",
      message: "发送 MiniMax 请求",
      context: {
        providerId: session.providerId,
        modelId: session.modelId,
        baseUrl,
        region,
        authMode
      }
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01"
    };
    // OpenClaw behavior: OAuth token走 Authorization，BYOK 附带 x-api-key 兼容部分网关。
    if (authMode === "BYOK") headers["x-api-key"] = token;
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      signal: request.signal,
      headers,
      body: JSON.stringify({
        model: session.modelId,
        max_tokens: 2048,
        messages: request.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role,
            content: m.content
          })),
        system: request.systemPrompt
      })
    });

    if (!res.ok) {
      const text = await res.text();
      let detail = text.slice(0, 280).replace(/\s+/g, " ").trim();
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string; type?: string } };
        if (parsed?.error?.message || parsed?.error?.type) {
          detail = `${parsed.error.type ?? "error"} ${parsed.error.message ?? ""}`.trim();
        }
      } catch {
        // noop
      }
      const classification =
        res.status === 401 || /authentication_error|unauthorized/i.test(detail)
          ? "auth"
          : res.status === 404 || /model/i.test(detail)
            ? "model"
            : "network";
      appLogger.error({
        module: "gateway.minimax",
        event: "response_error",
        message: "MiniMax 请求失败",
        context: {
          providerId: session.providerId,
          modelId: session.modelId,
          baseUrl,
          region,
          authMode,
          status: res.status,
          classification
        },
        error: detail
      });
      if (classification === "auth" && authMode === "BYOK") {
        appLogger.warn({
          module: "gateway.minimax",
          event: "minimax_region_mismatch_suspected",
          message: "MiniMax 鉴权失败，怀疑区域与 key 不匹配",
          context: { providerId: session.providerId, modelId: session.modelId, baseUrl, region, status: res.status }
        });
      }
      throw new Error(
        `chat request failed: ${res.status} (provider=${session.providerId}, baseUrl=${baseUrl}, model=${session.modelId}) ${detail}`
      );
    }

    const json = (await res.json()) as AnthropicMessageResponse;
    const extracted = this.extractText(json);
    if (!extracted.text.trim()) {
      appLogger.warn({
        module: "gateway.minimax",
        event: "empty_response",
        message: "MiniMax 返回 200 但未提取到可展示文本",
        context: {
          modelId: session.modelId,
          baseUrl,
          responseParseMode: extracted.mode
        }
      });
      throw new Error(
        `empty_response: model returned no displayable text (provider=${session.providerId}, baseUrl=${baseUrl}, model=${session.modelId})`
      );
    }
    appLogger.info({
      module: "gateway.minimax",
      event: "response_ok",
      message: "MiniMax 响应成功",
      context: { modelId: session.modelId, baseUrl, responseParseMode: extracted.mode }
    });
    return {
      text: extracted.text,
      usage: {
        promptTokens: json.usage?.input_tokens ?? 0,
        completionTokens: json.usage?.output_tokens ?? 0
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
    const token = credential.authMode === "BYOK" ? credential.apiKey : credential.oauth?.accessToken;
    if (!token) return { ok: false, reason: "missing_access_token" };
    return { ok: true };
  }

  private async getAccess(session: ModelSession): Promise<{ token: string; resourceUrl?: string; authMode: "BYOK" | "OAUTH" }> {
    const credential = await this.credentials.get(session.credentialRef);
    if (!credential) throw new Error("credential not found");
    if (credential.authMode === "BYOK") {
      if (!credential.apiKey) throw new Error("access token missing");
      return { token: credential.apiKey, authMode: "BYOK" };
    }
    if (!credential.oauth?.accessToken) throw new Error("access token missing");
    return { token: credential.oauth.accessToken, resourceUrl: credential.oauth.resourceUrl, authMode: "OAUTH" };
  }

  private resolveBaseUrl(sessionBase?: string, resourceUrl?: string): string {
    const raw = (resourceUrl?.trim() || sessionBase?.trim() || this.defaultBaseUrl).replace(/\/+$/, "");
    if (raw.endsWith("/anthropic")) return raw;
    if (raw.endsWith("/v1")) return raw.replace(/\/v1$/, "/anthropic");
    return `${raw}/anthropic`;
  }

  private extractText(response: AnthropicMessageResponse): { text: string; mode: "content_text" | "text_field" | "output_text" | "openai_choice" | "unknown" } {
    if (Array.isArray(response.content)) {
      const contentText = response.content
        .map((entry) => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry.text === "string") return entry.text;
          return "";
        })
        .join("")
        .trim();
      if (contentText) return { text: contentText, mode: "content_text" };
    }

    if (typeof response.text === "string" && response.text.trim()) {
      return { text: response.text.trim(), mode: "text_field" };
    }
    if (typeof response.output_text === "string" && response.output_text.trim()) {
      return { text: response.output_text.trim(), mode: "output_text" };
    }
    const choiceText = response.choices?.[0]?.message?.content;
    if (typeof choiceText === "string" && choiceText.trim()) {
      return { text: choiceText.trim(), mode: "openai_choice" };
    }
    return { text: "", mode: "unknown" };
  }
}
