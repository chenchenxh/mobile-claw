import { PlanEngine } from "../core/agent/plan-engine.ts";
import { MessageBus } from "../core/bus/message-bus.ts";
import { InAppChannelPlugin } from "../core/channel/plugins/in-app-channel.ts";
import { ChannelRegistry } from "../core/channel/registry.ts";
import { ChannelService } from "../core/channel/channel-service.ts";
import { InMemoryCredentialStore } from "../core/credentials/in-memory-credential-store.ts";
import { CronService } from "../core/cron/service.ts";
import type { CronExecutionRecord, CronJob, CronPayload, CronSchedule } from "../core/cron/types.ts";
import { BaseMockAdapter } from "../core/gateway/base-mock-adapter.ts";
import { GatewayRouter } from "../core/gateway/gateway-router.ts";
import { MODEL_RECOMMENDATIONS } from "../core/gateway/model-recommendations.ts";
import { extractMemory } from "../core/memory/memory-extractor.ts";
import { LocalMemoryStore } from "../core/memory/local-memory-store.ts";
import { uid } from "../core/utils/id.ts";
import { WORKSPACE_DEFAULT_TEMPLATES } from "../core/agent/workspace-default-templates.ts";
import type { RuntimeTimeContext } from "../core/runtime/time-service.ts";
import type {
  AssetDoc,
  AssetListScope,
  AssetTreeNode,
  AssetViewerRole,
  ChannelContext,
  ChatResponse,
  GatewayAdapter,
  Message,
  ModelProvider,
  ModelRecommendation,
  ModelSession,
  ModelTier,
  OAuthClientConfig,
  OAuthTokens,
  PlanRun,
  PlanStep,
  PromptAssemblyReport,
  PromptAssemblySegment,
  ResolvedModel,
  SoulProfile,
  TierMapping,
  WorkspaceConfig,
  WorkspaceEditMode,
  WorkspaceEditableFile,
  WorkspaceEditRequest,
  WorkspaceEditResult
} from "../types/contracts.ts";
import type { PersistedAppState } from "../core/persistence/file-state-store.ts";
import { appLogger } from "../core/observability/app-logger.ts";

export interface SendMessageOptions {
  channelId: string;
  text: string;
  sourceType?: Message["sourceType"];
  primary?: ModelSession;
  tier?: ModelTier;
  fallback?: ModelSession;
  signal?: AbortSignal;
  runtimeTime?: RuntimeTimeContext;
  deferAssistant?: boolean;
}

export class MobileClawKernel {
  readonly bus = new MessageBus();
  readonly channelRegistry = new ChannelRegistry();
  readonly cron: CronService;
  readonly channels = new ChannelService();
  readonly memory = new LocalMemoryStore();
  readonly credentials = new InMemoryCredentialStore();
  readonly gateway = new GatewayRouter();
  readonly planner = new PlanEngine();
  private foregroundSchedulerReady = false;
  private cronSessionModelResolver?: (channelId: string) => ModelSession | null;
  private readonly providerCredentialRefs = new Map<string, string>();
  private readonly oauthClientConfigs = new Map<string, OAuthClientConfig>();
  private readonly workspaceSoulMap = new Map<string, string>();
  private readonly channelSoulMap = new Map<string, string>();
  private readonly promptReportsByChannel = new Map<string, PromptAssemblyReport>();
  private readonly assetDocs = new Map<string, AssetDoc>();
  private readonly pendingWorkspaceEdits = new Map<string, { path: WorkspaceEditableFile; mode: WorkspaceEditMode; content: string; summary: string }>();
  private readonly persistence?: {
    load(): Promise<PersistedAppState | null>;
    save(state: PersistedAppState): Promise<void>;
  };

  constructor(
    providers: ModelProvider[],
    options?: {
      persistence?: {
        load(): Promise<PersistedAppState | null>;
        save(state: PersistedAppState): Promise<void>;
      };
    }
  ) {
    this.persistence = options?.persistence;
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

    this.channelRegistry.register(new InAppChannelPlugin());
    this.channelRegistry.attachBus(this.bus);
    void this.channelRegistry.startAll();

    this.cron = new CronService({
      canRunExactForeground: () => this.foregroundSchedulerReady,
      onJob: async (job) => {
        const payloadText = job.payload.kind === "agentTurn" ? job.payload.message : job.payload.text;
        const payloadTier = job.payload.kind === "systemEvent" ? job.payload.tier : "small";
        appLogger.info({
          module: "cron",
          event: "task_triggered",
          message: "Cron 任务触发",
          context: {
            jobId: job.id,
            name: job.name,
            channelId: job.payload.channelId,
            sessionTarget: job.sessionTarget,
            timingClass: job.timingClass
          }
        });
        try {
          if (job.payload.kind === "agentTurn") {
            const currentSessionModel = this.cronSessionModelResolver?.(job.payload.channelId) ?? null;
            if (!currentSessionModel?.providerId || !currentSessionModel?.modelId || !currentSessionModel?.credentialRef) {
              throw new Error(`session model not configured for channel ${job.payload.channelId}`);
            }
            await this.sendMessage({
              channelId: job.payload.channelId,
              text: payloadText,
              sourceType: "cron_auto",
              primary: currentSessionModel
            });
          } else {
            await this.sendMessage({
              channelId: job.payload.channelId,
              text: payloadText,
              tier: payloadTier ?? "small"
            });
          }
          appLogger.info({
            module: "cron",
            event: "task_succeeded",
            message: "Cron 任务执行成功",
            context: { jobId: job.id, name: job.name, channelId: job.payload.channelId }
          });
          if (job.schedule.kind === "at") {
            const stillExists = this.cron.listJobs(true).some((item) => item.id === job.id);
            if (stillExists) {
              const removed = this.cron.removeJob(job.id);
              if (removed) {
                this.refreshCronAssetDocs();
                await this.persistNow();
                appLogger.warn({
                  module: "cron",
                  event: "cron_delete_compensated",
                  message: "一次性 Cron 触发后执行补偿删除",
                  context: { jobId: job.id, channelId: job.payload.channelId }
                });
              }
            }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          appLogger.error({
            module: "cron",
            event: "task_failed",
            message: "Cron 任务执行失败",
            context: { jobId: job.id, name: job.name, channelId: job.payload.channelId },
            error: reason
          });
          throw error;
        }
      }
    });
    this.cron.start();
  }

  registerProviderAdapter(adapter: GatewayAdapter): void {
    this.gateway.registerAdapter(adapter);
  }

  addWorkspace(config: WorkspaceConfig): void {
    const workspace = this.withWorkspaceDefaults(config);
    this.channels.upsertWorkspace(workspace);
    this.ensureWorkspaceAssetBaseline(workspace);
    void this.persistNow();
  }

  ensureWorkspaceAndDefaultChannel(config: WorkspaceConfig, defaultChannelName = "General"): string {
    const workspace = this.withWorkspaceDefaults(config);
    this.channels.upsertWorkspace(workspace);
    this.ensureWorkspaceAssetBaseline(workspace);
    const channels = this.channels.listChannels(config.id);
    const channelId = channels[0]?.id ?? this.channels.createChannel(config.id, defaultChannelName, { contextType: "main" }).id;
    this.ensureWorkspaceMainChannelContextType();
    this.refreshAgentAssets(channelId);
    void this.persistNow();
    return channelId;
  }

  createChannel(workspaceId: string, name: string): string {
    const id = this.channels.createChannel(workspaceId, name, { contextType: "shared" }).id;
    this.ensureWorkspaceMainChannelContextType();
    this.refreshAgentAssets(id);
    void this.persistNow();
    return id;
  }

  renameChannel(channelId: string, name: string): boolean {
    const next = name.trim();
    if (!next) return false;
    const renamed = this.channels.renameChannel(channelId, next);
    if (!renamed) return false;
    void this.persistNow();
    return true;
  }

  deleteChannel(channelId: string): boolean {
    const removedChannel = this.channels.removeChannel(channelId);
    if (!removedChannel) return false;
    this.memory.removeChannel(channelId);
    const relatedJobIds = this.cron
      .listJobs(true)
      .filter((job) => job.payload.channelId === channelId)
      .map((job) => job.id);
    if (relatedJobIds.length) {
      this.cron.removeJobs(relatedJobIds);
    }
    this.ensureWorkspaceMainChannelContextType();
    this.refreshCronAssetDocs();
    void this.persistNow();
    return true;
  }

  addCronJob(input: {
    name: string;
    schedule: CronSchedule;
    payload: CronPayload | { channelId: string; text: string; tier?: ModelTier };
    enabled?: boolean;
    deleteAfterRun?: boolean;
    sessionTarget?: CronJob["sessionTarget"];
    wakeMode?: CronJob["wakeMode"];
    delivery?: CronJob["delivery"];
    timingClass?: CronJob["timingClass"];
    runModelStrategy?: CronJob["runModelStrategy"];
  }): CronJob {
    const job = this.cron.addJob(input);
    this.refreshCronAssetDocs();
    void this.persistNow();
    return job;
  }

  addCronJobByAgent(input: {
    agentId: string;
    name: string;
    schedule: CronSchedule;
    payload: CronPayload | { channelId: string; text: string; tier?: ModelTier };
    enabled?: boolean;
    deleteAfterRun?: boolean;
    idempotencyKey?: string;
    sessionTarget?: CronJob["sessionTarget"];
    wakeMode?: CronJob["wakeMode"];
    delivery?: CronJob["delivery"];
    timingClass?: CronJob["timingClass"];
    runModelStrategy?: CronJob["runModelStrategy"];
  }): CronJob {
    const normalizedKey = input.idempotencyKey?.trim();
    if (normalizedKey) {
      const duplicated = this.cron
        .listJobs(true)
        .find((job) => job.idempotencyKey === normalizedKey && job.createdByAgentId === input.agentId);
      if (duplicated) return duplicated;
    }
    const job = this.cron.addJob({
      name: input.name,
      schedule: input.schedule,
      payload: input.payload,
      enabled: input.enabled,
      deleteAfterRun: input.deleteAfterRun,
      createdByAgentId: input.agentId,
      idempotencyKey: normalizedKey,
      sessionTarget: input.sessionTarget,
      wakeMode: input.wakeMode,
      delivery: input.delivery,
      timingClass: input.timingClass,
      runModelStrategy: input.runModelStrategy
    });
    this.refreshCronAssetDocs();
    void this.persistNow();
    return job;
  }

  updateCronJobByAgent(
    jobId: string,
    patch: Partial<{
      name: string;
      schedule: CronSchedule;
      payload: CronPayload | { channelId: string; text: string; tier?: ModelTier };
      enabled: boolean;
      deleteAfterRun: boolean;
      idempotencyKey: string;
      sessionTarget: CronJob["sessionTarget"];
      wakeMode: CronJob["wakeMode"];
      delivery: CronJob["delivery"];
      timingClass: CronJob["timingClass"];
      runModelStrategy: CronJob["runModelStrategy"];
    }>
  ): CronJob | null {
    const updated = this.cron.updateJob(jobId, patch);
    if (updated) {
      this.refreshCronAssetDocs();
      void this.persistNow();
    }
    return updated;
  }

  removeCronJobByAgent(jobId: string): boolean {
    return this.removeCronJob(jobId);
  }

  removeAllCronJobsByAgent(jobIds?: string[]): { removed: number; removedIds: string[] } {
    const ids = jobIds?.length ? jobIds : this.cron.listJobs(true).map((job) => job.id);
    const result = this.cron.removeJobs(ids);
    if (result.removed > 0) {
      this.refreshCronAssetDocs();
      void this.persistNow();
    }
    return result;
  }

  listCronJobs(includeDisabled = true): CronJob[] {
    this.refreshCronAssetDocs();
    return this.cron.listJobs(includeDisabled);
  }

  listCronExecutionRecords(limit = 100): CronExecutionRecord[] {
    this.refreshCronAssetDocs();
    return this.cron.listExecutionRecords(limit);
  }

  enqueueCronRun(jobId: string, mode: "due" | "force" = "due"): { ok: true; enqueued: boolean; runId?: string; reason?: string } {
    return this.cron.enqueueRun(jobId, mode);
  }

  removeCronJob(jobId: string): boolean {
    const removed = this.cron.removeJob(jobId);
    if (removed) {
      this.refreshCronAssetDocs();
      void this.persistNow();
    }
    return removed;
  }

  setCronJobEnabled(jobId: string, enabled: boolean): boolean {
    const changed = this.cron.setJobEnabled(jobId, enabled);
    if (changed) {
      this.refreshCronAssetDocs();
      void this.persistNow();
    }
    return changed;
  }

  retryCronJob(jobId: string): boolean {
    const changed = this.cron.retryJobNow(jobId);
    if (changed) {
      this.refreshCronAssetDocs();
      appLogger.warn({
        module: "cron",
        event: "task_retried",
        message: "Cron 任务已请求重试",
        context: { jobId }
      });
      void this.persistNow();
    }
    return changed;
  }

  setForegroundSchedulerReady(ready: boolean): void {
    this.foregroundSchedulerReady = ready;
  }

  setCronSessionModelResolver(resolver?: (channelId: string) => ModelSession | null): void {
    this.cronSessionModelResolver = resolver;
  }

  isForegroundSchedulerReady(): boolean {
    return this.foregroundSchedulerReady;
  }

  async shutdown(): Promise<void> {
    this.cron.stop();
    await this.channelRegistry.stopAll();
  }

  async sendMessage(options: SendMessageOptions): Promise<ChatResponse> {
    this.bus.publishInbound({
      channelId: options.channelId,
      text: options.text,
      ts: Date.now()
    });
    this.bus.publishProgress({
      channelId: options.channelId,
      stage: "receive",
      ts: Date.now()
    });
    const userMessage = this.channels.appendMessage(options.channelId, "user", options.text, options.sourceType ?? "user");
    this.persistMemories(options.channelId, userMessage.content);
    this.bus.publishProgress({
      channelId: options.channelId,
      stage: "recall",
      ts: Date.now()
    });
    const recalled = this.memory.recall(options.channelId, options.text, 3);
    const messages = this.channels.getRecentMessages(options.channelId, 30);
    const assembled = this.assemblePrompt({
      channelId: options.channelId,
      userText: options.text,
      recalled,
      runtimeTime: options.runtimeTime
    });
    const resolvedPrimary = options.primary ?? this.resolveSessionFromTier(options.channelId, options.tier ?? "small");
    this.bus.publishProgress({
      channelId: options.channelId,
      stage: "model_call",
      detail: `${resolvedPrimary.providerId}/${resolvedPrimary.modelId}`,
      ts: Date.now()
    });
    const response = await this.gateway.chatWithFallback(
      {
        modelId: resolvedPrimary.modelId,
        messages,
        systemPrompt: assembled.systemPrompt,
        signal: options.signal
      },
      { primary: resolvedPrimary, fallback: options.fallback }
    );
    if (!options.deferAssistant) {
      this.channels.appendMessage(options.channelId, "assistant", response.text, "assistant");
    }
    this.bus.publishOutbound({
      channelId: options.channelId,
      text: response.text,
      ts: Date.now()
    });
    this.bus.publishProgress({
      channelId: options.channelId,
      stage: "respond",
      ts: Date.now()
    });
    this.bus.publishSnapshot({
      channelId: options.channelId,
      messages: this.channels.getRecentMessages(options.channelId, 100),
      ts: Date.now()
    });
    await this.persistNow();
    return response;
  }

  async continueWithToolContext(options: {
    channelId: string;
    userText: string;
    toolContext: string;
    primary: ModelSession;
    fallback?: ModelSession;
    signal?: AbortSignal;
    runtimeTime?: RuntimeTimeContext;
    deferAssistant?: boolean;
  }): Promise<ChatResponse> {
    const recalled = this.memory.recall(options.channelId, options.userText, 3);
    const messages = this.channels.getRecentMessages(options.channelId, 30);
    const assembled = this.assemblePrompt({
      channelId: options.channelId,
      userText: options.userText,
      recalled,
      runtimeTime: options.runtimeTime
    });
    const systemPrompt = `${assembled.systemPrompt}\n\n## Tool Results\n${options.toolContext}`.trim();
    this.bus.publishProgress({
      channelId: options.channelId,
      stage: "model_call",
      detail: `${options.primary.providerId}/${options.primary.modelId} (tool-loop)`,
      ts: Date.now()
    });
    const response = await this.gateway.chatWithFallback(
      {
        modelId: options.primary.modelId,
        messages,
        systemPrompt,
        signal: options.signal
      },
      { primary: options.primary, fallback: options.fallback }
    );
    if (!options.deferAssistant) {
      this.channels.appendMessage(options.channelId, "assistant", response.text, "assistant");
    }
    this.bus.publishOutbound({
      channelId: options.channelId,
      text: response.text,
      ts: Date.now()
    });
    this.bus.publishSnapshot({
      channelId: options.channelId,
      messages: this.channels.getRecentMessages(options.channelId, 100),
      ts: Date.now()
    });
    await this.persistNow();
    return response;
  }

  createPlan(steps: Omit<PlanStep, "id" | "status">[]): PlanRun {
    const plan = this.planner.createPlan(steps);
    void this.persistNow();
    return plan;
  }

  async runPlan(channelId: string): Promise<PlanRun> {
    const context = this.getChannelContext(channelId);
    const run = await this.planner.run(context, {
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
        if (step.tool === "cron.create") {
          const name = String(step.input.name ?? "Agent Cron");
          const text = String(step.input.text ?? step.input.message ?? "");
          const everySec = Number(step.input.everySec ?? 0);
          const atMs = Number(step.input.atMs ?? 0);
          const cronExpr = typeof step.input.cronExpr === "string" ? step.input.cronExpr.trim() : "";
          const cronTz = typeof step.input.cronTz === "string" ? step.input.cronTz.trim() : undefined;
          const schedule: CronSchedule = cronExpr
            ? {
                kind: "cron",
                expr: cronExpr,
                tz: cronTz,
                staggerMs: Number.isFinite(Number(step.input.staggerMs)) ? Math.max(0, Number(step.input.staggerMs)) : undefined
              }
            : everySec > 0
              ? { kind: "every", everyMs: Math.max(1000, Math.floor(everySec * 1000)) }
              : { kind: "at", atMs: atMs > 0 ? atMs : Date.now() + 60_000 };
          const sessionTarget = typeof step.input.sessionTarget === "string" ? step.input.sessionTarget : "isolated";
          const deliveryMode = typeof step.input.deliveryMode === "string" ? step.input.deliveryMode : "announce";
          const timingClass = step.input.timingClass === "exact_foreground" ? "exact_foreground" : "best_effort_background";
          const job = this.addCronJobByAgent({
            agentId: DEFAULT_AGENT_ID,
            name,
            schedule,
            payload: { kind: "agentTurn", channelId: ctx.channelId, message: text, tier: this.toTier(this.getChannel(channelId).defaultModel) },
            idempotencyKey: typeof step.input.idempotencyKey === "string" ? step.input.idempotencyKey : undefined
            ,
            sessionTarget,
            delivery: deliveryMode === "none" ? { mode: "none" } : { mode: "announce" },
            timingClass,
            runModelStrategy: "current_session"
          });
          appLogger.info({
            module: "cron",
            event: "reminder_commitment_fulfilled",
            message: "提醒承诺已落地为 Cron 任务",
            context: { channelId: ctx.channelId, jobId: job.id, scheduleKind: schedule.kind }
          });
          return { created: true, jobId: job.id };
        }
        if (step.tool === "cron.update") {
          const jobId = String(step.input.jobId ?? "");
          if (!jobId) return { updated: false, reason: "missing_job_id" };
          const next = this.updateCronJobByAgent(jobId, {
            name: typeof step.input.name === "string" ? step.input.name : undefined,
            enabled: typeof step.input.enabled === "boolean" ? step.input.enabled : undefined,
            timingClass: step.input.timingClass === "exact_foreground" || step.input.timingClass === "best_effort_background"
              ? step.input.timingClass
              : undefined
          });
          return { updated: Boolean(next), jobId };
        }
        if (step.tool === "cron.run") {
          const jobId = String(step.input.jobId ?? "");
          if (!jobId) return { enqueued: false, reason: "missing_job_id" };
          const mode = step.input.mode === "force" ? "force" : "due";
          return this.enqueueCronRun(jobId, mode);
        }
        if (step.tool === "cron.runs") {
          const limit = Number.isFinite(Number(step.input.limit)) ? Math.max(1, Math.floor(Number(step.input.limit))) : 20;
          const jobId = typeof step.input.jobId === "string" ? step.input.jobId : "";
          const runs = this.listCronExecutionRecords(limit).filter((row) => (jobId ? row.jobId === jobId : true));
          return { total: runs.length, runs };
        }
        if (step.tool === "cron.delete") {
          const jobId = String(step.input.jobId ?? "");
          if (!jobId) return { removed: false, reason: "missing_job_id" };
          const removed = this.removeCronJobByAgent(jobId);
          return { removed, jobId };
        }
        return { ok: true };
      }
    });
    await this.persistNow();
    return run;
  }

  getChannelContext(channelId: string): ChannelContext {
    const recentMessages = this.channels.getRecentMessages(channelId, 40);
    const activePlan = this.planner.getActivePlan();
    const channel = this.channels.getChannel(channelId);
    const lastUser = [...recentMessages].reverse().find((m) => m.role === "user");
    const memoryRecall = lastUser
      ? this.memory.recall(channelId, lastUser.content, 5).map((r) => ({ recordId: r.id, content: r.content, score: 1 }))
      : [];
    const resolvedModel = this.resolveModelDescriptor(channelId, this.toTier(channel.defaultModel));
    const resolvedSoul = this.resolveSoulProfile(channelId);
    const promptReport = this.promptReportsByChannel.get(channelId) ?? null;
    const effectiveConfigRef = promptReport?.effectiveConfigRef;
    return {
      channelId,
      contextType: channel.contextType ?? "shared",
      recentMessages,
      activePlan,
      memoryRecall,
      resolvedModel,
      resolvedSoul,
      promptReport,
      effectiveConfigRef
    };
  }

  getMessages(channelId: string): Message[] {
    return this.channels.getRecentMessages(channelId, 100);
  }

  appendSystemMessage(channelId: string, text: string, flowRunId?: string): Message {
    const message = this.channels.appendMessage(channelId, "system", text, "system", flowRunId);
    this.refreshAgentAssets(channelId);
    void this.persistNow();
    return message;
  }

  appendAssistantMessage(
    channelId: string,
    text: string,
    sourceType: Message["sourceType"] = "assistant",
    options?: { flowRunId?: string; visibility?: Message["visibility"]; normalizedFromToolCall?: boolean }
  ): Message {
    const message = this.channels.appendMessage(channelId, "assistant", text, sourceType, options?.flowRunId, {
      visibility: options?.visibility,
      normalizedFromToolCall: options?.normalizedFromToolCall
    });
    this.refreshAgentAssets(channelId);
    void this.persistNow();
    return message;
  }

  readToolAsset(path: string): { ok: boolean; content?: string; error?: string } {
    if (!this.isToolReadablePath(path)) return { ok: false, error: "path_not_allowed" };
    const doc = this.assetDocs.get(path);
    if (!doc) return { ok: false, error: "asset_not_found" };
    return { ok: true, content: doc.contentMd };
  }

  listToolAssets(path = ""): { ok: boolean; path: string; entries?: Array<{ name: string; type: "file" | "dir"; path: string }>; error?: string } {
    const normalized = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    const base = normalized ? `${normalized}/` : "";
    if (normalized && !this.isToolReadablePath(normalized) && !this.isToolReadablePath(base)) {
      return { ok: false, path: normalized, error: "path_not_allowed" };
    }
    const entriesMap = new Map<string, { name: string; type: "file" | "dir"; path: string }>();
    for (const key of this.assetDocs.keys()) {
      if (normalized) {
        if (key === normalized) {
          entriesMap.set(key, { name: this.basename(key), type: "file", path: key });
          continue;
        }
        if (!key.startsWith(base)) continue;
      }
      const rest = normalized ? key.slice(base.length) : key;
      if (!rest) continue;
      const [head, ...tail] = rest.split("/");
      if (!head) continue;
      const entryPath = normalized ? `${normalized}/${head}` : head;
      if (!entriesMap.has(entryPath)) {
        entriesMap.set(entryPath, { name: head, type: tail.length ? "dir" : "file", path: entryPath });
      }
    }
    const entries = [...entriesMap.values()].sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { ok: true, path: normalized || ".", entries };
  }

  writeToolAsset(path: string, content: string, mode: "replace" | "append" = "replace"): { ok: boolean; error?: string } {
    if (!this.isToolWritablePath(path)) return { ok: false, error: "path_not_allowed" };
    const prev = this.assetDocs.get(path)?.contentMd ?? "";
    const next = mode === "append" ? `${prev}${prev ? "\n" : ""}${content}` : content;
    this.upsertAssetDoc(path, this.basename(path), next);
    if (path === "workspace/SOUL.md") {
      const channel = this.channels.dumpState().channels[0];
      if (channel) this.workspaceSoulMap.set(channel.workspaceId, next.trim());
    }
    this.refreshAllAgentAssets();
    void this.persistNow();
    return { ok: true };
  }

  getCronSnapshot(options?: { limit?: number; includeDisabled?: boolean }): {
    total: number;
    generatedAt: number;
    jobs: Array<{ id: string; name: string; enabled: boolean; nextRunAtMs?: number; lastStatus?: string }>;
  } {
    const limit = Math.max(1, Math.min(100, Math.floor(options?.limit ?? 20)));
    const includeDisabled = options?.includeDisabled ?? true;
    const jobs = this.cron.listJobs(includeDisabled).slice(0, limit);
    return {
      total: this.cron.listJobs(true).length,
      generatedAt: Date.now(),
      jobs: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        enabled: job.enabled,
        nextRunAtMs: job.state.nextRunAtMs,
        lastStatus: job.state.lastStatus
      }))
    };
  }

  getModelRecommendations(): ModelRecommendation[] {
    return MODEL_RECOMMENDATIONS.map((r) => ({ ...r }));
  }

  getWorkspaceConfig(workspaceId: string): WorkspaceConfig {
    const state = this.channels.dumpState();
    const ws = state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) throw new Error(`workspace ${workspaceId} not found`);
    return this.withWorkspaceDefaults(ws);
  }

  setWorkspaceTierMapping(workspaceId: string, tierMapping: TierMapping): void {
    const ws = this.getWorkspaceConfig(workspaceId);
    ws.tierMapping = tierMapping;
    this.channels.upsertWorkspace(ws);
    void this.persistNow();
  }

  setChannelTierMapping(channelId: string, tierMapping: TierMapping): void {
    this.channels.setChannelTierMapping(channelId, tierMapping);
    void this.persistNow();
  }

  async configureProviderByok(providerId: string, key: string): Promise<string> {
    const credentialRef = await this.credentials.saveKey(providerId, key);
    this.providerCredentialRefs.set(providerId, credentialRef);
    this.refreshAllAgentAssets();
    await this.persistNow();
    return credentialRef;
  }

  async configureProviderOAuth(providerId: string, authCode: string): Promise<string> {
    const credentialRef = await this.credentials.startOAuth(providerId, authCode);
    this.providerCredentialRefs.set(providerId, credentialRef);
    this.refreshAllAgentAssets();
    await this.persistNow();
    return credentialRef;
  }

  async configureProviderOAuthTokens(providerId: string, tokens: OAuthTokens): Promise<string> {
    const credentialRef = await this.credentials.saveOAuthTokens(providerId, tokens);
    this.providerCredentialRefs.set(providerId, credentialRef);
    this.refreshAllAgentAssets();
    await this.persistNow();
    return credentialRef;
  }

  getProviderCredentialMap(): Record<string, string> {
    return Object.fromEntries(this.providerCredentialRefs.entries());
  }

  setOAuthClientConfig(providerId: string, config: OAuthClientConfig): void {
    this.oauthClientConfigs.set(providerId, config);
    void this.persistNow();
  }

  getOAuthClientConfig(providerId: string): OAuthClientConfig | null {
    return this.oauthClientConfigs.get(providerId) ?? null;
  }

  getOAuthClientConfigMap(): Record<string, OAuthClientConfig> {
    return Object.fromEntries(this.oauthClientConfigs.entries());
  }

  setWorkspaceSoul(workspaceId: string, instruction: string): void {
    const normalized = instruction.trim();
    if (!normalized) {
      this.workspaceSoulMap.delete(workspaceId);
    } else {
      this.workspaceSoulMap.set(workspaceId, normalized);
    }
    const soulPath: WorkspaceEditableFile = "workspace/SOUL.md";
    this.upsertAssetDoc(soulPath, "SOUL.md", normalized || WORKSPACE_DEFAULT_TEMPLATES[soulPath]);
    void this.persistNow();
  }

  setChannelSoul(channelId: string, instruction: string | null): void {
    const normalized = instruction?.trim() ?? "";
    if (!normalized) {
      this.channelSoulMap.delete(channelId);
    } else {
      this.channelSoulMap.set(channelId, normalized);
    }
    void this.persistNow();
  }

  getLastPromptReport(channelId: string): PromptAssemblyReport | null {
    return this.promptReportsByChannel.get(channelId) ?? null;
  }

  listAssets(role: AssetViewerRole): AssetDoc[] {
    return this.listAssetsWithScope(role, { scope: "all" });
  }

  listAssetsWithScope(
    role: AssetViewerRole,
    options?: {
      scope?: AssetListScope;
      channelId?: string;
    }
  ): AssetDoc[] {
    const scope = options?.scope ?? "all";
    const channelId = options?.channelId;
    this.refreshCronAssetDocs();
    let docs = [...this.assetDocs.values()].sort((a, b) => a.path.localeCompare(b.path));
    if (role !== "developer") docs = docs.filter((doc) => USER_VISIBLE_ASSET_PATHS.has(doc.path));
    if (scope === "workspace_shared") return docs.filter((doc) => doc.path.startsWith("workspace/"));
    if (scope === "cron") return docs.filter((doc) => doc.path === "cron/jobs.json" || doc.path.startsWith("cron/runs/"));
    if (scope === "channel_session" && channelId) {
      const prefix = `agents/${DEFAULT_AGENT_ID}/sessions/${channelId}/`;
      return docs.filter((doc) => doc.path.startsWith(prefix));
    }
    return docs;
  }

  listAssetTree(
    role: AssetViewerRole,
    options?: {
      scope?: AssetListScope;
      channelId?: string;
    }
  ): AssetTreeNode[] {
    const docs = this.listAssetsWithScope(role, options);
    const root: AssetTreeNode = { type: "dir", name: "", path: "", children: [] };
    for (const doc of docs) {
      const segments = doc.path.split("/");
      let cursor = root;
      let partial = "";
      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i]!;
        partial = partial ? `${partial}/${segment}` : segment;
        const isLeaf = i === segments.length - 1;
        if (!cursor.children) cursor.children = [];
        let next = cursor.children.find((n) => n.path === partial);
        if (!next) {
          next = {
            type: isLeaf ? "file" : "dir",
            name: segment,
            path: partial,
            children: isLeaf ? undefined : []
          };
          cursor.children.push(next);
          cursor.children.sort((a, b) => {
            if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        }
        cursor = next;
      }
    }
    return root.children ?? [];
  }

  readAsset(role: AssetViewerRole, path: string): AssetDoc | null {
    if (role === "user" && !USER_VISIBLE_ASSET_PATHS.has(path)) return null;
    return this.assetDocs.get(path) ?? null;
  }

  exportAsset(path: string): string | null {
    return this.assetDocs.get(path)?.contentMd ?? null;
  }

  applyWorkspaceEdit(request: WorkspaceEditRequest): WorkspaceEditResult {
    const parsed = this.parseWorkspaceEditIntent(request);
    if (!parsed) return { handled: false };
    const isOverwrite = parsed.mode === "replace";
    if (isOverwrite && !request.confirmed) {
      this.pendingWorkspaceEdits.set(request.channelId, parsed);
      return {
        handled: true,
        requiresConfirmation: true,
        targetPath: parsed.path,
        mode: parsed.mode,
        summary: parsed.summary
      };
    }
    this.commitWorkspaceEdit(parsed);
    return {
      handled: true,
      targetPath: parsed.path,
      mode: parsed.mode,
      summary: parsed.summary
    };
  }

  confirmPendingWorkspaceEdit(channelId: string): WorkspaceEditResult {
    const pending = this.pendingWorkspaceEdits.get(channelId);
    if (!pending) return { handled: false };
    this.commitWorkspaceEdit(pending);
    this.pendingWorkspaceEdits.delete(channelId);
    return {
      handled: true,
      targetPath: pending.path,
      mode: pending.mode,
      summary: pending.summary
    };
  }

  async resetAll(options: { preserveCredentials: boolean; workspace?: WorkspaceConfig }): Promise<void> {
    const credentialsSnapshot = options.preserveCredentials ? this.credentials.dumpState() : [];
    const refsSnapshot = options.preserveCredentials ? new Map(this.providerCredentialRefs) : new Map<string, string>();
    this.channels.reset();
    this.memory.reset();
    this.credentials.reset();
    this.cron.reset();
    this.providerCredentialRefs.clear();
    this.oauthClientConfigs.clear();
    this.workspaceSoulMap.clear();
    this.channelSoulMap.clear();
    this.promptReportsByChannel.clear();
    this.assetDocs.clear();

    if (options.preserveCredentials) {
      this.credentials.loadState(credentialsSnapshot);
      for (const [providerId, ref] of refsSnapshot.entries()) this.providerCredentialRefs.set(providerId, ref);
    }

    if (options.workspace) this.channels.upsertWorkspace(this.withWorkspaceDefaults(options.workspace));
    if (options.workspace) this.ensureWorkspaceAssetBaseline(this.withWorkspaceDefaults(options.workspace));
    this.cron.start();
    await this.persistNow();
  }

  private persistMemories(channelId: string, userText: string): void {
    const extracted = extractMemory(userText);
    for (const item of extracted) this.memory.write(channelId, item.type, item.content);
  }

  async loadPersistedState(): Promise<void> {
    if (!this.persistence) return;
    const state = await this.persistence.load();
    if (!state) return;
    this.channels.loadState({
      workspaces: state.workspaces.map((w) => this.withWorkspaceDefaults(w)),
      channels: state.channels,
      messages: state.messages
    });
    this.ensureWorkspaceMainChannelContextType();
    this.memory.loadState(state.memoryRecords);
    this.credentials.loadState(state.credentials);
    this.providerCredentialRefs.clear();
    for (const [providerId, credentialRef] of Object.entries(state.providerCredentialRefs ?? {})) {
      this.providerCredentialRefs.set(providerId, credentialRef);
    }
    this.oauthClientConfigs.clear();
    for (const [providerId, config] of Object.entries(state.oauthClientConfigs ?? {})) {
      this.oauthClientConfigs.set(providerId, config);
    }
    this.cron.loadJobs(state.cronJobs ?? []);
    this.cron.loadExecutionRecords(state.cronExecutionRecords ?? []);
    this.workspaceSoulMap.clear();
    for (const [workspaceId, instruction] of Object.entries(state.workspaceSoulMap ?? {})) {
      if (instruction?.trim()) this.workspaceSoulMap.set(workspaceId, instruction.trim());
    }
    this.channelSoulMap.clear();
    for (const [channelId, instruction] of Object.entries(state.channelSoulMap ?? {})) {
      if (instruction?.trim()) this.channelSoulMap.set(channelId, instruction.trim());
    }
    this.promptReportsByChannel.clear();
    for (const [channelId, report] of Object.entries(state.promptReports ?? {})) {
      this.promptReportsByChannel.set(channelId, report);
    }
    this.assetDocs.clear();
    const persistedDocs = state.assetDocs ?? state.internalConfigDocs ?? {};
    for (const [path, doc] of Object.entries(persistedDocs)) {
      this.assetDocs.set(path, {
        path,
        name: doc.name,
        updatedAt: doc.updatedAt,
        contentMd: doc.contentMd
      });
    }
    const channels = this.channels.dumpState().channels;
    for (const channel of channels) {
      const workspace = this.withWorkspaceDefaults(this.getWorkspaceConfig(channel.workspaceId));
      this.ensureWorkspaceAssetBaseline(workspace);
      this.refreshAgentAssets(channel.id);
    }
    this.refreshCronAssetDocs();
  }

  async persistNow(): Promise<void> {
    if (!this.persistence) return;
    await this.persistence.save({
      version: 9,
      ...this.channels.dumpState(),
      memoryRecords: this.memory.dumpState(),
      credentials: this.credentials.dumpState(),
      providerCredentialRefs: this.getProviderCredentialMap(),
      oauthClientConfigs: this.getOAuthClientConfigMap(),
      cronJobs: this.cron.dumpJobs(),
      cronExecutionRecords: this.cron.dumpExecutionRecords(),
      workspaceSoulMap: Object.fromEntries(this.workspaceSoulMap.entries()),
      channelSoulMap: Object.fromEntries(this.channelSoulMap.entries()),
      promptReports: Object.fromEntries(this.promptReportsByChannel.entries()),
      assetDocs: Object.fromEntries(this.assetDocs.entries())
    });
  }

  private toTier(modelId: string): ModelTier {
    return modelId === "large" ? "large" : "small";
  }

  private withWorkspaceDefaults(config: WorkspaceConfig): WorkspaceConfig {
    const fallback = MODEL_RECOMMENDATIONS[0].tierMapping;
    return {
      ...config,
      tierMapping: config.tierMapping ?? fallback,
      displayModelNameStrategy: config.displayModelNameStrategy ?? "display_name"
    };
  }

  private resolveModelDescriptor(channelId: string, tier: ModelTier): ResolvedModel | null {
    const channel = this.channels.getChannel(channelId);
    const workspace = this.withWorkspaceDefaults(this.getWorkspaceConfig(channel.workspaceId));
    const mapping = channel.tierMappingOverride ?? workspace.tierMapping!;
    const selected = mapping[tier];
    if (!selected) return null;
    const displayName =
      workspace.displayModelNameStrategy === "model_id"
        ? selected.modelId
        : selected.displayName ?? `${selected.providerId}/${selected.modelId}`;
    return {
      tier,
      providerId: selected.providerId,
      modelId: selected.modelId,
      displayName
    };
  }

  private resolveSessionFromTier(channelId: string, tier: ModelTier): ModelSession {
    const resolved = this.resolveModelDescriptor(channelId, tier);
    if (!resolved) throw new Error(`tier mapping missing for ${tier}`);
    const credentialRef = this.providerCredentialRefs.get(resolved.providerId);
    if (!credentialRef) throw new Error(`provider ${resolved.providerId} not configured`);
    return {
      providerId: resolved.providerId,
      modelId: resolved.modelId,
      credentialRef
    };
  }

  private resolveSoulProfile(channelId: string): SoulProfile | null {
    const channelSoul = this.channelSoulMap.get(channelId)?.trim();
    if (channelSoul) return { instruction: channelSoul, source: "channel" };
    const channel = this.channels.getChannel(channelId);
    const fileSoul = this.assetDocs.get("workspace/SOUL.md")?.contentMd?.trim();
    if (fileSoul) return { instruction: fileSoul, source: "workspace" };
    const workspaceSoul = this.workspaceSoulMap.get(channel.workspaceId)?.trim();
    if (workspaceSoul) return { instruction: workspaceSoul, source: "workspace" };
    return null;
  }

  private assemblePrompt(params: {
    channelId: string;
    userText: string;
    recalled: Array<{ type: "preference" | "fact" | "goal"; content: string }>;
    runtimeTime?: RuntimeTimeContext;
  }): { systemPrompt: string; report: PromptAssemblyReport } {
    const channel = this.channels.getChannel(params.channelId);
    this.ensureWorkspaceMainChannelContextType();
    const soul = this.resolveSoulProfile(params.channelId);
    const workspaceState = this.getWorkspaceRuntimeState(channel.workspaceId);
    const contextBuild = this.buildWorkspaceContext({
      workspaceId: channel.workspaceId,
      contextType: channel.contextType ?? "shared",
      setupCompletedAt: workspaceState.setupCompletedAt
    });

    const segments: PromptAssemblySegment[] = [];
    const pushSegment = (
      source: PromptAssemblySegment["source"],
      title: string,
      content: string,
    ) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      segments.push({
        id: uid("seg"),
        source,
        title,
        content: trimmed,
        charCount: trimmed.length,
      });
    };

    for (const item of contextBuild.items) {
      const source: PromptAssemblySegment["source"] =
        item.path === "workspace/SOUL.md"
          ? "soul"
          : item.path === "workspace/TOOLS.md"
            ? "tools"
            : item.path === "workspace/MEMORY.md"
              ? "memory"
              : item.path === "workspace/HEARTBEAT.md"
                ? "runtime"
                : "workspace";
      pushSegment(source, `Project Context: ${item.path}`, item.content);
    }
    if (soul && !contextBuild.items.some((item) => item.path === "workspace/SOUL.md")) {
      pushSegment("soul", `Soul (${soul.source})`, soul.instruction);
    }
    if (params.recalled.length) {
      const recallText = params.recalled.map((r) => `- (${r.type}) ${r.content}`).join("\n");
      pushSegment("memory", "Memory Recall", recallText);
    }
    pushSegment(
      "tools",
      "Tool Contract",
      [
        "When user asks reminders/timers, output structured tool call in code fence:",
        "```tool_call",
        "{\"tool\":\"cron.add\",\"args\":{\"name\":\"...\",\"atMs\":123,\"message\":\"...\",\"sessionTarget\":\"current\",\"deliveryMode\":\"announce\",\"timingClass\":\"best_effort_background\"}}",
        "```",
        "Available tools: cron.add/update/remove/remove_all/run/status/list, time.now, fs.read, fs.list, fs.write, exec.run.",
        "For time-sensitive answers, call time.now first and base wording on tool result.",
        "Do not claim reminder is set unless you emitted cron.add/cron.update.",
        "For reminder tasks in MobileClaw, prefer sessionTarget=current unless user explicitly asks for isolated execution."
      ].join("\n")
    );
    if (/(提醒|定时|闹钟|cron|任务|立即执行|重试)/i.test(params.userText)) {
      const snapshot = this.getCronSnapshot({ limit: 20, includeDisabled: true });
      const snapshotBody = snapshot.jobs.length
        ? snapshot.jobs
            .map((job) => `- ${job.id} | ${job.name} | ${job.enabled ? "enabled" : "disabled"} | next=${job.nextRunAtMs ?? "-"} | last=${job.lastStatus ?? "-"}`)
            .join("\n")
        : "- (no cron jobs)";
      pushSegment(
        "runtime",
        "Cron Snapshot",
        [`generatedAt: ${new Date(snapshot.generatedAt).toISOString()}`, `total: ${snapshot.total}`, snapshotBody].join("\n")
      );
      appLogger.info({
        module: "cron",
        event: "cron_snapshot_injected",
        message: "Cron 相关意图注入轻量快照",
        context: { channelId: params.channelId, total: snapshot.total, injected: snapshot.jobs.length }
      });
    }
    const nowMs = params.runtimeTime?.nowMs ?? Date.now();
    const nowIso = params.runtimeTime?.iso ?? new Date(nowMs).toISOString();
    const tz = params.runtimeTime?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    const locale = params.runtimeTime?.locale ?? (Intl.DateTimeFormat().resolvedOptions().locale || "en-US");
    pushSegment(
      "runtime",
      "Runtime Hint",
      [
        `Current channel: ${channel.name}`,
        `Last user input: ${params.userText}`,
        `currentTimeIso: ${nowIso}`,
        `timezone: ${tz}`,
        `locale: ${locale}`,
        `unixMs: ${nowMs}`
      ].join("\n")
    );
    pushSegment(
      "runtime",
      "Runtime Capabilities",
      [
        "enabledTools: time.now, fs.read, fs.list, fs.write, exec.run, cron.add, cron.update, cron.remove, cron.remove_all, cron.run, cron.status, cron.list",
        "approvalRequired: fs.write, exec.run, cron.add, cron.update, cron.remove, cron.remove_all",
        "policy: for time/file/cron facts, call tools first then answer from tool result"
      ].join("\n")
    );

    const systemPrompt = segments
      .map((seg) => `## ${seg.title}\n${seg.content}`)
      .join("\n\n")
      .trim();

    const report: PromptAssemblyReport = {
      id: uid("prompt_report"),
      workspaceId: channel.workspaceId,
      channelId: params.channelId,
      createdAt: Date.now(),
      segments,
      contextFiles: contextBuild.items.map((item) => ({
        path: item.path,
        chars: item.content.length,
        truncated: item.truncated
      })),
      truncationWarnings: contextBuild.warnings.length ? contextBuild.warnings : undefined,
      totalChars: systemPrompt.length,
      effectiveConfigRef: "workspace/.openclaw/workspace-state.json",
    };
    this.promptReportsByChannel.set(params.channelId, report);
    this.refreshPromptAndWorkspaceAssets(params.channelId, report, workspaceState);
    this.refreshAgentAssets(params.channelId);
    return { systemPrompt, report };
  }

  private refreshPromptAndWorkspaceAssets(
    channelId: string,
    report: PromptAssemblyReport,
    workspaceState: WorkspaceRuntimeState,
  ): void {
    const channel = this.channels.getChannel(channelId);
    const now = Date.now();
    const upsert = (path: string, name: string, contentMd: string) => {
      this.assetDocs.set(path, { path, name, updatedAt: now, contentMd });
    };

    this.saveWorkspaceRuntimeState({
      ...workspaceState,
      latestPromptReportId: report.id,
      lastChannelId: channel.id,
      lastChannelName: channel.name,
      updatedAt: now
    });

    upsert(
      "workspace/HEARTBEAT.md",
      "HEARTBEAT.md",
      [
        "# HEARTBEAT",
        "",
        `- lastPromptReportId: ${report.id}`,
        `- totalChars: ${report.totalChars}`,
        `- contextFiles: ${report.contextFiles?.length ?? 0}`,
        `- updatedAt: ${new Date(now).toISOString()}`
      ].join("\n"),
    );

  }

  private getWorkspaceRuntimeState(workspaceId: string): WorkspaceRuntimeState {
    const raw = this.assetDocs.get("workspace/.openclaw/workspace-state.json")?.contentMd ?? "";
    const now = Date.now();
    const parsed = this.parseWorkspaceRuntimeState(raw);
    const bootstrapExists = this.assetDocs.has("workspace/BOOTSTRAP.md");
    const state: WorkspaceRuntimeState = {
      workspaceId,
      bootstrapSeededAt: parsed?.bootstrapSeededAt ?? (bootstrapExists ? now : undefined),
      setupCompletedAt: parsed?.setupCompletedAt,
      templateVersion: parsed?.templateVersion,
      latestPromptReportId: parsed?.latestPromptReportId,
      lastChannelId: parsed?.lastChannelId,
      lastChannelName: parsed?.lastChannelName,
      updatedAt: parsed?.updatedAt ?? now
    };
    if (!bootstrapExists && !state.setupCompletedAt) {
      state.setupCompletedAt = now;
    }
    return state;
  }

  private parseWorkspaceRuntimeState(raw: string): WorkspaceRuntimeState | null {
    if (!raw.trim()) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<WorkspaceRuntimeState>;
      if (!parsed.workspaceId || typeof parsed.workspaceId !== "string") return null;
      return {
        workspaceId: parsed.workspaceId,
        bootstrapSeededAt: parsed.bootstrapSeededAt,
        setupCompletedAt: parsed.setupCompletedAt,
        templateVersion: parsed.templateVersion,
        latestPromptReportId: parsed.latestPromptReportId,
        lastChannelId: parsed.lastChannelId,
        lastChannelName: parsed.lastChannelName,
        updatedAt: parsed.updatedAt
      };
    } catch {
      return null;
    }
  }

  private saveWorkspaceRuntimeState(state: WorkspaceRuntimeState): void {
    this.upsertAssetDoc(
      "workspace/.openclaw/workspace-state.json",
      "workspace-state.json",
      JSON.stringify(
        {
          workspaceId: state.workspaceId,
          bootstrapSeededAt: state.bootstrapSeededAt,
          setupCompletedAt: state.setupCompletedAt,
          templateVersion: state.templateVersion ?? WORKSPACE_TEMPLATE_VERSION,
          latestPromptReportId: state.latestPromptReportId,
          lastChannelId: state.lastChannelId,
          lastChannelName: state.lastChannelName,
          updatedAt: state.updatedAt ?? Date.now()
        },
        null,
        2
      )
    );
  }

  private buildWorkspaceContext(input: {
    workspaceId: string;
    contextType: "main" | "shared";
    setupCompletedAt?: number;
  }): { items: ContextBuildItem[]; warnings: string[] } {
    const warnings: string[] = [];
    const candidates: Array<{ path: string; include: boolean; maxChars?: number }> = [
      { path: "workspace/AGENTS.md", include: true },
      { path: "workspace/SOUL.md", include: true },
      { path: "workspace/TOOLS.md", include: true },
      { path: "workspace/IDENTITY.md", include: true },
      { path: "workspace/USER.md", include: true },
      { path: "workspace/HEARTBEAT.md", include: true, maxChars: HEARTBEAT_MAX_CHARS },
      { path: "workspace/BOOTSTRAP.md", include: !input.setupCompletedAt, maxChars: BOOTSTRAP_MAX_CHARS },
      { path: "workspace/MEMORY.md", include: input.contextType === "main" }
    ];

    const items: ContextBuildItem[] = [];
    let used = 0;
    for (const candidate of candidates) {
      if (!candidate.include) continue;
      const doc = this.assetDocs.get(candidate.path);
      if (!doc?.contentMd?.trim()) continue;
      const fileBudget = candidate.maxChars ?? CONTEXT_PER_FILE_MAX_CHARS;
      const perFile = this.truncateForPrompt(doc.contentMd.trim(), fileBudget);
      if (perFile.truncated) warnings.push(`${candidate.path} exceeded per-file budget (${fileBudget})`);
      const remaining = CONTEXT_TOTAL_MAX_CHARS - used;
      if (remaining <= 0) {
        warnings.push(`context total budget exceeded, skipped ${candidate.path}`);
        continue;
      }
      const finalSlice = this.truncateForPrompt(perFile.text, remaining);
      if (!finalSlice.text.trim()) continue;
      if (finalSlice.truncated) warnings.push(`${candidate.path} truncated by total budget`);
      items.push({
        path: candidate.path,
        content: finalSlice.text,
        truncated: perFile.truncated || finalSlice.truncated
      });
      used += finalSlice.text.length;
    }
    return { items, warnings };
  }

  private truncateForPrompt(content: string, maxChars: number): { text: string; truncated: boolean } {
    if (content.length <= maxChars) return { text: content, truncated: false };
    if (maxChars <= 64) return { text: `${content.slice(0, Math.max(0, maxChars - 16))}\n...[truncated]`, truncated: true };
    const marker = "\n...[truncated]...\n";
    const available = Math.max(0, maxChars - marker.length);
    const head = Math.max(1, Math.floor(available * 0.7));
    const tail = Math.max(1, available - head);
    const text = `${content.slice(0, head)}${marker}${content.slice(content.length - tail)}`;
    return { text, truncated: true };
  }

  private ensureWorkspaceAssetBaseline(workspace: WorkspaceConfig): void {
    const now = Date.now();
    const upsert = (path: string, name: string, contentMd: string) => {
      if (this.assetDocs.has(path)) return;
      this.assetDocs.set(path, { path, name, updatedAt: now, contentMd });
    };
    upsert("workspace/AGENTS.md", "AGENTS.md", WORKSPACE_DEFAULT_TEMPLATES["workspace/AGENTS.md"]);
    upsert("workspace/SOUL.md", "SOUL.md", WORKSPACE_DEFAULT_TEMPLATES["workspace/SOUL.md"]);
    upsert("workspace/TOOLS.md", "TOOLS.md", WORKSPACE_DEFAULT_TEMPLATES["workspace/TOOLS.md"]);
    upsert("workspace/IDENTITY.md", "IDENTITY.md", WORKSPACE_DEFAULT_TEMPLATES["workspace/IDENTITY.md"]);
    upsert("workspace/USER.md", "USER.md", WORKSPACE_DEFAULT_TEMPLATES["workspace/USER.md"]);
    upsert("workspace/HEARTBEAT.md", "HEARTBEAT.md", WORKSPACE_DEFAULT_TEMPLATES["workspace/HEARTBEAT.md"]);
    upsert("workspace/BOOTSTRAP.md", "BOOTSTRAP.md", WORKSPACE_DEFAULT_TEMPLATES["workspace/BOOTSTRAP.md"]);
    upsert("workspace/MEMORY.md", "MEMORY.md", WORKSPACE_DEFAULT_TEMPLATES["workspace/MEMORY.md"]);
    upsert(
      "workspace/.openclaw/workspace-state.json",
      "workspace-state.json",
      JSON.stringify(
        {
          workspaceId: workspace.id,
          bootstrapSeededAt: now,
          setupCompletedAt: null,
          templateVersion: WORKSPACE_TEMPLATE_VERSION,
          updatedAt: now
        },
        null,
        2
      )
    );
    this.applyWorkspaceTemplateMigration(workspace.id);
  }

  private applyWorkspaceTemplateMigration(workspaceId: string): void {
    const state = this.getWorkspaceRuntimeState(workspaceId);
    if (state.templateVersion === WORKSPACE_TEMPLATE_VERSION) return;
    const now = Date.now();
    for (const [path, content] of Object.entries(WORKSPACE_DEFAULT_TEMPLATES)) {
      this.assetDocs.set(path, {
        path,
        name: this.basename(path),
        contentMd: content,
        updatedAt: now
      });
    }
    state.templateVersion = WORKSPACE_TEMPLATE_VERSION;
    if (!state.bootstrapSeededAt) state.bootstrapSeededAt = now;
    this.saveWorkspaceRuntimeState({ ...state, updatedAt: now });
  }

  private refreshAllAgentAssets(): void {
    const channels = this.channels.dumpState().channels;
    for (const channel of channels) this.refreshAgentAssets(channel.id);
  }

  private refreshAgentAssets(channelId: string): void {
    const channel = this.channels.getChannel(channelId);
    const agentId = this.resolveAgentId(channelId);
    const now = Date.now();
    const modelsPath = `agents/${agentId}/agent/models.json`;
    const authProfilesPath = `agents/${agentId}/agent/auth-profiles.json`;
    const sessionsPath = `agents/${agentId}/sessions/sessions.json`;
    const channelSessionPath = `agents/${agentId}/sessions/${channel.id}/session.json`;
    const modelEntries = MODEL_RECOMMENDATIONS.flatMap((item) =>
      Object.values(item.tierMapping).map((binding) => ({
        providerId: binding.providerId,
        modelId: binding.modelId,
        displayName: binding.displayName ?? `${binding.providerId}/${binding.modelId}`
      }))
    );
    const dedupedModels = Array.from(new Map(modelEntries.map((m) => [`${m.providerId}:${m.modelId}`, m])).values());
    this.assetDocs.set(modelsPath, {
      path: modelsPath,
      name: "models.json",
      updatedAt: now,
      contentMd: JSON.stringify({ agentId, models: dedupedModels }, null, 2)
    });
    this.assetDocs.set(authProfilesPath, {
      path: authProfilesPath,
      name: "auth-profiles.json",
      updatedAt: now,
      contentMd: JSON.stringify(
        {
          agentId,
          providers: Object.entries(this.getProviderCredentialMap()).map(([providerId, credentialRef]) => ({
            providerId,
            credentialRef
          }))
        },
        null,
        2
      )
    });
    this.assetDocs.set(sessionsPath, {
      path: sessionsPath,
      name: "sessions.json",
      updatedAt: now,
      contentMd: JSON.stringify(
        {
          agentId,
          sessions: [
            {
              channelId: channel.id,
              channelName: channel.name,
              contextType: channel.contextType ?? "shared",
              messageCount: this.channels.getRecentMessages(channel.id, 1000).length,
              updatedAt: new Date(now).toISOString()
            }
          ]
        },
        null,
        2
      )
    });
    this.assetDocs.set(channelSessionPath, {
      path: channelSessionPath,
      name: "session.json",
      updatedAt: now,
      contentMd: JSON.stringify(
        {
          agentId,
          channelId: channel.id,
          channelName: channel.name,
          workspaceId: channel.workspaceId,
          contextType: channel.contextType ?? "shared",
          messageCount: this.channels.getRecentMessages(channel.id, 1000).length,
          lastMessages: this.channels.getRecentMessages(channel.id, 20),
          updatedAt: new Date(now).toISOString()
        },
        null,
        2
      )
    });
  }

  private refreshCronAssetDocs(): void {
    const now = Date.now();
    const jobs = this.cron.dumpJobs();
    this.assetDocs.set("cron/jobs.json", {
      path: "cron/jobs.json",
      name: "jobs.json",
      updatedAt: now,
      contentMd: JSON.stringify({ version: 1, jobs }, null, 2)
    });

    const executionRecords = this.cron.dumpExecutionRecords();
    const grouped = new Map<string, CronExecutionRecord[]>();
    for (const record of executionRecords) {
      const list = grouped.get(record.jobId) ?? [];
      list.push(record);
      grouped.set(record.jobId, list);
    }

    for (const path of [...this.assetDocs.keys()]) {
      if (!path.startsWith("cron/runs/") || !path.endsWith(".jsonl")) continue;
      const jobId = path.slice("cron/runs/".length, -".jsonl".length);
      if (!grouped.has(jobId)) this.assetDocs.delete(path);
    }

    for (const [jobId, rows] of grouped.entries()) {
      const recent = rows.slice(-CRON_RUN_DOC_MAX_LINES);
      this.assetDocs.set(`cron/runs/${jobId}.jsonl`, {
        path: `cron/runs/${jobId}.jsonl`,
        name: `${jobId}.jsonl`,
        updatedAt: now,
        contentMd: recent.map((row) => JSON.stringify(row)).join("\n")
      });
    }
  }

  private upsertAssetDoc(path: string, name: string, contentMd: string): void {
    this.assetDocs.set(path, {
      path,
      name,
      contentMd,
      updatedAt: Date.now()
    });
  }

  private isToolReadablePath(path: string): boolean {
    return path.startsWith("workspace/") || path.startsWith(`agents/${DEFAULT_AGENT_ID}/sessions/`) || path.startsWith("cron/");
  }

  private isToolWritablePath(path: string): boolean {
    return path.startsWith("workspace/") && !path.startsWith("workspace/.openclaw/");
  }

  private parseWorkspaceEditIntent(
    request: WorkspaceEditRequest,
  ): { path: WorkspaceEditableFile; mode: WorkspaceEditMode; content: string; summary: string } | null {
    const text = request.text.trim();
    const normalized = text.toLowerCase();
    if (!text) return null;
    if (/(确认|confirm|yes)/i.test(normalized) && this.pendingWorkspaceEdits.has(request.channelId)) {
      return this.pendingWorkspaceEdits.get(request.channelId) ?? null;
    }

    const path = this.resolveWorkspaceTargetPath(text);
    if (!path) return null;
    if (request.actorRole !== "developer" && path === "workspace/BOOTSTRAP.md") return null;

    const content = this.extractEditContent(text);
    if (!content) return null;

    const isAppend = /(追加|append|添加|add|补充|写入)/i.test(text);
    const mode: WorkspaceEditMode = isAppend ? "append" : "replace";
    const summary = `${mode === "append" ? "追加" : "更新"} ${path}`;

    return { path, mode, content, summary };
  }

  private resolveWorkspaceTargetPath(text: string): WorkspaceEditableFile | null {
    const patterns: Array<[RegExp, WorkspaceEditableFile]> = [
      [/(AGENTS\.md|agents|工作空间规则)/i, "workspace/AGENTS.md"],
      [/(SOUL\.md|soul|灵魂)/i, "workspace/SOUL.md"],
      [/(TOOLS\.md|tools|工具配置)/i, "workspace/TOOLS.md"],
      [/(IDENTITY\.md|identity|身份)/i, "workspace/IDENTITY.md"],
      [/(USER\.md|user|用户画像)/i, "workspace/USER.md"],
      [/(HEARTBEAT\.md|heartbeat|心跳)/i, "workspace/HEARTBEAT.md"],
      [/(MEMORY\.md|memory|长期记忆)/i, "workspace/MEMORY.md"],
      [/(BOOTSTRAP\.md|bootstrap)/i, "workspace/BOOTSTRAP.md"]
    ];
    for (const [pattern, path] of patterns) {
      if (pattern.test(text)) return path;
    }
    return null;
  }

  private extractEditContent(text: string): string {
    const codeBlock = text.match(/```[\w-]*\n([\s\S]*?)```/);
    if (codeBlock?.[1]?.trim()) return codeBlock[1].trim();
    const quoted = text.match(/["“](.+?)["”]/s);
    if (quoted?.[1]?.trim()) return quoted[1].trim();
    const splitKeywords = ["改成", "改为", "更新为", "替换为", "追加", "append", "add"];
    for (const keyword of splitKeywords) {
      const idx = text.indexOf(keyword);
      if (idx >= 0) {
        const tail = text.slice(idx + keyword.length).trim();
        if (tail) return tail;
      }
    }
    return "";
  }

  private commitWorkspaceEdit(edit: { path: WorkspaceEditableFile; mode: WorkspaceEditMode; content: string; summary: string }): void {
    const existing = this.assetDocs.get(edit.path)?.contentMd ?? "";
    const next =
      edit.mode === "append"
        ? `${existing.trimEnd()}\n\n${edit.content.trim()}\n`
        : edit.content.trim();
    this.upsertAssetDoc(edit.path, this.basename(edit.path), next);
    if (edit.path === "workspace/SOUL.md") {
      const channelIds = this.channels.dumpState().channels.map((c) => c.id);
      for (const channelId of channelIds) this.promptReportsByChannel.delete(channelId);
    }
    void this.persistNow();
  }

  private basename(path: string): string {
    const idx = path.lastIndexOf("/");
    return idx >= 0 ? path.slice(idx + 1) : path;
  }

  private resolveAgentId(_channelId: string): string {
    return DEFAULT_AGENT_ID;
  }

  private ensureWorkspaceMainChannelContextType(): void {
    const state = this.channels.dumpState();
    const channelsByWorkspace = new Map<string, typeof state.channels>();
    for (const channel of state.channels) {
      const list = channelsByWorkspace.get(channel.workspaceId) ?? [];
      list.push(channel);
      channelsByWorkspace.set(channel.workspaceId, list);
    }
    for (const channels of channelsByWorkspace.values()) {
      const hasMain = channels.some((channel) => channel.contextType === "main");
      if (!hasMain && channels.length) {
        channels[0].contextType = "main";
      }
      for (const channel of channels) {
        if (!channel.contextType) channel.contextType = "shared";
      }
    }
  }
}

const DEFAULT_AGENT_ID = "main";
const WORKSPACE_TEMPLATE_VERSION = "openclaw-v3-defaults";
const CONTEXT_PER_FILE_MAX_CHARS = 4_000;
const CONTEXT_TOTAL_MAX_CHARS = 20_000;
const BOOTSTRAP_MAX_CHARS = 2_500;
const HEARTBEAT_MAX_CHARS = 1_200;
const CRON_RUN_DOC_MAX_LINES = 120;

interface ContextBuildItem {
  path: string;
  content: string;
  truncated: boolean;
}

interface WorkspaceRuntimeState {
  workspaceId: string;
  bootstrapSeededAt?: number;
  setupCompletedAt?: number | null;
  templateVersion?: string;
  latestPromptReportId?: string;
  lastChannelId?: string;
  lastChannelName?: string;
  updatedAt?: number;
}

const USER_VISIBLE_ASSET_PATHS = new Set<string>([
  "workspace/AGENTS.md",
  "workspace/SOUL.md",
  "workspace/TOOLS.md",
  "workspace/IDENTITY.md",
  "workspace/USER.md",
  "workspace/HEARTBEAT.md",
  "workspace/MEMORY.md"
]);
