import type { ChatRequest, ChatResponse, GatewayAdapter, ModelSession } from "../../types/contracts.ts";

export interface RoutedSession {
  primary: ModelSession;
  fallback?: ModelSession;
}

export class GatewayRouter {
  private readonly adapters = new Map<string, GatewayAdapter>();

  registerAdapter(adapter: GatewayAdapter): void {
    this.adapters.set(adapter.provider.id, adapter);
  }

  async listModels(providerId: string): Promise<string[]> {
    const adapter = this.mustAdapter(providerId);
    return adapter.listModels();
  }

  async chatWithFallback(request: ChatRequest, session: RoutedSession): Promise<ChatResponse> {
    const primary = this.mustAdapter(session.primary.providerId);
    try {
      return await primary.chat(request, session.primary);
    } catch (err) {
      if (!session.fallback) throw err;
      const fallback = this.mustAdapter(session.fallback.providerId);
      return fallback.chat(request, session.fallback);
    }
  }

  async validateSession(session: ModelSession): Promise<boolean> {
    const adapter = this.mustAdapter(session.providerId);
    const result = await adapter.validateAuth(session);
    return result.ok;
  }

  private mustAdapter(providerId: string): GatewayAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new Error(`adapter for provider ${providerId} not found`);
    return adapter;
  }
}
