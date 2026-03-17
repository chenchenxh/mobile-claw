import { PlanEngine } from "../core/agent/plan-engine.ts";
import { ChannelService } from "../core/channel/channel-service.ts";
import { InMemoryCredentialStore } from "../core/credentials/in-memory-credential-store.ts";
import { BaseMockAdapter } from "../core/gateway/base-mock-adapter.ts";
import { GatewayRouter } from "../core/gateway/gateway-router.ts";
import { extractMemory } from "../core/memory/memory-extractor.ts";
import { LocalMemoryStore } from "../core/memory/local-memory-store.ts";
import type { ChannelContext, ChatResponse, Message, ModelProvider, ModelSession, PlanRun, PlanStep, WorkspaceConfig } from "../types/contracts.ts";

export interface SendMessageOptions {
  channelId: string;
  text: string;
  primary: ModelSession;
  fallback?: ModelSession;
}

export class MobileClawKernel {
  readonly channels = new ChannelService();
  readonly memory = new LocalMemoryStore();
  readonly credentials = new InMemoryCredentialStore();
  readonly gateway = new GatewayRouter();
  readonly planner = new PlanEngine();

  constructor(providers: ModelProvider[]) {
    for (const provider of providers) {
      this.gateway.registerAdapter(
        new BaseMockAdapter(
          {
            provider,
            models: ["small", "large"],
            failOnceOnChat: false
          },
          this.credentials
        )
      );
    }
  }

  addWorkspace(config: WorkspaceConfig): void {
    this.channels.upsertWorkspace(config);
  }

  createChannel(workspaceId: string, name: string): string {
    return this.channels.createChannel(workspaceId, name).id;
  }

  async sendMessage(options: SendMessageOptions): Promise<ChatResponse> {
    const userMessage = this.channels.appendMessage(options.channelId, "user", options.text);
    this.persistMemories(options.channelId, userMessage.content);
    const recalled = this.memory.recall(options.channelId, options.text, 3);
    const promptRecall = recalled.map((r) => `memory(${r.type}): ${r.content}`).join("\n");
    if (promptRecall) {
      this.channels.appendMessage(options.channelId, "system", `Recalled memories:\n${promptRecall}`);
    }
    const messages = this.channels.getRecentMessages(options.channelId, 30);
    const channel = this.channels.getChannel(options.channelId);
    const response = await this.gateway.chatWithFallback(
      {
        modelId: options.primary.modelId,
        messages,
        systemPrompt: channel.systemPrompt
      },
      { primary: options.primary, fallback: options.fallback }
    );
    this.channels.appendMessage(options.channelId, "assistant", response.text);
    return response;
  }

  createPlan(steps: Omit<PlanStep, "id" | "status">[]): PlanRun {
    return this.planner.createPlan(steps);
  }

  async runPlan(channelId: string): Promise<PlanRun> {
    const context = this.getChannelContext(channelId);
    return this.planner.run(context, {
      execute: async (step, ctx) => {
        if (step.tool === "chat.summarize") {
          const last = ctx.recentMessages.slice(-5).map((m) => m.content).join(" | ");
          return `summary:${last.slice(0, 160)}`;
        }
        if (step.tool === "memory.write") {
          const type = String(step.input.type ?? "fact") as "preference" | "fact" | "goal";
          const content = String(step.input.content ?? "");
          this.memory.write(ctx.channelId, type, content);
          return { stored: true };
        }
        return { ok: true };
      }
    });
  }

  getChannelContext(channelId: string): ChannelContext {
    const recentMessages = this.channels.getRecentMessages(channelId, 40);
    const activePlan = this.planner.getActivePlan();
    const lastUser = [...recentMessages].reverse().find((m) => m.role === "user");
    const memoryRecall = lastUser
      ? this.memory.recall(channelId, lastUser.content, 5).map((r) => ({ recordId: r.id, content: r.content, score: 1 }))
      : [];
    return {
      channelId,
      recentMessages,
      activePlan,
      memoryRecall
    };
  }

  getMessages(channelId: string): Message[] {
    return this.channels.getRecentMessages(channelId, 100);
  }

  private persistMemories(channelId: string, userText: string): void {
    const extracted = extractMemory(userText);
    for (const item of extracted) this.memory.write(channelId, item.type, item.content);
  }
}
