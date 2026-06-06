import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, ToastAndroid, useColorScheme } from "react-native";
import { MobileClawKernel } from "../../src/app/mobileclaw-kernel";
import { MODEL_RECOMMENDATIONS } from "../../src/core/gateway/model-recommendations";
import { GeminiAdapter } from "../../src/core/gateway/gemini-adapter";
import { MiniMaxAnthropicAdapter } from "../../src/core/gateway/minimax-anthropic-adapter";
import { OpenAICompatibleAdapter } from "../../src/core/gateway/openai-compatible-adapter";
import { uid } from "../../src/core/utils/id";
import { appLogger, type AppLogEntry } from "../../src/core/observability/app-logger";
import {
  PROVIDER_SPECS,
  getProviderSpec,
  listVisibleProviderSpecs
} from "../../src/core/gateway/provider-registry";
import { getRuntimeTimeContext } from "../../src/core/runtime/time-service";
import type {
  AppModelConfig,
  AssetDoc,
  AssetListScope,
  AssetTreeNode,
  AssetViewerRole,
  AuthMode,
  Message,
  CronApprovalRequest,
  CronPermissionGrant,
  PermissionGrant,
  PermissionRequest,
  ModelProvider,
  ModelSession,
  OAuthClientConfig,
  OAuthParamSource,
  OAuthWizardSession,
  ProviderOAuthPreset,
  ResolvedModel,
  ReActRunState,
  ThemePreference,
  ToolCallRequest,
  ToolExecutionRecord,
  WorkspaceConfig
} from "../../src/types/contracts";
import type { CronJob } from "../../src/core/cron/types";
import type { CronExecutionRecord } from "../../src/core/cron/types";
import {
  exchangeCodeForToken,
  pollMiniMaxDeviceToken,
  startMiniMaxDeviceOAuth,
  startOAuth,
  waitForOAuthRedirect
} from "./oauth/oauth-flow";
import { createNativePersistence } from "./persistence/native-state-store";
import { createNativePreferencesStore } from "./persistence/native-preferences-store";
import { resolveMaterialTheme } from "./theme/material";
import {
  parseNaturalReminderCommand,
  parseStructuredCronToolCalls,
  parseUserCronCommand,
  parseUserRemindCommand,
  parseUserSystemToolCommand
} from "./agent/tool-call-interpreter";
import { resolveReminderAtMs, validateAtMs } from "./agent/reminder-time-resolver";

const providers: ModelProvider[] = [
  ...PROVIDER_SPECS.map((spec) => ({
    id: spec.id,
    type: spec.type,
    authMode: spec.authModes[0] ?? "BYOK",
    authModes: spec.authModes,
    capabilities: { supportsChat: true, supportsEmbedding: true, supportsStream: true }
  }))
];

const visibleProviders = [
  ...listVisibleProviderSpecs().map((spec) => ({
    id: spec.id,
    label: spec.displayName
  }))
] as const;

const oauthPresets: ProviderOAuthPreset[] = [
  ...PROVIDER_SPECS
    .filter((spec) => spec.oauthPreset)
    .map((spec) => ({
      id: `${spec.id}-default`,
      providerId: spec.id,
      label: `${spec.displayName} Preset`,
      config: spec.oauthPreset!
    }))
];

const ws: WorkspaceConfig = {
  id: "ws_mobile",
  name: "MobileClaw",
  defaultModel: "small",
  systemPrompt: "You are MobileClaw mobile assistant.",
  memoryPolicy: "LOCAL_ONLY",
  tierMapping: MODEL_RECOMMENDATIONS[0].tierMapping,
  displayModelNameStrategy: "display_name"
};

const defaultModelCatalog: AppModelConfig[] = [
  {
    key: "openai:gpt-4o-mini",
    providerId: "openai",
    modelId: "gpt-4o-mini",
    displayName: "OpenAI / gpt-4o-mini",
    enabled: true
  },
  {
    key: "openai:gpt-4.1-mini",
    providerId: "openai",
    modelId: "gpt-4.1-mini",
    displayName: "OpenAI / gpt-4.1-mini",
    enabled: true
  },
  {
    key: "minimax:MiniMax-M2.5",
    providerId: "minimax",
    modelId: "MiniMax-M2.5",
    displayName: "MiniMax / MiniMax-M2.5",
    enabled: true
  },
  {
    key: "minimax:MiniMax-M2.7",
    providerId: "minimax",
    modelId: "MiniMax-M2.7",
    displayName: "MiniMax / MiniMax-M2.7",
    enabled: true
  }
];

const minimaxOAuthPresets = {
  global: {
    clientId: "78257093-7e40-4613-99e0-527b14b39113",
    authEndpoint: "https://api.minimax.io/oauth/code",
    tokenEndpoint: "https://api.minimax.io/oauth/token",
    apiBaseUrl: "https://api.minimax.io/anthropic",
    scopes: ["group_id", "profile", "model.completion"]
  },
  cn: {
    clientId: "78257093-7e40-4613-99e0-527b14b39113",
    authEndpoint: "https://api.minimaxi.com/oauth/code",
    tokenEndpoint: "https://api.minimaxi.com/oauth/token",
    apiBaseUrl: "https://api.minimaxi.com/anthropic",
    scopes: ["group_id", "profile", "model.completion"]
  }
} as const;

function inferMiniMaxRegionFromBase(baseUrl?: string): "global" | "cn" {
  if (!baseUrl) return "global";
  return /minimaxi\.com/i.test(baseUrl) ? "cn" : "global";
}

function hasReminderIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /(提醒|定时|闹钟|稍后|分钟后|小时后|tomorrow|remind me|later)/i.test(normalized);
}

function hasReminderCommitment(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /(我会提醒|我来提醒|稍后提醒你|已为你设置提醒|i('| )ll remind|i will remind|reminder set)/i.test(normalized);
}

function formatCronScheduleLine(job: CronJob): string {
  if (job.schedule.kind === "cron") {
    return `Cron(${job.schedule.expr}${job.schedule.tz ? `, ${job.schedule.tz}` : ""})`;
  }
  if (job.schedule.kind === "every") {
    return `every ${Math.round(job.schedule.everyMs / 1000)}s`;
  }
  return `at ${new Date(job.schedule.atMs).toLocaleString()}`;
}

function parseScheduleFromPayload(payload: Record<string, unknown>) {
  const cronExpr = typeof payload.cronExpr === "string" ? payload.cronExpr.trim() : "";
  if (cronExpr) {
    return {
      kind: "cron" as const,
      expr: cronExpr,
      tz: typeof payload.cronTz === "string" ? payload.cronTz : undefined,
      staggerMs: Number.isFinite(Number(payload.staggerMs)) ? Math.max(0, Number(payload.staggerMs)) : undefined
    };
  }
  const everySec = Number(payload.everySec ?? 0);
  if (everySec > 0) {
    return { kind: "every" as const, everyMs: Math.max(1000, Math.floor(everySec * 1000)) };
  }
  const rawAtMs = Number(payload.resolvedAtMs ?? payload.atMs ?? 0);
  const atMs = rawAtMs > 0 && rawAtMs < 1_000_000_000_000 ? Math.floor(rawAtMs * 1000) : rawAtMs;
  return { kind: "at" as const, atMs: atMs > 0 ? atMs : Date.now() + 60_000 };
}

function summarizeApprovalRequest(row: CronApprovalRequest): string {
  if (row.type === "add") {
    const name = String(row.payload.name ?? "未命名任务");
    if (typeof row.payload.cronExpr === "string") return `待审批：创建任务「${name}」，Cron=${row.payload.cronExpr}`;
    if (Number(row.payload.everySec) > 0) return `待审批：创建任务「${name}」，每 ${Number(row.payload.everySec)} 秒`;
    const resolvedAtMs = Number(row.payload.resolvedAtMs ?? row.payload.atMs);
    if (resolvedAtMs > 0) return `待审批：创建任务「${name}」，时间=${new Date(resolvedAtMs).toLocaleString()}`;
    return `待审批：创建任务「${name}」`;
  }
  if (row.type === "update") return `待审批：更新任务 ${String(row.payload.jobId ?? "-")}`;
  if (row.type === "remove") return `待审批：删除任务 ${String(row.payload.jobId ?? "-")}`;
  const count = Number(row.payload.jobCount ?? 0);
  return `待审批：删除全部任务（共 ${count} 个）`;
}

function summarizeApprovalAction(row: CronApprovalRequest): string {
  if (row.type === "add") {
    const name = String(row.payload.name ?? "未命名任务");
    if (typeof row.payload.cronExpr === "string") return `创建任务「${name}」，Cron=${row.payload.cronExpr}`;
    if (Number(row.payload.everySec) > 0) return `创建任务「${name}」，每 ${Number(row.payload.everySec)} 秒`;
    const resolvedAtMs = Number(row.payload.resolvedAtMs ?? row.payload.atMs);
    if (resolvedAtMs > 0) return `创建任务「${name}」，时间=${new Date(resolvedAtMs).toLocaleString()}`;
    return `创建任务「${name}」`;
  }
  if (row.type === "update") return `更新任务 ${String(row.payload.jobId ?? "-")}`;
  if (row.type === "remove") return `删除任务 ${String(row.payload.jobId ?? "-")}`;
  const count = Number(row.payload.jobCount ?? 0);
  return `删除全部任务（共 ${count} 个）`;
}

function formatToolEventText(input: {
  tool: string;
  status: "running" | "ok" | "error" | "blocked" | "aborted";
  summary: string;
  details?: string;
}): string {
  const statusMap = {
    running: "执行中",
    ok: "成功",
    error: "失败",
    blocked: "已拦截",
    aborted: "已停止"
  } as const;
  const head = `TOOL_EVENT | ${input.tool} | ${statusMap[input.status]} | ${input.summary}`;
  return input.details ? `${head}\n${input.details}` : head;
}

function parseExecCommandPayload(raw: string): { base: string; arg?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { base: "" };
  const [first, ...rest] = trimmed.split(/\s+/);
  return { base: (first ?? "").toLowerCase(), arg: rest.join(" ").trim() || undefined };
}

type ToolCallVerifierDecision = {
  ok: boolean;
  result: {
    ok: boolean;
    tool: ToolCallRequest["tool"];
    code?: string;
    message?: string;
  };
};

function verifyToolCall(call: ToolCallRequest): ToolCallVerifierDecision {
  if (!ENABLED_TOOLS.has(call.tool)) {
    return {
      ok: false,
      result: {
        ok: false,
        tool: call.tool,
        code: "tool_disabled",
        message: `工具 ${call.tool} 当前不可用`
      }
    };
  }

  const payload = call.payload ?? {};
  if (call.tool === "fs.read" || call.tool === "fs.list") {
    const path = String(payload.path ?? "").trim();
    if (!path) {
      return {
        ok: false,
        result: {
          ok: false,
          tool: call.tool,
          code: "invalid_params",
          message: `${call.tool} 缺少 path 参数`
        }
      };
    }
  }
  if (call.tool === "fs.write") {
    const path = String(payload.path ?? "").trim();
    if (!path) {
      return {
        ok: false,
        result: {
          ok: false,
          tool: call.tool,
          code: "invalid_params",
          message: "fs.write 缺少 path 参数"
        }
      };
    }
    if (!("content" in payload)) {
      return {
        ok: false,
        result: {
          ok: false,
          tool: call.tool,
          code: "invalid_params",
          message: "fs.write 缺少 content 参数"
        }
      };
    }
  }
  if (call.tool === "exec.run") {
    const command = String(payload.command ?? "").trim();
    if (!command) {
      return {
        ok: false,
        result: {
          ok: false,
          tool: call.tool,
          code: "invalid_params",
          message: "exec.run 缺少 command 参数"
        }
      };
    }
  }
  if (call.tool === "cron.update" || call.tool === "cron.remove" || call.tool === "cron.run") {
    const jobId = String(payload.jobId ?? "").trim();
    if (!jobId) {
      return {
        ok: false,
        result: {
          ok: false,
          tool: call.tool,
          code: "invalid_params",
          message: `${call.tool} 缺少 jobId 参数`
        }
      };
    }
  }
  if (call.tool === "cron.add") {
    const hasAt = Number.isFinite(Number(payload.atMs));
    const hasEvery = Number(payload.everySec) > 0;
    const hasCron = typeof payload.cronExpr === "string" && payload.cronExpr.trim().length > 0;
    if (!hasAt && !hasEvery && !hasCron) {
      return {
        ok: false,
        result: {
          ok: false,
          tool: call.tool,
          code: "invalid_params",
          message: "cron.add 缺少有效时间参数（atMs/everySec/cronExpr）"
        }
      };
    }
  }

  return {
    ok: true,
    result: {
      ok: true,
      tool: call.tool
    }
  };
}

function summarizeToolContextLines(lines: string[]): string | null {
  if (!lines.length) return null;
  const timeLine = lines.find((line) => line.startsWith("time.now "));
  if (timeLine) {
    const jsonPart = timeLine.slice("time.now ".length).trim();
    try {
      const payload = JSON.parse(jsonPart) as { localTimeText?: string; timezone?: string };
      if (payload.localTimeText) return `当前时间是 ${payload.localTimeText}${payload.timezone ? `（${payload.timezone}）` : ""}。`;
    } catch {
      // ignore and fallback
    }
  }

  const fsListMeta = lines.find((line) => line.startsWith("fs.list.meta "));
  if (fsListMeta) {
    const payloadPart = fsListMeta.slice("fs.list.meta ".length).trim();
    try {
      const payload = JSON.parse(payloadPart) as { path?: string; count?: number; truncated?: boolean };
      const entries = lines
        .filter((line) => line.startsWith("dir ") || line.startsWith("file "))
        .slice(0, 12)
        .map((line) => line.replace(/^dir /, "📁 ").replace(/^file /, "📄 "));
      if ((payload.count ?? entries.length) === 0) return `目录 ${payload.path ?? "."} 当前为空。`;
      const title = `目录 ${payload.path ?? "."} 共 ${payload.count ?? entries.length} 项：`;
      return [title, ...entries, payload.truncated ? "...(已截断)" : ""].filter(Boolean).join("\n");
    } catch {
      // ignore and fallback
    }
  }

  const fsListError = lines.find((line) => line.startsWith("fs.list error="));
  if (fsListError) {
    const path = /path=([^\s]+)$/.exec(fsListError)?.[1] ?? ".";
    appLogger.info({
      module: "tool",
      event: "fs_list_error_summarized",
      message: "fs.list 错误已转换为可读总结",
      context: { path, raw: fsListError }
    });
    if (/path_not_allowed/i.test(fsListError)) return `目录 ${path} 不可读取（路径权限受限）。`;
    if (/asset_not_found/i.test(fsListError)) return `目录 ${path} 不存在。`;
    return `读取目录 ${path} 失败，请重试或检查路径。`;
  }

  const fsReadMeta = lines.find((line) => line.startsWith("fs.read.meta "));
  if (fsReadMeta) return "文件内容已读取完成（基于工具真值）。";

  const cronStatus = lines.find((line) => line.startsWith("cron.status "));
  if (cronStatus) return `定时任务状态：${cronStatus.replace(/^cron\.status\s*/, "")}`;

  const cronList = lines.find((line) => line.startsWith("cron.list total="));
  if (cronList) {
    const items = lines.filter((line) => line.startsWith("- ")).slice(0, 10);
    return [`当前定时任务：${cronList.replace(/^cron\.list\s*/, "")}`, ...items].join("\n");
  }

  return null;
}

function sanitizeAssistantText(raw: string): { text: string; normalizedFromToolCall: boolean } {
  let text = raw ?? "";
  const before = text;
  text = text.replace(/<(?:[a-z0-9_-]+:)?tool_call[^>]*>[\s\S]*?<\/(?:[a-z0-9_-]+:)?tool_call>/gi, "");
  text = text.replace(/<invoke\s+name=["'][^"']+["'][^>]*>[\s\S]*?<\/invoke>/gi, "");
  text = text.replace(/<minimax:tool_call[^>]*\/?>/gi, "");
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  text = text.replace(/```(?:tool_call|toolcall|json)?\s*[\s\S]*?```/gi, "");
  text = text.replace(/\[Tool_Call\][^\n]*/gi, "");
  text = text.replace(/^\s*tool[_\s-]?call[:：].*$/gim, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return {
    text,
    normalizedFromToolCall: before.trim() !== text.trim()
  };
}

const defaultWizard: OAuthWizardSession = {
  step: "provider",
  parameterSource: "preset",
  status: "",
  error: ""
};

function createDefaultWizard(): OAuthWizardSession {
  return { ...defaultWizard };
}

export type DrawerTab = "chat" | "models" | "onboard" | "sessions" | "tasks" | "security" | "internal" | "logs" | "settings";
type SendTimeoutLevel = "none" | "slow";
type ProviderSetupStatus = "unconfigured" | "pending_commit" | "configured";
type CronApprovalMode = "once" | "always_for_job_update";
type DeleteSessionResult = "ok" | "blocked" | "switchedTo";

const DEFAULT_AGENT_ID = "main";
const ENABLED_TOOLS = new Set<ToolCallRequest["tool"]>([
  "time.now",
  "fs.read",
  "fs.list",
  "fs.write",
  "exec.run",
  "cron.add",
  "cron.update",
  "cron.remove",
  "cron.remove_all",
  "cron.run",
  "cron.status",
  "cron.list"
]);
const TOOL_LOOP_BUDGET_PRESETS = {
  standard: { maxToolTurns: 16, timeoutMs: 600_000 },
  wide: { maxToolTurns: 24, timeoutMs: 900_000 }
} as const;
const ACTIVE_TOOL_LOOP_BUDGET = TOOL_LOOP_BUDGET_PRESETS.wide;

function sortMessagesStable(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    const seqA = a.seq ?? 0;
    const seqB = b.seq ?? 0;
    if (seqA !== seqB) return seqA - seqB;
    return a.id.localeCompare(b.id);
  });
}

function cloneConfig(config: OAuthClientConfig): OAuthClientConfig {
  return {
    ...config,
    scopes: [...config.scopes],
    extraAuthParams: config.extraAuthParams ? { ...config.extraAuthParams } : undefined
  };
}

export function useMobileClaw() {
  const persistence = useMemo(() => createNativePersistence(), []);
  const preferences = useMemo(() => createNativePreferencesStore(), []);
  const kernel = useMemo(() => {
    const instance = new MobileClawKernel(providers, { persistence });
    const openaiProvider = providers.find((p) => p.id === "openai");
    const minimaxProvider = providers.find((p) => p.id === "minimax");
    const googleProvider = providers.find((p) => p.id === "google");
    if (openaiProvider) {
      instance.registerProviderAdapter(
        new OpenAICompatibleAdapter(
          openaiProvider,
          instance.credentials,
          getProviderSpec("openai")?.defaultApiBase ?? "https://api.openai.com/v1"
        )
      );
    }
    if (minimaxProvider) {
      instance.registerProviderAdapter(
        new MiniMaxAnthropicAdapter(
          minimaxProvider,
          instance.credentials,
          getProviderSpec("minimax")?.defaultApiBase ?? "https://api.minimax.io/anthropic"
        )
      );
    }
    if (googleProvider) {
      instance.registerProviderAdapter(new GeminiAdapter(googleProvider, instance.credentials));
    }
    return instance;
  }, [persistence]);
  const systemScheme = useColorScheme();

  const [activeTab, setActiveTab] = useState<DrawerTab>("chat");
  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [lastError, setLastError] = useState<string>("");
  const [resolvedModel, setResolvedModel] = useState<ResolvedModel | null>(null);
  const [providerCredentialMap, setProviderCredentialMap] = useState<Record<string, string>>({});
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(true);
  const [notificationVibrationEnabled, setNotificationVibrationEnabled] = useState(true);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<AppModelConfig[]>(defaultModelCatalog);
  const [channelModelMap, setChannelModelMap] = useState<Record<string, string>>({});
  const [providerApiBaseMap, setProviderApiBaseMap] = useState<Record<string, string>>({});
  const [oauthWizard, setOauthWizard] = useState<OAuthWizardSession>(() => createDefaultWizard());
  const [oauthWizardBusy, setOauthWizardBusy] = useState(false);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronExecutionRecords, setCronExecutionRecords] = useState<CronExecutionRecord[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<CronApprovalRequest[]>([]);
  const [cronPermissionGrants, setCronPermissionGrants] = useState<CronPermissionGrant[]>([]);
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PermissionRequest[]>([]);
  const [permissionGrants, setPermissionGrants] = useState<PermissionGrant[]>([]);
  const [toolExecutionRecords, setToolExecutionRecords] = useState<ToolExecutionRecord[]>([]);
  const [approvalBannerText, setApprovalBannerText] = useState("");
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isToolLooping, setIsToolLooping] = useState(false);
  const [reactRunState, setReactRunState] = useState<ReActRunState | null>(null);
  const [collapsedFlowGroupIds, setCollapsedFlowGroupIds] = useState<string[]>([]);
  const [sendStartedAt, setSendStartedAt] = useState<number | null>(null);
  const [sendTimeoutLevel, setSendTimeoutLevel] = useState<SendTimeoutLevel>("none");
  const [sendTimeoutDismissed, setSendTimeoutDismissed] = useState(false);
  const [logs, setLogs] = useState<AppLogEntry[]>(() => appLogger.list());
  const oauthRunRef = useRef<{ id: number; cancelled: boolean } | null>(null);
  const toolLoopAbortControllerRef = useRef<AbortController | null>(null);
  const toolLoopStoppedByUserRef = useRef(false);
  const toolLoopRunIdRef = useRef<string | null>(null);
  const currentFlowRunIdRef = useRef<string | null>(null);
  const lastCronRecordRef = useRef<string | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const pendingCountRef = useRef(0);
  const minimaxByokFailureByRegionRef = useRef<Record<"global" | "cn", number>>({
    global: 0,
    cn: 0
  });

  const theme = useMemo(() => resolveMaterialTheme(themePreference, systemScheme), [themePreference, systemScheme]);

  const normalizeCatalog = (catalog: AppModelConfig[]): AppModelConfig[] =>
    catalog.map((m) => {
      if (m.providerId !== "minimax") return m;
      const modelId = m.modelId.replace(/^minimax-portal\//, "");
      return {
        ...m,
        modelId,
        key: `${m.providerId}:${modelId}`,
        displayName: m.displayName.includes("minimax-portal/") ? `MiniMax / ${modelId}` : m.displayName
      };
    });

  const normalizeChannelModelMap = (map: Record<string, string>): Record<string, string> => {
    const next: Record<string, string> = {};
    for (const [channel, modelKey] of Object.entries(map)) {
      next[channel] = modelKey.replace(/^minimax:minimax-portal\//, "minimax:");
    }
    return next;
  };

  useEffect(() => {
    const unsub = appLogger.subscribe(() => setLogs(appLogger.list()));
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!isSending || !sendStartedAt) {
      setSendTimeoutLevel("none");
      return;
    }
    const timer = setInterval(() => {
      const elapsed = Date.now() - sendStartedAt;
      setSendTimeoutLevel(elapsed >= 20_000 ? "slow" : "none");
    }, 1000);
    return () => clearInterval(timer);
  }, [isSending, sendStartedAt]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      const pendingTotal = pendingApprovals.length + pendingPermissionRequests.length;
      if (nextState === "active" && pendingTotal > 0 && notificationsEnabled) {
        const text = `有 ${pendingTotal} 条待审批请求`;
        setApprovalBannerText(text);
        if (Platform.OS === "android") ToastAndroid.show(text, ToastAndroid.SHORT);
      }
    });
    return () => sub.remove();
  }, [pendingApprovals.length, pendingPermissionRequests.length, notificationsEnabled]);

  useEffect(() => {
    if (!notificationsEnabled) return;
    const prev = pendingCountRef.current;
    const next = pendingApprovals.length + pendingPermissionRequests.length;
    if (next <= prev) {
      pendingCountRef.current = next;
      if (next === 0) setApprovalBannerText("");
      return;
    }
    const text = `有 ${next} 条待审批请求`;
    appLogger.info({
      module: "cron",
      event: "cron_approval_pending",
      message: "发现待审批请求",
      context: { pendingCount: next, appState: appStateRef.current }
    });
    setApprovalBannerText(text);
    if (appStateRef.current === "active") {
      if (Platform.OS === "android") ToastAndroid.show(text, ToastAndroid.SHORT);
    } else {
      appLogger.info({
        module: "notification",
        event: "cron_approval_pending_background",
        message: "应用在后台，记录本地通知占位事件",
        context: { pendingCount: next }
      });
    }
    pendingCountRef.current = next;
  }, [pendingApprovals, pendingPermissionRequests, notificationsEnabled]);

  useEffect(() => {
    let mounted = true;
    const setup = async () => {
      appLogger.info({ module: "app", event: "startup", message: "初始化 MobileClaw 状态" });
      await kernel.loadPersistedState();
      const pref = await preferences.load();

      // Startup self-heal: always ensure workspace exists and has at least one channel.
      const created = kernel.ensureWorkspaceAndDefaultChannel(ws, "General");

      if (!mounted) return;

      setThemePreferenceState(pref.themePreference);
      setNotificationsEnabled(pref.notificationsEnabled ?? true);
      setNotificationSoundEnabled(pref.notificationSoundEnabled ?? true);
      setNotificationVibrationEnabled(pref.notificationVibrationEnabled ?? true);
      setDeveloperModeEnabled(pref.developerModeEnabled ?? false);
      const normalizedCatalog = normalizeCatalog(pref.modelCatalog?.length ? pref.modelCatalog : defaultModelCatalog);
      const normalizedChannelModelMap = normalizeChannelModelMap(pref.channelModelMap ?? {});
      setModelCatalog(normalizedCatalog);
      setChannelModelMap(normalizedChannelModelMap);
      setProviderApiBaseMap(pref.providerApiBaseMap ?? {});
      setPendingApprovals(pref.pendingCronApprovals ?? []);
      pendingCountRef.current = (pref.pendingCronApprovals?.length ?? 0) + (pref.pendingPermissionRequests?.length ?? 0);
      setCronPermissionGrants(pref.cronPermissionGrants ?? []);
      setPendingPermissionRequests(pref.pendingPermissionRequests ?? []);
      setPermissionGrants(pref.permissionGrants ?? []);
      setSessionId(created);
      setMessages(sortMessagesStable(kernel.getMessages(created)));
      const credentialMap = kernel.getProviderCredentialMap();
      setProviderCredentialMap(credentialMap);
      const hasConfiguredProvider = visibleProviders.some((provider) => Boolean(credentialMap[provider.id]));
      setOnboardingRequired(!hasConfiguredProvider);
      if (!hasConfiguredProvider) setActiveTab("models");
      const initialCatalog = normalizedCatalog;
      const mappedModelKey = normalizedChannelModelMap[created];
      const selectedModel = initialCatalog.find((m) => m.enabled && Boolean(credentialMap[m.providerId]) && m.key === mappedModelKey)
        ?? initialCatalog.find((m) => m.enabled && Boolean(credentialMap[m.providerId]))
        ?? null;
      setResolvedModel(
        selectedModel
          ? {
              providerId: selectedModel.providerId,
              modelId: selectedModel.modelId,
              displayName: selectedModel.displayName
            }
          : (kernel.getChannelContext(created).resolvedModel ?? null)
      );
      setCronJobs(kernel.listCronJobs(true));
      setCronExecutionRecords(kernel.listCronExecutionRecords(100));
      setReady(true);
      appLogger.info({ module: "app", event: "startup_ready", message: "初始化完成" });
    };
    void setup().catch((err) => {
      if (!mounted) return;
      setLastError(err instanceof Error ? err.message : String(err));
      appLogger.fatal({
        module: "app",
        event: "startup_failed",
        message: "初始化失败",
        error: err instanceof Error ? err.message : String(err)
      });
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [kernel, preferences]);

  const refreshChannelSnapshot = (nextChannelId: string): Message[] => {
    const snapshot = sortMessagesStable(kernel.getMessages(nextChannelId));
    setMessages(snapshot);
    const selected = resolveSelectedModel(nextChannelId);
    setResolvedModel(
      selected
        ? {
            providerId: selected.providerId,
            modelId: selected.modelId,
            displayName: selected.displayName
          }
        : (kernel.getChannelContext(nextChannelId).resolvedModel ?? null)
    );
    return snapshot;
  };

  const refreshSessionSnapshot = (targetSessionId?: string): Message[] => {
    const sid = targetSessionId ?? sessionId;
    if (!sid) return [];
    return refreshChannelSnapshot(sid);
  };

  const appendAssistantNotice = (content: string, targetSessionId?: string, flowRunId?: string) => {
    const sid = targetSessionId ?? sessionId;
    if (!sid) return;
    kernel.appendSystemMessage(sid, content, flowRunId ?? currentFlowRunIdRef.current ?? undefined);
    if (sid === sessionId) refreshChannelSnapshot(sid);
    appLogger.debug({
      module: "chat",
      event: "message_order_reconciled",
      message: "系统提示通过内核队列写入，避免消息乱序",
      context: { sessionId: sid }
    });
  };

  const appendToolEvent = (
    tool: string,
    status: "running" | "ok" | "error" | "blocked" | "aborted",
    summary: string,
    targetSessionId?: string,
    details?: string
  ) => {
    appendAssistantNotice(formatToolEventText({ tool, status, summary, details }), targetSessionId, currentFlowRunIdRef.current ?? undefined);
  };

  const stopToolLoop = () => {
    if (!isToolLooping) return;
    toolLoopStoppedByUserRef.current = true;
    toolLoopAbortControllerRef.current?.abort();
    setIsToolLooping(false);
    setReactRunState((prev) => (prev ? { ...prev, stage: "done", stopReason: "aborted" } : prev));
    appendAssistantNotice("系统提示：已停止本轮工具循环。");
    appLogger.warn({
      module: "cron",
      event: "tool_loop_stopped_by_user",
      message: "用户主动停止工具循环",
      context: { sessionId, runId: toolLoopRunIdRef.current }
    });
  };

  const persistPreferences = async (
    patch: Partial<{
      themePreference: ThemePreference;
      notificationsEnabled: boolean;
      notificationSoundEnabled: boolean;
      notificationVibrationEnabled: boolean;
      developerModeEnabled: boolean;
      modelCatalog: AppModelConfig[];
      channelModelMap: Record<string, string>;
      providerApiBaseMap: Record<string, string>;
      pendingCronApprovals: CronApprovalRequest[];
      cronPermissionGrants: CronPermissionGrant[];
      pendingPermissionRequests: PermissionRequest[];
      permissionGrants: PermissionGrant[];
    }>
  ) => {
    await preferences.save({
      themePreference: patch.themePreference ?? themePreference,
      notificationsEnabled: patch.notificationsEnabled ?? notificationsEnabled,
      notificationSoundEnabled: patch.notificationSoundEnabled ?? notificationSoundEnabled,
      notificationVibrationEnabled: patch.notificationVibrationEnabled ?? notificationVibrationEnabled,
      developerModeEnabled: patch.developerModeEnabled ?? developerModeEnabled,
      modelCatalog: patch.modelCatalog ?? modelCatalog,
      channelModelMap: patch.channelModelMap ?? channelModelMap,
      providerApiBaseMap: patch.providerApiBaseMap ?? providerApiBaseMap,
      pendingCronApprovals: patch.pendingCronApprovals ?? pendingApprovals,
      cronPermissionGrants: patch.cronPermissionGrants ?? cronPermissionGrants,
      pendingPermissionRequests: patch.pendingPermissionRequests ?? pendingPermissionRequests,
      permissionGrants: patch.permissionGrants ?? permissionGrants
    });
  };

  const listEnabledModels = () => modelCatalog.filter((m) => m.enabled && Boolean(providerCredentialMap[m.providerId]));

  const resolveSelectedModel = (targetChannelId: string): AppModelConfig | null => {
    const enabled = listEnabledModels();
    if (!enabled.length) return null;
    const picked = channelModelMap[targetChannelId];
    if (picked) {
      const found = enabled.find((m) => m.key === picked);
      if (found) return found;
    }
    return enabled[0] ?? null;
  };

  const resolveCronModelSession = (targetChannelId: string): ModelSession | null => {
    const selected = resolveSelectedModel(targetChannelId);
    if (!selected) return null;
    const credentialRef = providerCredentialMap[selected.providerId];
    if (!credentialRef) return null;
    return {
      providerId: selected.providerId,
      modelId: selected.modelId,
      credentialRef,
      apiBaseUrl: providerApiBaseMap[selected.providerId]
    };
  };

  useEffect(() => {
    kernel.setCronSessionModelResolver((targetChannelId) => resolveCronModelSession(targetChannelId));
  }, [kernel, channelModelMap, modelCatalog, providerCredentialMap, providerApiBaseMap]);

  const send = async (text: string) => {
    if (!sessionId) return;
    const editResult = kernel.applyWorkspaceEdit({
      channelId: sessionId,
      text,
      actorRole: developerModeEnabled ? "developer" : "user"
    });
    if (editResult.handled) {
      if (editResult.requiresConfirmation) {
        appendAssistantNotice(`系统提示：检测到高风险覆盖操作（${editResult.targetPath}），请发送“确认”继续。`);
      } else {
        appendAssistantNotice(`系统提示：已${editResult.mode === "append" ? "追加" : "更新"} ${editResult.targetPath}。`);
      }
      appLogger.info({
        module: "asset",
        event: editResult.requiresConfirmation ? "asset_write_pending_confirm" : "asset_write",
        message: editResult.summary ?? "workspace 文件改写",
        context: { targetPath: editResult.targetPath, mode: editResult.mode }
      });
      refreshChannelSnapshot(sessionId);
      return;
    }
    if (/^(确认|confirm|yes)$/i.test(text.trim())) {
      const confirmed = kernel.confirmPendingWorkspaceEdit(sessionId);
      if (confirmed.handled) {
        appendAssistantNotice(`系统提示：已确认并${confirmed.mode === "append" ? "追加" : "更新"} ${confirmed.targetPath}。`);
        appLogger.info({
          module: "asset",
          event: "asset_write_confirmed",
          message: confirmed.summary ?? "已确认改写",
          context: { targetPath: confirmed.targetPath, mode: confirmed.mode }
        });
        refreshChannelSnapshot(sessionId);
        return;
      }
    }
    const selectedModel = resolveSelectedModel(sessionId);
    try {
      setLastError("");
      if (!selectedModel) {
        setLastError("模型未配置。请先到“模型”页面新增并启用模型。");
        appLogger.warn({ module: "chat", event: "session_send_blocked", message: "模型未配置，阻断发送", context: { sessionId } });
        return;
      }
      const pendingProviderId = oauthWizard.step === "done" && !oauthWizard.committed ? oauthWizard.providerId : undefined;
      if (pendingProviderId && pendingProviderId === selectedModel.providerId) {
        setLastError(`${selectedModel.providerId} 配置尚未提交。请在向导最后一步点击“更新配置”。`);
        setActiveTab("models");
        appLogger.warn({
          module: "chat",
          event: "session_send_blocked_pending_commit",
          message: "Provider 处于待提交状态，阻断发送",
          context: { providerId: selectedModel.providerId, modelId: selectedModel.modelId }
        });
        return;
      }
      const credentialRef = providerCredentialMap[selectedModel.providerId];
      if (!credentialRef) {
        setLastError(`${selectedModel.providerId} 尚未完成鉴权。请到“模型”页面点击“去配置”。`);
        appLogger.warn({
          module: "chat",
          event: "session_send_blocked",
          message: "Provider 未鉴权，阻断发送",
          context: { sessionId, providerId: selectedModel.providerId, modelId: selectedModel.modelId }
        });
        return;
      }
      const apiBaseUrl = providerApiBaseMap[selectedModel.providerId];
      if (!apiBaseUrl && selectedModel.providerId === "minimax") {
        appLogger.warn({
          module: "chat",
          event: "session_send_base_missing",
          message: "MiniMax 未配置 baseUrl，将使用默认地址",
          context: { providerId: selectedModel.providerId, modelId: selectedModel.modelId }
        });
      }
      const primary: ModelSession = {
        providerId: selectedModel.providerId,
        modelId: selectedModel.modelId,
        credentialRef,
        apiBaseUrl
      };
      const reminderIntent = hasReminderIntent(text);
      if (reminderIntent) {
        appLogger.info({
          module: "cron",
          event: "reminder_commitment_detected",
          message: "检测到提醒意图，等待确认是否落地 Cron",
          context: { sessionId, providerId: primary.providerId, modelId: primary.modelId }
        });
      }
      const sendStartedAt = Date.now();
      const runtimeTime = getRuntimeTimeContext(new Date(sendStartedAt));
      const flowRunId = uid("react_run");
      currentFlowRunIdRef.current = flowRunId;
      setReactRunState({
        runId: flowRunId,
        stage: "reason",
        toolTurns: 0
      });
      const beforeJobs = kernel.listCronJobs(true);
      const region = primary.providerId === "minimax" ? inferMiniMaxRegionFromBase(primary.apiBaseUrl) : undefined;
      appLogger.info({
        module: "chat",
        event: "session_send_request",
        message: "发起聊天请求",
        context: {
          sessionId,
          providerId: primary.providerId,
          modelId: primary.modelId,
          hasCredential: Boolean(primary.credentialRef),
          apiBaseUrl: primary.apiBaseUrl || "(default)",
          region
        }
      });
      const startedAt = Date.now();
      setIsSending(true);
      setSendStartedAt(startedAt);
      setSendTimeoutDismissed(false);
      toolLoopStoppedByUserRef.current = false;
      const loopAbort = new AbortController();
      toolLoopAbortControllerRef.current = loopAbort;
      const initialResponsePromise = kernel.sendMessage({
        channelId: sessionId,
        text,
        primary,
        signal: loopAbort.signal,
        runtimeTime,
        deferAssistant: true
      });
      refreshSessionSnapshot(sessionId);
      const initialResponse = await initialResponsePromise;
      const assistantText = initialResponse.text ?? "";
      const toolLoopStartAt = Date.now();
      const maxToolTurns = ACTIVE_TOOL_LOOP_BUDGET.maxToolTurns;
      const toolLoopTimeoutMs = ACTIVE_TOOL_LOOP_BUDGET.timeoutMs;
      let toolTurns = 0;
      let loopGuardTriggered = false;
      let toolFlowActive = false;
      let fallbackParsed = false;
      let finalAssistantOverride: string | null = null;
      let latestAssistantText = assistantText;
      let latestAssistantId: string | undefined;
      let lastCallSignature = "";
      let sameCallRepeats = 0;
      let lastToolContextLines: string[] = [];
      const initialStructuredCalls = parseStructuredCronToolCalls(latestAssistantText, sessionId, DEFAULT_AGENT_ID, latestAssistantId);
      if (initialStructuredCalls.length > 0) {
        appLogger.info({
          module: "tool",
          event: "tool_call_text_parsed",
          message: "已从模型文本解析结构化工具调用",
          context: { sessionId, count: initialStructuredCalls.length }
        });
      }
      if (
        initialStructuredCalls.length > 0 ||
        parseUserCronCommand(text, sessionId, DEFAULT_AGENT_ID) ||
        parseUserRemindCommand(text, sessionId, DEFAULT_AGENT_ID) ||
        parseNaturalReminderCommand(text, sessionId, DEFAULT_AGENT_ID) ||
        parseUserSystemToolCommand(text, sessionId, DEFAULT_AGENT_ID)
      ) {
        toolFlowActive = true;
        setIsToolLooping(true);
        setReactRunState((prev) => (prev ? { ...prev, stage: "plan" } : prev));
        toolLoopRunIdRef.current = uid("tool_loop");
        appendAssistantNotice("系统提示：Plan 已生成，正在执行工具链...", sessionId, flowRunId);
      }
      while (toolTurns < maxToolTurns && Date.now() - toolLoopStartAt < toolLoopTimeoutMs) {
        if (toolLoopStoppedByUserRef.current) break;
        setReactRunState((prev) => (prev ? { ...prev, stage: "act", toolTurns } : prev));
        const structuredCalls =
          toolTurns === 0 ? initialStructuredCalls : parseStructuredCronToolCalls(latestAssistantText, sessionId, DEFAULT_AGENT_ID, latestAssistantId);
        const calls: ToolCallRequest[] = [...structuredCalls];
        if (!fallbackParsed && calls.length === 0) {
          fallbackParsed = true;
          const fallbackCron = parseUserCronCommand(text, sessionId, DEFAULT_AGENT_ID);
          if (fallbackCron) calls.push(fallbackCron);
          const fallbackRemind =
            parseUserRemindCommand(text, sessionId, DEFAULT_AGENT_ID) ??
            parseNaturalReminderCommand(text, sessionId, DEFAULT_AGENT_ID);
          if (fallbackRemind) calls.push(fallbackRemind);
          if (fallbackRemind?.source === "user_command") {
            appLogger.info({
              module: "tool",
              event: "natural_reminder_parsed",
              message: "自然语义已转换为 cron.add",
              context: { sessionId }
            });
          }
          const fallbackSystemTool = parseUserSystemToolCommand(text, sessionId, DEFAULT_AGENT_ID);
          if (fallbackSystemTool) calls.push(fallbackSystemTool);
        }
        const verifierLines: string[] = [];
        const verifiedCalls: ToolCallRequest[] = [];
        for (const call of calls) {
          const verdict = verifyToolCall(call);
          if (verdict.ok) {
            verifiedCalls.push(call);
            continue;
          }
          verifierLines.push(`tool.error ${call.tool} code=${verdict.result.code ?? "invalid"} msg=${verdict.result.message ?? "invalid_call"}`);
          appendToolEvent(call.tool, "blocked", verdict.result.message ?? "工具调用参数不合法", call.sessionId);
          appLogger.warn({
            module: "tool",
            event: "tool_call_rejected",
            message: "ToolCallVerifier 拦截了非法工具调用",
            context: {
              tool: call.tool,
              code: verdict.result.code ?? "invalid",
              sessionId: call.sessionId
            }
          });
        }
        if (!verifiedCalls.length && !verifierLines.length) break;
        const callSignature = calls
          .map((call) => `${call.tool}:${JSON.stringify(call.payload)}`)
          .sort()
          .join("|");
        if (callSignature && callSignature === lastCallSignature) sameCallRepeats += 1;
        else sameCallRepeats = 0;
        lastCallSignature = callSignature;
        if (sameCallRepeats === 1) {
          appLogger.info({
            module: "tool",
            event: "tool_loop_repeat_observed",
            message: "观察到重复工具调用，继续执行以确认是否有新进展",
            context: { sessionId, toolTurns, callSignature }
          });
        }
        const result = verifiedCalls.length
          ? await processToolCalls(verifiedCalls, latestAssistantText, text)
          : { queuedCount: 0, immediateHandled: 0, toolContextLines: [] as string[] };
        setReactRunState((prev) => (prev ? { ...prev, stage: result.queuedCount > 0 ? "approve" : "act" } : prev));
        toolTurns += 1;
        const combinedToolContextLines = [...verifierLines, ...result.toolContextLines];
        lastToolContextLines = combinedToolContextLines;
        if (combinedToolContextLines.length === 0) {
          if (result.queuedCount === 0 && result.immediateHandled === 0) break;
          // Only approval/immediate non-summary actions happened; no follow-up model turn required.
          break;
        }
        const toolContext = combinedToolContextLines.join("\n");
        appLogger.debug({
          module: "tool",
          event: "context_assembled",
          message: "工具上下文已组装",
          context: {
            toolCount: combinedToolContextLines.length,
            contextBytes: toolContext.length,
            containsFsRead: /fs\.read\.meta/.test(toolContext)
          }
        });
        try {
          if (sameCallRepeats >= 9) {
            const localReply = summarizeToolContextLines(combinedToolContextLines);
            if (localReply) {
              finalAssistantOverride = localReply;
              setReactRunState((prev) =>
                prev
                  ? {
                      ...prev,
                      stage: "done",
                      stopReason: "no_progress",
                      toolTurns
                    }
                  : prev
              );
              appLogger.warn({
                module: "tool",
                event: "tool_loop_no_progress",
                message: "检测到重复工具调用，已使用本地真值摘要兜底",
                context: { sessionId, toolTurns, callSignature }
              });
              break;
            }
          }
          const followup = await kernel.continueWithToolContext({
            channelId: sessionId,
            userText: text,
            toolContext,
            primary,
            signal: loopAbort.signal,
            runtimeTime,
            deferAssistant: true
          });
          latestAssistantText = followup.text ?? "";
          latestAssistantId = undefined;
          if (/\/\//.test(latestAssistantText) && latestAssistantText.match(/\/\//g)?.length && (latestAssistantText.match(/\/\//g)?.length ?? 0) >= 8) {
            appLogger.warn({
              module: "assistant",
              event: "output_anomaly",
              message: "检测到可疑的斜杠噪声输出",
              context: {
                sessionId,
                slashPairs: latestAssistantText.match(/\/\//g)?.length ?? 0
              }
            });
            appendAssistantNotice("系统提示：检测到异常格式噪声，建议我基于原文重做一次简洁摘要。", sessionId);
          }
        } catch (toolLoopErr) {
          if (toolLoopStoppedByUserRef.current) break;
          const localReply = summarizeToolContextLines(combinedToolContextLines);
          if (localReply) {
            finalAssistantOverride = localReply;
            setReactRunState((prev) =>
              prev
                ? {
                    ...prev,
                    stage: "done",
                    stopReason: "completed",
                    toolTurns
                  }
                : prev
            );
            appLogger.warn({
              module: "tool",
              event: "tool_loop_local_fallback",
              message: "工具二次总结失败，已回退本地真值回复",
              context: { sessionId, toolTurns }
            });
            break;
          }
          appLogger.error({
            module: "cron",
            event: "tool_loop_followup_failed",
            message: "工具结果二次总结失败",
            error: toolLoopErr instanceof Error ? toolLoopErr.message : String(toolLoopErr)
          });
          appendAssistantNotice("系统提示：工具执行完成，但二次总结失败。请重试一次。");
          break;
        }
      }
      if (toolTurns >= maxToolTurns || Date.now() - toolLoopStartAt >= toolLoopTimeoutMs) {
        loopGuardTriggered = true;
        appendAssistantNotice("系统提示：工具循环已触发保护阈值，本轮已停止以避免卡死。");
        setReactRunState((prev) =>
          prev
            ? {
                ...prev,
                stage: "done",
                stopReason: "guard_triggered",
                toolTurns
              }
            : prev
        );
      }
      appLogger.info({
        module: "cron",
        event: "tool_loop_completed",
        message: "工具循环完成",
        context: {
          sessionId,
          elapsedMs: Date.now() - toolLoopStartAt,
          toolTurns,
          loopGuardTriggered
        }
      });
      const resolvedFromTimeTool = lastToolContextLines.some((line) => line.startsWith("time.now "))
        ? summarizeToolContextLines(lastToolContextLines)
        : null;
      const rawFinalText = (resolvedFromTimeTool ?? finalAssistantOverride ?? latestAssistantText ?? assistantText).trim();
      const normalized = sanitizeAssistantText(rawFinalText);
      let finalAssistantText = normalized.text;
      if (!finalAssistantText) {
        const fallbackSummary = summarizeToolContextLines(lastToolContextLines);
        if (fallbackSummary) finalAssistantText = fallbackSummary;
      }
      if (reminderIntent) {
        const afterJobs = kernel.listCronJobs(true);
        const createdJobs = afterJobs.filter((job) =>
          !beforeJobs.some((prev) => prev.id === job.id) &&
          job.payload.channelId === sessionId &&
          job.createdAt >= startedAt
        );
        const committed = hasReminderCommitment(finalAssistantText);
        if (committed && createdJobs.length === 0 && toolTurns === 0) {
          appLogger.warn({
            module: "cron",
            event: "reminder_commitment_unfulfilled",
            message: "模型承诺提醒但未创建 Cron 任务",
            context: { sessionId, providerId: primary.providerId, modelId: primary.modelId }
          });
          appendAssistantNotice("系统提示：检测到提醒承诺但尚未落地任务。请到“工具”页审批待执行请求，或明确要求“创建定时提醒任务”。");
        } else if (committed && toolTurns > 0 && createdJobs.length === 0) {
          appLogger.info({
            module: "cron",
            event: "reminder_commitment_pending_approval",
            message: "提醒承诺已解析为工具调用，等待审批",
            context: { sessionId, toolCalls: toolTurns }
          });
        } else if (createdJobs.length > 0) {
          appLogger.info({
            module: "cron",
            event: "reminder_commitment_fulfilled",
            message: "提醒承诺已落地",
            context: { sessionId, createdJobIds: createdJobs.map((job) => job.id).slice(0, 3) }
          });
        }
      }
      if (finalAssistantText) {
        kernel.appendAssistantMessage(sessionId, finalAssistantText, "assistant", {
          flowRunId,
          visibility: toolFlowActive ? "deferred_final" : "immediate",
          normalizedFromToolCall: normalized.normalizedFromToolCall
        });
      } else {
        appendAssistantNotice("系统提示：本轮未生成可展示答案，已结束工具流程。", sessionId, flowRunId);
      }
      refreshChannelSnapshot(sessionId);
      const latencyMs = Date.now() - startedAt;
      appLogger.info({
        module: "chat",
        event: "session_send_success",
        message: "聊天响应成功",
        context: { sessionId, providerId: primary.providerId, modelId: primary.modelId, latencyMs }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (toolLoopStoppedByUserRef.current || /abort/i.test(msg)) {
        setLastError("");
        setReactRunState((prev) => (prev ? { ...prev, stage: "done", stopReason: "aborted" } : prev));
        appLogger.info({
          module: "chat",
          event: "session_send_aborted",
          message: "请求被用户终止",
          context: { sessionId, runId: toolLoopRunIdRef.current }
        });
        refreshChannelSnapshot(sessionId);
        return;
      }
      if (/empty_response/i.test(msg)) {
        const fallbackSystemTool = parseUserSystemToolCommand(text, sessionId, DEFAULT_AGENT_ID);
        const fallbackCron =
          parseUserCronCommand(text, sessionId, DEFAULT_AGENT_ID) ??
          parseNaturalReminderCommand(text, sessionId, DEFAULT_AGENT_ID) ??
          parseUserRemindCommand(text, sessionId, DEFAULT_AGENT_ID);
        const fallbackCalls = [fallbackSystemTool, fallbackCron].filter((it): it is ToolCallRequest => Boolean(it));
        if (fallbackCalls.length) {
          const fallbackResult = await processToolCalls(fallbackCalls, "", text);
          const localReply = summarizeToolContextLines(fallbackResult.toolContextLines);
          if (localReply) {
            kernel.appendAssistantMessage(sessionId, localReply, "assistant");
            refreshChannelSnapshot(sessionId);
            appLogger.warn({
              module: "tool",
              event: "empty_response_local_fallback",
              message: "主模型空响应，已回退到本地工具真值回复",
              context: { sessionId, fallbackCalls: fallbackCalls.map((c) => c.tool) }
            });
            return;
          }
        }
      }
      const selectedModel = resolveSelectedModel(sessionId);
      const region = selectedModel?.providerId === "minimax"
        ? inferMiniMaxRegionFromBase(providerApiBaseMap[selectedModel.providerId])
        : undefined;
      let notice = "";
      if (/empty_response/i.test(msg)) {
        notice = "系统提示：模型返回了空内容，请重试或切换模型。";
      } else if (/401|authentication_error|invalid api key/i.test(msg)) {
        notice = "系统提示：鉴权失败（401）。请检查当前模型配置，可能是 MiniMax 区域与 Key 不匹配。";
        if (selectedModel?.providerId === "minimax") {
          appLogger.warn({
            module: "gateway.minimax",
            event: "minimax_region_mismatch_suspected",
            message: "怀疑 MiniMax 区域与 key 不匹配",
            context: {
              providerId: selectedModel.providerId,
              modelId: selectedModel.modelId,
              region,
              baseUrl: providerApiBaseMap[selectedModel.providerId] || "(default)"
            }
          });
          if (/invalid api key/i.test(msg)) {
            const nextCount = (minimaxByokFailureByRegionRef.current[region ?? "global"] ?? 0) + 1;
            minimaxByokFailureByRegionRef.current[region ?? "global"] = nextCount;
            if (nextCount >= 2) {
              appLogger.warn({
                module: "gateway.minimax",
                event: "minimax_key_invalid_suspected",
                message: "同区域重复鉴权失败，怀疑 key 无效或复制错误",
                context: {
                  providerId: selectedModel.providerId,
                  modelId: selectedModel.modelId,
                  region,
                  baseUrl: providerApiBaseMap[selectedModel.providerId] || "(default)",
                  consecutiveFailures: nextCount
                }
              });
            }
          }
        }
      } else if (/timed out|timeout|network/i.test(msg)) {
        notice = "系统提示：网络异常或请求超时，请检查网络后重试。";
      } else if (msg.includes("not configured")) {
        notice = `系统提示：${msg}。请先进入模型页完成 OpenAI 或 MiniMax 配置。`;
      } else {
        notice = `系统提示：发送失败（${msg}）`;
      }
      setLastError("");
      appLogger.error({
        module: "chat",
        event: "session_send_failed",
        message: "聊天请求失败",
        error: msg
      });
      refreshChannelSnapshot(sessionId);
      appendAssistantNotice(notice);
    } finally {
      if (currentFlowRunIdRef.current) {
        const finishedFlowId = currentFlowRunIdRef.current;
        setCollapsedFlowGroupIds((prev) => (prev.includes(finishedFlowId) ? prev : [...prev, finishedFlowId]));
      }
      setReactRunState((prev) =>
        prev
          ? {
              ...prev,
              stage: "done",
              stopReason: prev.stopReason ?? "completed"
            }
          : prev
      );
      setIsToolLooping(false);
      setIsSending(false);
      setSendStartedAt(null);
      setSendTimeoutLevel("none");
      toolLoopAbortControllerRef.current = null;
      toolLoopRunIdRef.current = null;
      toolLoopStoppedByUserRef.current = false;
      currentFlowRunIdRef.current = null;
    }
  };

  const retryLast = async () => {
    if (!sessionId) return;
    const lastUser = [...kernel.getMessages(sessionId)].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    await send(lastUser.content);
  };

  const switchSession = (nextSessionId: string) => {
    setSessionId(nextSessionId);
    refreshChannelSnapshot(nextSessionId);
  };

  const createSession = (name: string) => {
    const id = kernel.createChannel(ws.id, name);
    const selected = resolveSelectedModel(sessionId);
    if (selected) {
      const nextMap = { ...channelModelMap, [id]: selected.key };
      setChannelModelMap(nextMap);
      void persistPreferences({ channelModelMap: nextMap });
    }
    switchSession(id);
  };

  const renameSession = async (targetSessionId: string, nextName: string): Promise<boolean> => {
    const trimmed = nextName.trim();
    if (!trimmed) return false;
    const changed = kernel.renameChannel(targetSessionId, trimmed);
    if (!changed) return false;
    if (sessionId) refreshSessionSnapshot(sessionId);
    return true;
  };

  const deleteSession = async (targetSessionId: string): Promise<{ result: DeleteSessionResult; nextSessionId?: string }> => {
    const all = kernel.channels.listChannels(ws.id);
    if (all.length <= 1) return { result: "blocked" };
    const exists = all.some((s) => s.id === targetSessionId);
    if (!exists) return { result: "blocked" };
    const fallbackSession = all.find((s) => s.id !== targetSessionId)?.id;
    const removed = kernel.deleteChannel(targetSessionId);
    if (!removed) return { result: "blocked" };

    const nextMap = { ...channelModelMap };
    delete nextMap[targetSessionId];
    setChannelModelMap(nextMap);
    await persistPreferences({ channelModelMap: nextMap });

    const current = sessionId;
    if (current === targetSessionId && fallbackSession) {
      setSessionId(fallbackSession);
      refreshSessionSnapshot(fallbackSession);
      return { result: "switchedTo", nextSessionId: fallbackSession };
    }
    if (current) refreshSessionSnapshot(current);
    return { result: "ok" };
  };

  const switchModel = (modelKey: string) => {
    if (!sessionId) return;
    const nextMap = { ...channelModelMap, [sessionId]: modelKey };
    setChannelModelMap(nextMap);
    const selected = listEnabledModels().find((m) => m.key === modelKey) ?? null;
    setResolvedModel(
      selected
        ? {
            providerId: selected.providerId,
            modelId: selected.modelId,
            displayName: selected.displayName
          }
        : null
    );
    void persistPreferences({ channelModelMap: nextMap });
    appLogger.info({
      module: "chat",
      event: "session_switch_model",
      message: "切换模型",
      context: { sessionId, modelKey, providerId: selected?.providerId, modelId: selected?.modelId }
    });
  };

  const getSessionModelDisplay = (targetSessionId: string): string => {
    const selected = resolveSelectedModel(targetSessionId);
    return selected?.displayName ?? "模型未配置";
  };

  const configureByok = async (providerId: string, key: string) => {
    await kernel.configureProviderByok(providerId, key);
    setProviderCredentialMap(kernel.getProviderCredentialMap());
    setOnboardingRequired(false);
    if (sessionId) refreshChannelSnapshot(sessionId);
    appLogger.info({ module: "auth", event: "byok_saved", message: "BYOK 已保存", context: { providerId } });
  };

  const configureOAuth = async (providerId: string, authCode: string) => {
    await kernel.configureProviderOAuth(providerId, authCode);
    setProviderCredentialMap(kernel.getProviderCredentialMap());
    setOnboardingRequired(false);
    if (sessionId) refreshChannelSnapshot(sessionId);
  };

  const configureOAuthTokens = async (providerId: string, tokens: any) => {
    await kernel.configureProviderOAuthTokens(providerId, tokens);
    setProviderCredentialMap(kernel.getProviderCredentialMap());
    setOnboardingRequired(false);
    if (sessionId) refreshChannelSnapshot(sessionId);
    appLogger.info({
      module: "auth",
      event: "oauth_saved",
      message: "OAuth token 已保存",
      context: { providerId, hasResourceUrl: Boolean(tokens?.resourceUrl) }
    });
  };

  const initializeAll = async (mode: "full" | "update") => {
    await kernel.resetAll({ preserveCredentials: mode === "update", workspace: ws });
    const created = kernel.ensureWorkspaceAndDefaultChannel(ws, "General");
    setSessionId(created);
    refreshChannelSnapshot(created);
    setLastError("");
    setProviderCredentialMap(kernel.getProviderCredentialMap());
    const hasConfiguredProvider = visibleProviders.some((provider) => Boolean(kernel.getProviderCredentialMap()[provider.id]));
    setOnboardingRequired(!hasConfiguredProvider);
    if (!hasConfiguredProvider) setActiveTab("models");
    setCronJobs(kernel.listCronJobs(true));
    setOauthWizard(createDefaultWizard());
    if (mode === "full") {
      setModelCatalog(defaultModelCatalog);
      setChannelModelMap({});
      setProviderApiBaseMap({});
      setPendingApprovals([]);
      setCronPermissionGrants([]);
      setPendingPermissionRequests([]);
      setPermissionGrants([]);
      setToolExecutionRecords([]);
      await persistPreferences({
        modelCatalog: defaultModelCatalog,
        channelModelMap: {},
        providerApiBaseMap: {},
        pendingCronApprovals: [],
        cronPermissionGrants: [],
        pendingPermissionRequests: [],
        permissionGrants: []
      });
    }
  };

  const refreshCronJobs = () => {
    setCronJobs(kernel.listCronJobs(true));
    setCronExecutionRecords(kernel.listCronExecutionRecords(100));
  };

  const enqueueApprovalRequests = async (requests: CronApprovalRequest[]) => {
    if (!requests.length) return;
    const next = [...pendingApprovals, ...requests];
    setPendingApprovals(next);
    await persistPreferences({ pendingCronApprovals: next });
  };

  const enqueuePermissionRequests = async (requests: PermissionRequest[]) => {
    if (!requests.length) return;
    const next = [...pendingPermissionRequests, ...requests];
    setPendingPermissionRequests(next);
    await persistPreferences({ pendingPermissionRequests: next });
  };

  const isGranted = (scope: PermissionRequest["scope"], agentId: string): boolean => {
    const now = Date.now();
    return permissionGrants.some((grant) => {
      if (!grant.granted || grant.scope !== scope) return false;
      if (grant.agentId && grant.agentId !== agentId) return false;
      if (grant.expiresAt && grant.expiresAt < now) return false;
      return true;
    });
  };

  const pushToolRecord = (record: ToolExecutionRecord) => {
    setToolExecutionRecords((prev) => [record, ...prev].slice(0, 200));
  };

  const executeImmediateToolCall = async (
    call: ToolCallRequest
  ): Promise<{ ok: boolean; contextLine: string; summary: string }> => {
    const startedAt = Date.now();
    pushToolRecord({
      id: uid("tool_exec"),
      callId: call.id,
      tool: call.tool,
      status: "running",
      summary: "运行中",
      sessionId: call.sessionId,
      agentId: call.agentId,
      createdAt: startedAt,
      details: call.payload
    });
    appendToolEvent(call.tool, "running", "正在执行命令...", call.sessionId);

    if (call.tool === "time.now") {
      const runtime = getRuntimeTimeContext();
      const summary = `${runtime.localTimeText} (${runtime.timezone})`;
      appLogger.info({
        module: "tool",
        event: "time_now_result",
        message: "time.now 执行结果",
        context: {
          nowMs: runtime.nowMs,
          utcIso: runtime.iso,
          timezone: runtime.timezone,
          localTimeText: runtime.localTimeText
        }
      });
      pushToolRecord({
        id: uid("tool_exec"),
        callId: call.id,
        tool: call.tool,
        status: "ok",
        summary,
        sessionId: call.sessionId,
        agentId: call.agentId,
        createdAt: startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt
      });
      appendToolEvent(call.tool, "ok", `当前系统时间：${summary}`, call.sessionId);
      return {
        ok: true,
        summary,
        contextLine: `time.now {"nowMs":${runtime.nowMs},"utcIso":"${runtime.iso}","timezone":"${runtime.timezone}","localTimeText":"${runtime.localTimeText}"}`
      };
    }

    if (call.tool === "fs.read") {
      const path = String(call.payload.path ?? "").trim();
      const read = kernel.readToolAsset(path);
      if (!read.ok) {
        const errorSummary = `读取失败：${read.error ?? "unknown"}`;
        pushToolRecord({
          id: uid("tool_exec"),
          callId: call.id,
          tool: call.tool,
          status: "error",
          summary: errorSummary,
          sessionId: call.sessionId,
          agentId: call.agentId,
          createdAt: startedAt,
          finishedAt: Date.now(),
          durationMs: Date.now() - startedAt
        });
        appendToolEvent(call.tool, "error", errorSummary, call.sessionId, `path=${path || "-"}`);
        return { ok: false, summary: errorSummary, contextLine: `fs.read error=${read.error ?? "unknown"} path=${path}` };
      }
      const content = read.content ?? "";
      const isTruncated = content.length > 2400;
      const clipped = isTruncated ? `${content.slice(0, 2400)}\n...[truncated]` : content;
      const safeBlock = clipped.replace(/```/g, "`\\`\\`");
      appLogger.info({
        module: "tool",
        event: "fs_read_result",
        message: "fs.read 执行结果",
        context: {
          path,
          chars: content.length,
          truncated: isTruncated,
          contentPreview: clipped.slice(0, 120)
        }
      });
      pushToolRecord({
        id: uid("tool_exec"),
        callId: call.id,
        tool: call.tool,
        status: "ok",
        summary: `读取成功：${path}`,
        sessionId: call.sessionId,
        agentId: call.agentId,
        createdAt: startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt
      });
      appendToolEvent(call.tool, "ok", `读取成功：${path}`, call.sessionId, `chars=${content.length}`);
      return {
        ok: true,
        summary: `read:${path}`,
        contextLine: `fs.read.meta {"path":"${path}","chars":${content.length},"truncated":${isTruncated}}\nfs.read.content\n\`\`\`text\n${safeBlock}\n\`\`\``
      };
    }

    if (call.tool === "fs.list") {
      const path = String(call.payload.path ?? "").trim();
      const listed = kernel.listToolAssets(path);
      if (!listed.ok) {
        const errorSummary = `列目录失败：${listed.error ?? "unknown"}`;
        pushToolRecord({
          id: uid("tool_exec"),
          callId: call.id,
          tool: call.tool,
          status: "error",
          summary: errorSummary,
          sessionId: call.sessionId,
          agentId: call.agentId,
          createdAt: startedAt,
          finishedAt: Date.now(),
          durationMs: Date.now() - startedAt
        });
        appendToolEvent(call.tool, "error", errorSummary, call.sessionId, `path=${path || "."}`);
        return { ok: false, summary: errorSummary, contextLine: `fs.list error=${listed.error ?? "unknown"} path=${path || "."}` };
      }
      const entries = listed.entries ?? [];
      const rows = entries.slice(0, 120).map((row) => `${row.type === "dir" ? "dir" : "file"} ${row.path}`);
      const truncated = entries.length > rows.length;
      const summary = `目录读取成功：${listed.path}（${entries.length}项）`;
      pushToolRecord({
        id: uid("tool_exec"),
        callId: call.id,
        tool: call.tool,
        status: "ok",
        summary,
        sessionId: call.sessionId,
        agentId: call.agentId,
        createdAt: startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt
      });
      appendToolEvent(call.tool, "ok", summary, call.sessionId);
      return {
        ok: true,
        summary: `list:${listed.path}`,
        contextLine: `fs.list.meta {"path":"${listed.path}","count":${entries.length},"truncated":${truncated}}\n${rows.join("\n")}${truncated ? "\n...[truncated]" : ""}`
      };
    }

    if (call.tool === "fs.write") {
      const path = String(call.payload.path ?? "").trim();
      const content = String(call.payload.content ?? "");
      const mode = call.payload.mode === "append" ? "append" : "replace";
      const written = kernel.writeToolAsset(path, content, mode);
      if (!written.ok) {
        const errorSummary = `写入失败：${written.error ?? "unknown"}`;
        pushToolRecord({
          id: uid("tool_exec"),
          callId: call.id,
          tool: call.tool,
          status: "error",
          summary: errorSummary,
          sessionId: call.sessionId,
          agentId: call.agentId,
          createdAt: startedAt,
          finishedAt: Date.now(),
          durationMs: Date.now() - startedAt
        });
        appendToolEvent(call.tool, "error", errorSummary, call.sessionId, `path=${path || "-"}`);
        return { ok: false, summary: errorSummary, contextLine: `fs.write error=${written.error ?? "unknown"} path=${path}` };
      }
      const summary = `写入成功：${path} (${mode})`;
      pushToolRecord({
        id: uid("tool_exec"),
        callId: call.id,
        tool: call.tool,
        status: "ok",
        summary,
        sessionId: call.sessionId,
        agentId: call.agentId,
        createdAt: startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt
      });
      appendToolEvent(call.tool, "ok", summary, call.sessionId);
      return {
        ok: true,
        summary: `write:${path}`,
        contextLine: `fs.write ok path=${path} mode=${mode} chars=${content.length}`
      };
    }

    if (call.tool === "exec.run") {
      const command = String(call.payload.command ?? "").trim();
      const parsed = parseExecCommandPayload(command);
      let output = "";
      let ok = true;
      if (parsed.base === "date" || parsed.base === "time") {
        const runtime = getRuntimeTimeContext();
        output = `${runtime.iso} (${runtime.timezone})`;
      } else if (parsed.base === "ls") {
        const tree = kernel.listAssetTree("developer", { scope: "all", channelId: call.sessionId });
        const lines: string[] = [];
        const walk = (nodes: AssetTreeNode[], prefix = "") => {
          for (const node of nodes) {
            lines.push(`${prefix}${node.type === "dir" ? "📁" : "📄"} ${node.path}`);
            if (node.children?.length) walk(node.children, `${prefix}  `);
          }
        };
        walk(tree);
        output = lines.join("\n") || "(empty)";
      } else if (parsed.base === "cat" && parsed.arg) {
        const read = kernel.readToolAsset(parsed.arg);
        ok = read.ok;
        output = read.ok ? (read.content ?? "") : `error:${read.error ?? "unknown"}`;
      } else {
        ok = false;
        output = "command_not_allowed";
      }
      const clipped = output.length > 2400 ? `${output.slice(0, 2400)}\n...[truncated]` : output;
      const status: ToolExecutionRecord["status"] = ok ? "ok" : "blocked";
      pushToolRecord({
        id: uid("tool_exec"),
        callId: call.id,
        tool: call.tool,
        status,
        summary: ok ? `执行成功：${command}` : `命令受限：${command}`,
        sessionId: call.sessionId,
        agentId: call.agentId,
        createdAt: startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt
      });
      appendToolEvent(call.tool, status === "ok" ? "ok" : "blocked", ok ? "命令执行完成" : "命令被安全策略拦截", call.sessionId, command);
      return {
        ok,
        summary: ok ? `exec:${command}` : `exec_blocked:${command}`,
        contextLine: `exec.run command=${command}\n${clipped}`
      };
    }

    return { ok: false, summary: "unsupported_tool", contextLine: `${call.tool} unsupported` };
  };

  const processToolCalls = async (
    calls: ToolCallRequest[],
    sourceTextForNotice: string,
    userText: string
  ): Promise<{ queuedCount: number; immediateHandled: number; toolContextLines: string[] }> => {
    if (!calls.length) return { queuedCount: 0, immediateHandled: 0, toolContextLines: [] };
    const nonCronCalls = calls.filter(
      (c) => c.tool === "time.now" || c.tool === "fs.read" || c.tool === "fs.list" || c.tool === "fs.write" || c.tool === "exec.run"
    );
    const permissionRequests: PermissionRequest[] = [];
    for (const call of nonCronCalls) {
      if (call.tool === "fs.write") {
        if (!isGranted("filesystem.write", call.agentId)) {
          permissionRequests.push({
            id: uid("perm_req"),
            agentId: call.agentId,
            channelId: call.sessionId,
            scope: "filesystem.write",
            action: call.tool,
            payload: { ...call.payload, toolCallId: call.id },
            reason: "模型请求写入内部文件",
            status: "pending",
            requestedAt: Date.now()
          });
        }
      } else if (call.tool === "exec.run") {
        if (!isGranted("system.command", call.agentId)) {
          permissionRequests.push({
            id: uid("perm_req"),
            agentId: call.agentId,
            channelId: call.sessionId,
            scope: "system.command",
            action: call.tool,
            payload: { ...call.payload, toolCallId: call.id },
            reason: "模型请求执行命令",
            status: "pending",
            requestedAt: Date.now()
          });
        }
      }
    }
    if (permissionRequests.length) {
      await enqueuePermissionRequests(permissionRequests);
      appendAssistantNotice(`系统提示：检测到 ${permissionRequests.length} 个高权限工具请求，已加入待审批。`);
      appLogger.info({
        module: "tool",
        event: "permission_requests_queued",
        message: "工具权限请求已加入审批队列",
        context: { total: permissionRequests.length }
      });
    }

    const executableNonCron = nonCronCalls.filter((call) => {
      if (call.tool === "fs.write") return isGranted("filesystem.write", call.agentId);
      if (call.tool === "exec.run") return isGranted("system.command", call.agentId);
      return true;
    });

    const toolContextLines: string[] = [];
    let immediateHandled = 0;
    for (const call of executableNonCron) {
      const result = await executeImmediateToolCall(call);
      immediateHandled += 1;
      toolContextLines.push(result.contextLine);
    }

    const addUpdateRemove = calls.filter((c) => c.tool === "cron.add" || c.tool === "cron.update" || c.tool === "cron.remove");
    const autoApprovedUpdates = addUpdateRemove.filter((call) => {
      if (call.tool !== "cron.update") return false;
      const jobId = String(call.payload.jobId ?? "");
      if (!jobId) return false;
      return cronPermissionGrants.some((g) => g.scope === "update" && g.agentId === call.agentId && g.cronJobId === jobId);
    });
    for (const call of autoApprovedUpdates) {
      const jobId = String(call.payload.jobId ?? "");
      kernel.updateCronJobByAgent(jobId, {
        name: typeof call.payload.name === "string" ? call.payload.name : undefined,
        enabled: typeof call.payload.enabled === "boolean" ? call.payload.enabled : undefined
      });
      appLogger.info({
        module: "cron",
        event: "cron_auto_approved_by_grant",
        message: "命中长期授权，自动执行 Cron 更新",
        context: { jobId, agentId: call.agentId }
      });
    }

    const removeAllCalls = calls.filter((c) => c.tool === "cron.remove_all");
    const needsApproval = addUpdateRemove.filter((call) => !autoApprovedUpdates.some((x) => x.id === call.id));
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const queueRows: CronApprovalRequest[] = [];
    for (const call of needsApproval) {
      const payload = { ...call.payload } as Record<string, unknown>;
      if (call.tool === "cron.add") {
        const nowMs = Date.now();
        const resolution = resolveReminderAtMs({
          userText,
          modelAtMsRaw: payload.atMs,
          nowMs,
          timezone
        });
        if (resolution) {
          payload.sourceTimeMs = resolution.sourceTimeMs;
          payload.timezone = resolution.timezone;
          payload.resolvedAtMs = resolution.resolvedAtMs;
          payload.resolutionMethod = resolution.resolutionMethod;
          if (typeof resolution.modelAtMs === "number") payload.modelAtMs = resolution.modelAtMs;
          if (typeof resolution.localAtMs === "number") payload.localAtMs = resolution.localAtMs;
          if (resolution.conflict) payload.conflict = true;
        }
        const normalizedAtMs = Number(payload.resolvedAtMs ?? payload.atMs);
        if (Number.isFinite(normalizedAtMs)) {
          payload.atMs = normalizedAtMs < 1_000_000_000_000 ? Math.floor(normalizedAtMs * 1000) : Math.floor(normalizedAtMs);
          const validation = validateAtMs(payload.atMs as number, nowMs);
          if (!validation.ok) {
            appendAssistantNotice(`系统提示：Cron 时间无效（${validation.reason}），本次未进入审批。`);
            appLogger.warn({
              module: "cron",
              event: "cron_schedule_rejected",
              message: "Cron 时间校验失败",
              context: { reason: validation.reason, rawAtMs: call.payload.atMs, resolvedAtMs: payload.atMs }
            });
            continue;
          }
        }
      }

      queueRows.push({
        id: uid("approval"),
        type: call.tool === "cron.add" ? "add" : call.tool === "cron.update" ? "update" : "remove",
        sessionId: call.sessionId,
        agentId: call.agentId,
        payload,
        source: call.source,
        sourceMessageId: call.sourceMessageId,
        status: "pending",
        createdAt: Date.now()
      });
    }
    for (const call of removeAllCalls) {
      appLogger.info({
        module: "tool",
        event: "natural_remove_all_parsed",
        message: "删除全部定时任务请求已转换为 cron.remove_all",
        context: { sessionId: call.sessionId }
      });
      const jobs = kernel.listCronJobs(true);
      queueRows.push({
        id: uid("approval"),
        type: "remove_all",
        sessionId: call.sessionId,
        agentId: call.agentId,
        payload: {
          jobCount: jobs.length,
          jobIds: jobs.map((job) => job.id),
          jobNames: jobs.map((job) => job.name).slice(0, 20)
        },
        source: call.source,
        sourceMessageId: call.sourceMessageId,
        status: "pending",
        createdAt: Date.now()
      });
    }
    if (queueRows.length) {
      await enqueueApprovalRequests(queueRows);
      appendAssistantNotice(`系统提示：检测到 ${queueRows.length} 个 Cron 操作请求，已加入待审批队列。`);
      const addRows = queueRows.filter((row) => row.type === "add");
      for (const row of addRows) {
        const resolvedAt = Number(row.payload.resolvedAtMs ?? row.payload.atMs ?? 0);
        if (!Number.isFinite(resolvedAt) || resolvedAt <= 0) continue;
        const localTime = new Date(resolvedAt).toLocaleString();
        const tz = String(row.payload.timezone ?? "UTC");
        const method = String(row.payload.resolutionMethod ?? "model");
        appendAssistantNotice(`系统提示：提醒时间已按系统时间确认：${localTime}（${tz}，${method}）。`);
        appLogger.info({
          module: "cron",
          event: "cron_time_reconciled",
          message: "提醒时间已按系统真值完成校准",
          context: {
            sessionId: row.sessionId,
            resolvedAtMs: resolvedAt,
            timezone: tz,
            resolutionMethod: method,
            conflict: Boolean(row.payload.conflict)
          }
        });
      }
    }

    const immediateCalls = calls.filter((c) => c.tool === "cron.run" || c.tool === "cron.status" || c.tool === "cron.list");
    for (const row of immediateCalls) {
      if (row.tool === "cron.run") {
        const jobId = String(row.payload.jobId ?? "");
        if (!jobId) {
          appendAssistantNotice("系统提示：cron.run 缺少 jobId，已忽略。");
          continue;
        }
        const mode = row.payload.mode === "force" ? "force" : "due";
        const result = kernel.enqueueCronRun(jobId, mode);
        refreshCronJobs();
        appendAssistantNotice(`系统提示：cron.run 已提交（${result.enqueued ? "已入队" : `未入队: ${result.reason ?? "unknown"}`}）。`);
        immediateHandled += 1;
      } else if (row.tool === "cron.status") {
        const jobs = kernel.listCronJobs(true);
        const enabled = jobs.filter((job) => job.enabled).length;
        const failed = jobs.filter((job) => job.state.lastStatus === "error").length;
        toolContextLines.push(`cron.status total=${jobs.length} enabled=${enabled} failed=${failed}`);
        immediateHandled += 1;
      } else if (row.tool === "cron.list") {
        const jobs = kernel.listCronJobs(true);
        if (jobs.length === 0) {
          toolContextLines.push("cron.list none");
        } else {
          const lines = jobs.slice(0, 20).map((job) => {
            const target = job.sessionTarget ?? "current";
            const next = job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toLocaleString() : "-";
            const last = job.state.lastStatus ?? "-";
            return `- ${job.id} | ${job.name} | ${formatCronScheduleLine(job)} | next=${next} | status=${last} | target=${target}`;
          });
          toolContextLines.push(`cron.list total=${jobs.length}`, ...lines);
        }
        immediateHandled += 1;
      }
    }

    appLogger.info({
      module: "cron",
      event: "tool_calls_processed",
      message: "已处理 Cron 工具调用",
      context: {
        total: calls.length,
        approvalQueued: queueRows.length,
        permissionQueued: permissionRequests.length,
        sourceTextLen: sourceTextForNotice.length
      }
    });
    return { queuedCount: queueRows.length + permissionRequests.length, immediateHandled, toolContextLines };
  };

  const removeCronJob = (jobId: string) => {
    kernel.removeCronJob(jobId);
    refreshCronJobs();
  };

  const setCronJobEnabled = (jobId: string, enabled: boolean) => {
    kernel.setCronJobEnabled(jobId, enabled);
    refreshCronJobs();
  };

  const retryCronJob = (jobId: string) => {
    kernel.retryCronJob(jobId);
    refreshCronJobs();
  };

  const runCronJobNow = (jobId: string) => {
    const result = kernel.enqueueCronRun(jobId, "force");
    refreshCronJobs();
    return result;
  };

  const approveCronRequest = async (approvalId: string, mode: CronApprovalMode = "once") => {
    const row = pendingApprovals.find((it) => it.id === approvalId);
    if (!row) return false;
    try {
      if (row.type === "add") {
        const schedule = parseScheduleFromPayload(row.payload);
        const name = String(row.payload.name ?? "Agent Cron");
        const message = String(row.payload.message ?? row.payload.text ?? "定时提醒");
        const deliveryMode = row.payload.deliveryMode === "none" ? "none" : "announce";
        const sessionTarget = typeof row.payload.sessionTarget === "string" ? row.payload.sessionTarget : "current";
        const deleteAfterRun = schedule.kind === "at";
        kernel.addCronJobByAgent({
          agentId: row.agentId,
          name,
          schedule,
          payload: {
            kind: "agentTurn",
            channelId: row.sessionId,
            message
          },
          deleteAfterRun,
          sessionTarget,
          delivery: deliveryMode === "none" ? { mode: "none" } : { mode: "announce" },
          timingClass: row.payload.timingClass === "exact_foreground" ? "exact_foreground" : "best_effort_background",
          runModelStrategy: "current_session"
        });
        appLogger.info({
          module: "cron",
          event: "cron_add_approved",
          message: "审批通过后创建 Cron 任务",
          context: {
            approvalId,
            sessionId: row.sessionId,
            sessionTarget,
            timezone: row.payload.timezone,
            resolutionMethod: row.payload.resolutionMethod,
            resolvedAtMs: row.payload.resolvedAtMs ?? row.payload.atMs
          }
        });
      } else if (row.type === "update") {
        const jobId = String(row.payload.jobId ?? "");
        if (!jobId) throw new Error("missing_job_id");
        kernel.updateCronJobByAgent(jobId, {
          name: typeof row.payload.name === "string" ? row.payload.name : undefined,
          enabled: typeof row.payload.enabled === "boolean" ? row.payload.enabled : undefined
        });
        if (mode === "always_for_job_update") {
          const grant: CronPermissionGrant = {
            id: uid("grant"),
            agentId: row.agentId,
            cronJobId: jobId,
            scope: "update",
            grantedAt: Date.now()
          };
          const nextGrants = [...cronPermissionGrants, grant];
          setCronPermissionGrants(nextGrants);
          await persistPreferences({ cronPermissionGrants: nextGrants });
        }
      } else if (row.type === "remove") {
        const jobId = String(row.payload.jobId ?? "");
        if (!jobId) throw new Error("missing_job_id");
        kernel.removeCronJobByAgent(jobId);
      } else if (row.type === "remove_all") {
        const requestedIds = Array.isArray(row.payload.jobIds)
          ? row.payload.jobIds.filter((id): id is string => typeof id === "string")
          : [];
        const result = kernel.removeAllCronJobsByAgent(requestedIds);
        if (result.removed <= 0) {
          throw new Error("no_jobs_removed");
        }
      }

      const resolved: CronApprovalRequest = { ...row, status: "approved", resolvedAt: Date.now() };
      const next = pendingApprovals.filter((it) => it.id !== approvalId);
      setPendingApprovals(next);
      await persistPreferences({ pendingCronApprovals: next });
      refreshCronJobs();
      appendAssistantNotice(`系统提示：已批准并执行：${summarizeApprovalAction(resolved)}。`, row.sessionId);
      appLogger.info({
        module: "cron",
        event: "cron_approval_approved",
        message: "Cron 审批通过并执行",
        context: { approvalId, type: row.type, mode }
      });
      return true;
    } catch (error) {
      appLogger.error({
        module: "cron",
        event: "cron_approval_execute_failed",
        message: "Cron 审批执行失败",
        context: { approvalId, type: row.type },
        error: error instanceof Error ? error.message : String(error)
      });
      appendAssistantNotice(`系统提示：Cron 审批执行失败（${error instanceof Error ? error.message : String(error)}）。`, row.sessionId);
      return false;
    }
  };

  const rejectCronRequest = async (approvalId: string) => {
    const row = pendingApprovals.find((it) => it.id === approvalId);
    if (!row) return false;
    const next = pendingApprovals.filter((it) => it.id !== approvalId);
    setPendingApprovals(next);
    await persistPreferences({ pendingCronApprovals: next });
    appendAssistantNotice(`系统提示：已拒绝：${summarizeApprovalAction(row)}。`, row.sessionId);
    appLogger.warn({
      module: "cron",
      event: "cron_approval_rejected",
      message: "Cron 审批已拒绝",
      context: { approvalId, type: row.type }
    });
    return true;
  };

  const approvePermissionRequest = async (requestId: string, mode: "once" | "always" = "once") => {
    const request = pendingPermissionRequests.find((it) => it.id === requestId);
    if (!request) return false;
    try {
      const payload = request.payload ?? {};
      if (request.action === "fs.write") {
        const path = String(payload.path ?? "").trim();
        const content = String(payload.content ?? "");
        const writeMode = payload.mode === "append" ? "append" : "replace";
        const written = kernel.writeToolAsset(path, content, writeMode);
        if (!written.ok) throw new Error(written.error ?? "write_failed");
        appendToolEvent("fs.write", "ok", `写入成功：${path}`, request.channelId);
      } else if (request.action === "exec.run") {
        const call: ToolCallRequest = {
          id: String(payload.toolCallId ?? uid("tool_call")),
          tool: "exec.run",
          source: "user_command",
          sessionId: request.channelId ?? sessionId,
          agentId: request.agentId,
          payload,
          createdAt: Date.now()
        };
        await executeImmediateToolCall(call);
      }
      if (mode === "always") {
        const grant: PermissionGrant = {
          id: uid("perm_grant"),
          scope: request.scope,
          granted: true,
          agentId: request.agentId,
          grantedBy: "user",
          grantedAt: Date.now(),
          note: "User approved in tools center"
        };
        const nextGrants = [...permissionGrants, grant];
        setPermissionGrants(nextGrants);
        await persistPreferences({ permissionGrants: nextGrants });
      }
      const next = pendingPermissionRequests.filter((it) => it.id !== requestId);
      setPendingPermissionRequests(next);
      await persistPreferences({ pendingPermissionRequests: next });
      appendAssistantNotice(`系统提示：已批准权限请求（${request.scope}）。`, request.channelId);
      appLogger.info({
        module: "tool",
        event: "permission_approved",
        message: "权限审批通过",
        context: { requestId, scope: request.scope, mode }
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendToolEvent(request.action ?? "tool", "error", `审批后执行失败：${message}`, request.channelId);
      appLogger.error({
        module: "tool",
        event: "permission_approve_failed",
        message: "权限审批执行失败",
        context: { requestId, scope: request.scope },
        error: message
      });
      return false;
    }
  };

  const rejectPermissionRequest = async (requestId: string) => {
    const request = pendingPermissionRequests.find((it) => it.id === requestId);
    if (!request) return false;
    const next = pendingPermissionRequests.filter((it) => it.id !== requestId);
    setPendingPermissionRequests(next);
    await persistPreferences({ pendingPermissionRequests: next });
    appendToolEvent(request.action ?? "tool", "blocked", `权限请求已拒绝（${request.scope}）`, request.channelId);
    appLogger.warn({
      module: "tool",
      event: "permission_rejected",
      message: "权限审批已拒绝",
      context: { requestId, scope: request.scope }
    });
    return true;
  };

  const approveTopPending = async () => {
    if (pendingApprovals.length > 0) return approveCronRequest(pendingApprovals[0]!.id, "once");
    if (pendingPermissionRequests.length > 0) return approvePermissionRequest(pendingPermissionRequests[0]!.id, "once");
    return false;
  };

  const rejectTopPending = async () => {
    if (pendingApprovals.length > 0) return rejectCronRequest(pendingApprovals[0]!.id);
    if (pendingPermissionRequests.length > 0) return rejectPermissionRequest(pendingPermissionRequests[0]!.id);
    return false;
  };

  useEffect(() => {
    if (!notificationsEnabled || cronExecutionRecords.length === 0) return;
    const latest = cronExecutionRecords[0];
    if (!latest) return;
    if (lastCronRecordRef.current === latest.runId) return;
    lastCronRecordRef.current = latest.runId;
    const prefix = latest.status === "ok" ? "任务执行成功" : "任务执行失败";
    const text = latest.errorSummary ? `${prefix}: ${latest.errorSummary}` : prefix;
    appLogger.info({
      module: "notification",
      event: latest.status === "ok" ? "task_succeeded" : "task_failed",
      message: "Cron 通知事件",
      context: { runId: latest.runId, jobId: latest.jobId, status: latest.status, source: "in_app" }
    });
    if (Platform.OS === "android") ToastAndroid.show(text, ToastAndroid.SHORT);
  }, [cronExecutionRecords, notificationsEnabled]);

  useEffect(() => {
    if (!sessionId) return;
    refreshSessionSnapshot(sessionId);
  }, [sessionId, cronExecutionRecords.length, pendingApprovals.length, pendingPermissionRequests.length]);

  useEffect(() => {
    const flowIds = new Set(
      messages
        .filter((msg) => msg.role === "system" && typeof msg.flowRunId === "string" && msg.flowRunId.length > 0)
        .map((msg) => msg.flowRunId as string)
    );
    if (!flowIds.size) return;
    setCollapsedFlowGroupIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of flowIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? [...next] : prev;
    });
  }, [messages]);

  const setThemePreference = async (preference: ThemePreference) => {
    setThemePreferenceState(preference);
    await persistPreferences({ themePreference: preference });
  };

  const setNotificationPreference = async (key: "notificationsEnabled" | "notificationSoundEnabled" | "notificationVibrationEnabled", value: boolean) => {
    if (key === "notificationsEnabled") setNotificationsEnabled(value);
    if (key === "notificationSoundEnabled") setNotificationSoundEnabled(value);
    if (key === "notificationVibrationEnabled") setNotificationVibrationEnabled(value);
    await persistPreferences({ [key]: value });
  };

  const setDeveloperModePreference = async (value: boolean) => {
    setDeveloperModeEnabled(value);
    await persistPreferences({ developerModeEnabled: value });
    appLogger.info({
      module: "app",
      event: value ? "developer_mode_enabled" : "developer_mode_disabled",
      message: value ? "开发者模式已开启" : "开发者模式已关闭"
    });
  };

  const createModel = async (input: { providerId: string; modelId: string; displayName?: string }) => {
    const providerId = input.providerId.trim();
    const rawModelId = input.modelId.trim();
    const modelId = providerId === "minimax" ? rawModelId.replace(/^minimax-portal\//, "") : rawModelId;
    if (!providerId || !modelId) throw new Error("providerId/modelId 不能为空");
    const key = `${providerId}:${modelId}`;
    const displayName = input.displayName?.trim() || `${providerId} / ${modelId}`;
    const exists = modelCatalog.some((item) => item.key === key);
    if (exists) return key;
    const nextCatalog = [...modelCatalog, { key, providerId, modelId, displayName, enabled: true }];
    setModelCatalog(nextCatalog);
    await persistPreferences({ modelCatalog: nextCatalog });
    return key;
  };

  const deleteModel = async (modelKey: string) => {
    const nextCatalog = modelCatalog.filter((m) => m.key !== modelKey);
    const nextMap: Record<string, string> = {};
    for (const [cid, mapped] of Object.entries(channelModelMap)) {
      if (mapped !== modelKey) nextMap[cid] = mapped;
    }
    setModelCatalog(nextCatalog);
    setChannelModelMap(nextMap);
    await persistPreferences({ modelCatalog: nextCatalog, channelModelMap: nextMap });
    if (sessionId) refreshChannelSnapshot(sessionId);
  };

  const listProviderModels = (providerId: string) => modelCatalog.filter((m) => m.providerId === providerId && m.enabled);

  const getPresetConfig = (providerId: string): OAuthClientConfig => {
    const saved = kernel.getOAuthClientConfig(providerId);
    if (saved) {
      const next = cloneConfig(saved);
      if (providerId === "minimax" && !next.apiBaseUrl) {
        next.apiBaseUrl = next.authEndpoint.includes("minimaxi.com")
          ? "https://api.minimaxi.com/anthropic"
          : "https://api.minimax.io/anthropic";
      }
      return next;
    }
    const preset = oauthPresets.find((p) => p.providerId === providerId);
    if (preset) return cloneConfig(preset.config);
    const spec = getProviderSpec(providerId);
    return {
      clientId: "",
      authEndpoint: "",
      tokenEndpoint: "",
      scopes: ["openid"],
      redirectUri: "mobileclaw://oauth",
      apiBaseUrl: spec?.defaultApiBase
    };
  };

  const oauthWizardStart = (flowMode: "initial" | "update" = "initial") => {
    setOauthWizard({ ...createDefaultWizard(), flowMode });
    appLogger.info({ module: "onboard", event: "wizard_start", message: "打开配置向导", context: { flowMode } });
  };

  const oauthWizardSelectProvider = (providerId: string) => {
    appLogger.debug({ module: "onboard", event: "select_provider", message: "选择 Provider", context: { providerId } });
    setOauthWizard((prev) => {
      const configDraft = getPresetConfig(providerId);
      const minimaxRegion = providerId === "minimax" ? inferMiniMaxRegionFromBase(configDraft.apiBaseUrl) : undefined;
      return {
        step: "auth_mode",
        providerId,
        flowMode: prev.flowMode ?? "initial",
        authMode: undefined,
        parameterSource: "preset",
        byokKey: "",
        pendingByokKey: "",
        pendingTokens: undefined,
        committed: false,
        minimaxRegion,
        configDraft,
        status: "",
        error: ""
      };
    });
  };

  const oauthWizardSelectAuthMode = (authMode: AuthMode) => {
    appLogger.debug({ module: "onboard", event: "select_auth_mode", message: "选择鉴权方式", context: { authMode } });
    setOauthWizard((prev) => {
      if (!prev.providerId) return { ...prev, error: "请先选择 Provider" };
      if (authMode === "BYOK") {
        return { ...prev, authMode, step: "params", error: "", status: "" };
      }
      return { ...prev, authMode, step: "param_source", error: "", status: "" };
    });
  };

  const oauthWizardSelectMiniMaxRegion = (region: "global" | "cn") => {
    setOauthWizard((prev) => {
      if (prev.providerId !== "minimax") return prev;
      const preset = minimaxOAuthPresets[region];
      return {
        ...prev,
        minimaxRegion: region,
        configDraft: {
          ...(prev.configDraft ?? {}),
          ...preset,
          redirectUri: prev.configDraft?.redirectUri ?? "mobileclaw://oauth",
          extraAuthParams: prev.configDraft?.extraAuthParams
        },
        error: ""
      };
    });
    appLogger.info({
      module: "onboard",
      event: "select_minimax_region",
      message: "选择 MiniMax 区域",
      context: { providerId: "minimax", region }
    });
  };

  const oauthWizardSelectParamSource = (source: OAuthParamSource) => {
    appLogger.debug({ module: "onboard", event: "select_param_source", message: "选择参数来源", context: { source } });
    setOauthWizard((prev) => {
      if (!prev.providerId) return { ...prev, error: "请先选择 Provider" };
      if (prev.authMode !== "OAUTH") return prev;
      const nextConfig = source === "preset"
        ? getPresetConfig(prev.providerId)
        : (prev.configDraft ? cloneConfig(prev.configDraft) : getPresetConfig(prev.providerId));
      const minimaxRegion = prev.providerId === "minimax" ? inferMiniMaxRegionFromBase(nextConfig.apiBaseUrl) : prev.minimaxRegion;
      return {
        ...prev,
        parameterSource: source,
        minimaxRegion,
        configDraft: nextConfig,
        step: source === "preset" ? "authorize" : "param_source",
        error: ""
      };
    });
  };

  const oauthWizardUpdateConfig = (patch: Partial<OAuthClientConfig>) => {
    setOauthWizard((prev) => {
      const base = prev.configDraft ?? {
        clientId: "",
        authEndpoint: "",
        tokenEndpoint: "",
        scopes: [],
        redirectUri: "mobileclaw://oauth"
      };
      return {
        ...prev,
        configDraft: {
          ...base,
          ...patch
        },
        error: ""
      };
    });
  };

  const oauthWizardUpdateByokKey = (key: string) => {
    setOauthWizard((prev) => ({ ...prev, byokKey: key, error: "" }));
  };

  const oauthWizardBack = () => {
    setOauthWizard((prev) => {
      if (prev.step === "done") return { ...prev, step: "provider", error: "", status: "" };
      if (prev.step === "exchange" || prev.step === "authorize") {
        if (prev.authMode === "OAUTH") return { ...prev, step: "param_source", error: "", status: "" };
        return { ...prev, step: "params", error: "", status: "" };
      }
      if (prev.step === "params") {
        if (prev.authMode === "OAUTH") return { ...prev, step: "param_source", error: "" };
        return { ...prev, step: "auth_mode", error: "" };
      }
      if (prev.step === "param_source") return { ...prev, step: "auth_mode", error: "" };
      if (prev.step === "auth_mode") return { ...createDefaultWizard(), providerId: prev.providerId };
      return createDefaultWizard();
    });
  };

  const oauthWizardNext = () => {
    setOauthWizard((prev) => {
      if (prev.step === "provider") {
        if (!prev.providerId) return { ...prev, error: "请选择 Provider" };
        return { ...prev, step: "auth_mode", error: "" };
      }
      if (prev.step === "auth_mode") {
        if (!prev.authMode) return { ...prev, error: "请选择鉴权方式" };
        return { ...prev, step: prev.authMode === "OAUTH" ? "param_source" : "params", error: "" };
      }
      if (prev.step === "param_source") {
        if (prev.authMode !== "OAUTH") return prev;
        if (prev.parameterSource === "preset") {
          return { ...prev, step: "authorize", error: "" };
        }
        return { ...prev, step: "authorize", error: "" };
      }
      if (prev.step === "params") {
        return { ...prev, step: "authorize", error: "" };
      }
      return prev;
    });
  };

  const oauthWizardRetry = () => {
    setOauthWizard((prev) => ({ ...prev, error: "", status: "", step: prev.authMode === "OAUTH" ? "authorize" : "authorize" }));
  };

  const oauthWizardCancel = () => {
    if (oauthRunRef.current) oauthRunRef.current.cancelled = true;
    setOauthWizardBusy(false);
    setOauthWizard((prev) => ({
      ...prev,
      status: "已停止当前授权流程",
      error: "",
      step: prev.authMode === "OAUTH" ? "param_source" : "params"
    }));
    appLogger.warn({ module: "onboard", event: "oauth_cancel", message: "用户停止授权流程" });
  };

  const oauthWizardExit = () => {
    if (oauthRunRef.current) oauthRunRef.current.cancelled = true;
    setOauthWizardBusy(false);
    setOauthWizard(createDefaultWizard());
    setActiveTab("models");
    appLogger.info({ module: "onboard", event: "wizard_exit", message: "退出配置向导" });
  };

  const providerStatusMap = useMemo(() => {
    const pendingProviderId = oauthWizard.step === "done" && !oauthWizard.committed ? oauthWizard.providerId : undefined;
    const status: Record<string, ProviderSetupStatus> = {};
    for (const provider of visibleProviders) {
      if (provider.id === pendingProviderId) {
        status[provider.id] = "pending_commit";
      } else if (providerCredentialMap[provider.id]) {
        status[provider.id] = "configured";
      } else {
        status[provider.id] = "unconfigured";
      }
    }
    return status;
  }, [oauthWizard.step, oauthWizard.committed, oauthWizard.providerId, providerCredentialMap]);

  const pendingApprovalPeek = useMemo(() => {
    const firstCron = pendingApprovals[0];
    const firstPerm = pendingPermissionRequests[0];
    const total = pendingApprovals.length + pendingPermissionRequests.length;
    if (!total) return null;
    if (firstCron) {
      return {
        kind: "cron" as const,
        id: firstCron.id,
        total,
        summary: summarizeApprovalRequest(firstCron)
      };
    }
    if (firstPerm) {
      return {
        kind: "permission" as const,
        id: firstPerm.id,
        total,
        summary: `${firstPerm.action ?? "tool.call"}（${firstPerm.scope}）待审批`
      };
    }
    return null;
  }, [pendingApprovals, pendingPermissionRequests]);

  const oauthWizardApply = async () => {
    const snapshot = oauthWizard;
    if (!snapshot.providerId || !snapshot.authMode) {
      setOauthWizard((prev) => ({ ...prev, error: "请先完成配置流程" }));
      return;
    }
    try {
      if (snapshot.authMode === "BYOK") {
        const key = snapshot.pendingByokKey?.trim() || snapshot.byokKey?.trim() || "";
        if (!key) throw new Error("API Key 不能为空");
        if (snapshot.configDraft) kernel.setOAuthClientConfig(snapshot.providerId, snapshot.configDraft);
        await configureByok(snapshot.providerId, key);
      } else {
        if (!snapshot.pendingTokens?.accessToken) throw new Error("尚未拿到 OAuth token，请先执行授权");
        if (snapshot.configDraft) kernel.setOAuthClientConfig(snapshot.providerId, snapshot.configDraft);
        await configureOAuthTokens(snapshot.providerId, snapshot.pendingTokens);
      }

      const apiBaseUrl = snapshot.pendingTokens?.resourceUrl || snapshot.configDraft?.apiBaseUrl || providerApiBaseMap[snapshot.providerId];
      if (apiBaseUrl) {
        const next = { ...providerApiBaseMap, [snapshot.providerId]: apiBaseUrl };
        setProviderApiBaseMap(next);
        await persistPreferences({ providerApiBaseMap: next });
      }
      if (snapshot.providerId === "minimax") {
        minimaxByokFailureByRegionRef.current = { global: 0, cn: 0 };
      }

      setOauthWizard((prev) => ({ ...prev, committed: true, status: "配置已更新", error: "" }));
      setOnboardingRequired(false);
      if (sessionId) refreshChannelSnapshot(sessionId);
      setActiveTab("models");
      appLogger.info({
        module: "onboard",
        event: "apply_success",
        message: "配置已提交",
        context: { providerId: snapshot.providerId, authMode: snapshot.authMode }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOauthWizard((prev) => ({ ...prev, error: msg, status: "" }));
      appLogger.error({ module: "onboard", event: "apply_failed", message: "配置提交失败", error: msg });
    }
  };

  const oauthWizardComplete = async () => {
    if (oauthWizardBusy) return;
    const snapshot = oauthWizard;
    if (!snapshot.providerId || !snapshot.authMode) {
      setOauthWizard((prev) => ({ ...prev, error: "Provider 或鉴权方式未完成选择" }));
      return;
    }

    try {
      const runId = Date.now();
      oauthRunRef.current = { id: runId, cancelled: false };
      setOauthWizardBusy(true);
      if (snapshot.authMode === "BYOK") {
        const key = snapshot.byokKey?.trim() ?? "";
        if (!key) throw new Error("API Key 不能为空");
        if (snapshot.providerId === "minimax" && !snapshot.configDraft?.apiBaseUrl) {
          throw new Error("请先选择 MiniMax 区域（Global/CN）");
        }
        setOauthWizard((prev) => ({ ...prev, step: "authorize", status: "正在校验 API Key...", error: "" }));
        setOauthWizard((prev) => ({
          ...prev,
          step: "done",
          pendingByokKey: key,
          status: "API Key 已准备，点击“更新配置”后生效",
          error: "",
          lastSuccessAt: Date.now()
        }));
        appLogger.info({
          module: "onboard",
          event: "byok_ready",
          message: "BYOK 已校验并进入待提交态",
          context: { providerId: snapshot.providerId }
        });
        return;
      }

      const config = snapshot.configDraft;
      if (!config) throw new Error("OAuth 配置缺失，请返回上一步选择默认配置");
      if (!config.authEndpoint.trim()) throw new Error("缺少授权地址，请切到手动模式补全");
      if (!config.tokenEndpoint.trim()) throw new Error("缺少 Token 地址，请切到手动模式补全");
      if (!config.redirectUri.trim()) throw new Error("缺少回调地址，请切到手动模式补全");
      if (!config.scopes.length) throw new Error("缺少授权范围，请切到手动模式补全");

      const normalizedConfig: OAuthClientConfig = {
        ...config,
        clientId: config.clientId.trim() || `mobileclaw_${snapshot.providerId}_public`,
        scopes: config.scopes.filter(Boolean),
        redirectUri: config.redirectUri.trim()
      };

      const isCancelled = () => oauthRunRef.current?.id === runId && oauthRunRef.current?.cancelled === true;
      const ensureActive = () => {
        if (isCancelled()) throw new Error("授权已取消");
      };

      let tokens;
      if (snapshot.providerId === "minimax") {
        setOauthWizard((prev) => ({ ...prev, step: "authorize", status: "正在初始化 MiniMax 授权...", error: "" }));
        const started = await startMiniMaxDeviceOAuth(normalizedConfig, snapshot.providerId);
        ensureActive();
        setOauthWizard((prev) => ({
          ...prev,
          step: "exchange",
          status: `请在网页完成授权，授权码：${started.userCode}`
        }));
        tokens = await pollMiniMaxDeviceToken({
          config: normalizedConfig,
          userCode: started.userCode,
          codeVerifier: started.codeVerifier,
          intervalMs: started.intervalMs,
          expiresAtMs: started.expiresAtMs,
          isCancelled,
          onTick: (message) => {
            setOauthWizard((prev) => ({ ...prev, step: "exchange", status: message }));
          }
        });
      } else {
        setOauthWizard((prev) => ({ ...prev, step: "authorize", status: "正在拉起授权网页...", error: "" }));
        const started = await startOAuth(normalizedConfig, snapshot.providerId);
        ensureActive();

        setOauthWizard((prev) => ({ ...prev, step: "exchange", status: "等待授权回调中..." }));
        const code = await waitForOAuthRedirect(started.redirectUri, started.state);
        ensureActive();

        setOauthWizard((prev) => ({ ...prev, step: "exchange", status: "正在交换 Token..." }));
        tokens = await exchangeCodeForToken(normalizedConfig, code, started.codeVerifier);
      }
      if (!tokens?.accessToken) throw new Error("未拿到 access token，请重试");
      setOauthWizard((prev) => ({
        ...prev,
        step: "done",
        configDraft: normalizedConfig,
        pendingTokens: tokens,
        status: "OAuth 已完成，点击“更新配置”后生效",
        error: "",
        lastSuccessAt: Date.now()
      }));
      appLogger.info({
        module: "onboard",
        event: "oauth_ready",
        message: "OAuth 已完成并进入待提交态",
        context: { providerId: snapshot.providerId, hasResourceUrl: Boolean(tokens.resourceUrl) }
      });
    } catch (err) {
      if (err instanceof Error && err.message === "授权已取消") {
        setOauthWizard((prev) => ({
          ...prev,
          status: "授权已取消，可重新发起或切换配置",
          error: "",
          step: "param_source"
        }));
        return;
      }
      setOauthWizard((prev) => ({
        ...prev,
        error: normalizeOAuthError(err),
        status: ""
      }));
      appLogger.error({
        module: "onboard",
        event: "oauth_failed",
        message: "OAuth 流程失败",
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setOauthWizardBusy(false);
      oauthRunRef.current = null;
    }
  };

  return {
    ready,
    theme,
    themePreference,
    setThemePreference,
    activeTab,
    setActiveTab,
    openTools: () => setActiveTab("tasks"),
    openModels: () => setActiveTab("models"),
    openOnboarding: () => {
      oauthWizardStart("initial");
      setActiveTab("onboard");
    },
    openProviderSetup: (providerId?: string) => {
      oauthWizardStart("update");
      if (providerId) oauthWizardSelectProvider(providerId);
      setActiveTab("onboard");
    },
    onboardingRequired,
    finishOnboarding: () => {
      setOnboardingRequired(false);
      setActiveTab("models");
    },
    sessionId,
    channelId: sessionId,
    resolvedModel,
    lastError,
    messages,
    collapsedFlowGroupIds,
    toggleFlowGroup: (flowId: string) =>
      setCollapsedFlowGroupIds((prev) => (prev.includes(flowId) ? prev.filter((id) => id !== flowId) : [...prev, flowId])),
    isSending,
    isToolLooping,
    reactRunState,
    sendStartedAt,
    sendTimeoutLevel,
    sendTimeoutDismissed,
    clearSendTimeoutHint: () => setSendTimeoutDismissed(true),
    send,
    stopToolLoop,
    retryLast,
    refreshSessionSnapshot,
    currentModel: resolveSelectedModel(sessionId)?.key ?? "",
    currentModelInfo: resolveSelectedModel(sessionId),
    availableModels: listEnabledModels(),
    switchModel,
    switchSession,
    createSession,
    renameSession,
    deleteSession,
    getSessionModelDisplay,
    sessions: kernel.channels.listChannels(ws.id),
    switchChannel: switchSession,
    createChannel: createSession,
    channels: kernel.channels.listChannels(ws.id),
    cronJobs,
    cronExecutionRecords,
    pendingApprovals,
    pendingPermissionRequests,
    pendingApprovalPeek,
    approveTopPending,
    rejectTopPending,
    cronPermissionGrants,
    permissionGrants,
    approvalBannerText,
    providerCredentialMap,
    providerStatusMap,
    providers: visibleProviders,
    logs,
    clearLogs: () => appLogger.clear(),
    listProviderModels,
    createModel,
    deleteModel,
    notificationsEnabled,
    notificationSoundEnabled,
    notificationVibrationEnabled,
    setNotificationPreference,
    developerModeEnabled,
    setDeveloperModePreference,
    oauthPresets,
    oauthWizard,
    oauthWizardBusy,
    oauthWizardStart,
    oauthWizardSelectProvider,
    oauthWizardSelectAuthMode,
    oauthWizardSelectMiniMaxRegion,
    oauthWizardSelectParamSource,
    oauthWizardUpdateConfig,
    oauthWizardUpdateByokKey,
    oauthWizardBack,
    oauthWizardNext,
    oauthWizardRetry,
    oauthWizardCancel,
    oauthWizardExit,
    oauthWizardApply,
    oauthWizardComplete,
    listAssets: (
      role: AssetViewerRole,
      options?: {
        scope?: AssetListScope;
        sessionId?: string;
        channelId?: string;
      }
    ): AssetDoc[] => kernel.listAssetsWithScope(role, {
      scope: options?.scope,
      channelId: options?.sessionId ?? options?.channelId
    }),
    listAssetTree: (
      role: AssetViewerRole,
      options?: {
        scope?: AssetListScope;
        sessionId?: string;
        channelId?: string;
      }
    ): AssetTreeNode[] => kernel.listAssetTree(role, {
      scope: options?.scope,
      channelId: options?.sessionId ?? options?.channelId
    }),
    readAsset: (role: AssetViewerRole, path: string): AssetDoc | null => kernel.readAsset(role, path),
    exportAsset: (path: string): string | null => kernel.exportAsset(path),
    removeCronJob,
    setCronJobEnabled,
    retryCronJob,
    runCronJobNow,
    approveCronRequest,
    rejectCronRequest,
    approvePermissionRequest,
    rejectPermissionRequest,
    toolExecutionRecords,
    clearApprovalBanner: () => setApprovalBannerText(""),
    configureByok,
    configureOAuth,
    configureOAuthTokens,
    setOAuthClientConfig: (providerId: string, config: OAuthClientConfig) => kernel.setOAuthClientConfig(providerId, config),
    getOAuthClientConfig: (providerId: string) => kernel.getOAuthClientConfig(providerId),
    initializeAll
  };
}

function normalizeOAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/state mismatch/i.test(msg)) return "授权校验失败，请重新发起授权";
  if (/timed out/i.test(msg)) return "授权超时，请在浏览器完成后返回 App";
  if (/network request failed/i.test(msg)) return "网络连接失败，请检查网络后重试";
  if (/1004/.test(msg) || /not login/i.test(msg)) {
    return "MiniMax 返回 not login（1004）。请确认当前区域选择是否正确后重试。";
  }
  return msg;
}
