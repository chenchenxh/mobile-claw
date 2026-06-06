import { uid } from "../../../src/core/utils/id";
import type { ToolCallRequest } from "../../../src/types/contracts";

const SUPPORTED_TOOLS = new Set([
  "cron.add",
  "cron.update",
  "cron.remove",
  "cron.remove_all",
  "cron.run",
  "cron.status",
  "cron.list",
  "time.now",
  "fs.read",
  "fs.list",
  "fs.write",
  "exec.run"
]);

function parseJsonCandidate(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseToolCallFromInlineLine(
  line: string,
  source: ToolCallRequest["source"],
  sessionId: string,
  agentId: string,
  sourceMessageId?: string
): ToolCallRequest | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const directJson = parseJsonCandidate(trimmed);
  if (directJson) return normalizeToolCall(directJson, source, sessionId, agentId, sourceMessageId);

  const toolAndJson = /^(cron\.[a-z_]+|time\.now|fs\.[a-z_]+|exec\.run)\s+(\{[\s\S]*\})$/i.exec(trimmed);
  if (toolAndJson) {
    const parsed = parseJsonCandidate(toolAndJson[2] ?? "");
    if (parsed && typeof parsed === "object") {
      return normalizeToolCall(
        { tool: toolAndJson[1], args: parsed },
        source,
        sessionId,
        agentId,
        sourceMessageId
      );
    }
  }
  return null;
}

function normalizePathValue(raw: string): string {
  return raw.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/^[\\/]+/, "").replace(/[，。,；;？?\s]+$/g, "");
}

export function extractWorkspacePathFromUtterance(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const explicit = /((?:workspace|agents|cron|memory)(?:\/[^\s，。,；;？?]*)?)/i.exec(trimmed)?.[1];
  if (explicit) {
    return normalizePathValue(explicit);
  }

  const workspaceSubdir =
    /workspace\s*(?:下|下面|里|中)?\s*([A-Za-z0-9._\-/]+)\s*(?:目录|文件夹|文件)?/i.exec(trimmed)?.[1] ??
    /workspace\s*\/\s*([A-Za-z0-9._\-/]+)/i.exec(trimmed)?.[1];
  if (workspaceSubdir) {
    const sub = normalizePathValue(workspaceSubdir);
    if (!sub) return "workspace";
    if (sub.toLowerCase().startsWith("workspace")) return sub;
    return `workspace/${sub}`;
  }

  if (/workspace/i.test(trimmed)) return "workspace";
  return null;
}

function normalizeToolCall(
  input: unknown,
  source: ToolCallRequest["source"],
  sessionId: string,
  agentId: string,
  sourceMessageId?: string
): ToolCallRequest | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const tool = typeof row.tool === "string" ? row.tool : typeof row.name === "string" ? row.name : "";
  if (!SUPPORTED_TOOLS.has(tool)) return null;
  const payloadCandidate = row.args ?? row.payload ?? {};
  const payload = payloadCandidate && typeof payloadCandidate === "object" ? (payloadCandidate as Record<string, unknown>) : {};
  return {
    id: uid("tool_call"),
    tool: tool as ToolCallRequest["tool"],
    source,
    sessionId,
    agentId,
    payload,
    createdAt: Date.now(),
    sourceMessageId
  };
}

export function parseStructuredCronToolCalls(
  text: string,
  sessionId: string,
  agentId: string,
  sourceMessageId?: string
): ToolCallRequest[] {
  const calls: ToolCallRequest[] = [];

  const pushOne = (candidate: unknown) => {
    const one = normalizeToolCall(candidate, "assistant_structured", sessionId, agentId, sourceMessageId);
    if (one) calls.push(one);
  };

  const tagRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  for (const match of text.matchAll(tagRegex)) {
    const parsed = parseJsonCandidate(match[1] ?? "");
    if (Array.isArray(parsed)) parsed.forEach(pushOne);
    else pushOne(parsed);
  }

  const vendorTagRegex = /<[a-z0-9_-]+:tool_call[^>]*>([\s\S]*?)<\/[a-z0-9_-]+:tool_call>/gi;
  for (const match of text.matchAll(vendorTagRegex)) {
    const body = (match[1] ?? "").trim();
    const parsed = parseJsonCandidate(body);
    if (Array.isArray(parsed)) {
      parsed.forEach(pushOne);
      continue;
    }
    if (parsed) {
      pushOne(parsed);
      continue;
    }
    const invokeRegex = /<invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/gi;
    for (const invoke of body.matchAll(invokeRegex)) {
      const tool = (invoke[1] ?? "").trim();
      const argsRaw = (invoke[2] ?? "").trim();
      const parsedArgs = parseJsonCandidate(argsRaw);
      const payload = parsedArgs && typeof parsedArgs === "object" ? parsedArgs : {};
      pushOne({ tool, args: payload });
    }
  }

  const invokeOnlyRegex = /<invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/gi;
  for (const invoke of text.matchAll(invokeOnlyRegex)) {
    const tool = (invoke[1] ?? "").trim();
    const argsRaw = (invoke[2] ?? "").trim();
    const parsed = parseJsonCandidate(argsRaw);
    const payload = parsed && typeof parsed === "object" ? parsed : {};
    pushOne({ tool, args: payload });
  }

  const blockRegex = /```(?:tool_call|toolcall|json)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(blockRegex)) {
    const parsed = parseJsonCandidate((match[1] ?? "").trim());
    if (Array.isArray(parsed)) parsed.forEach(pushOne);
    else pushOne(parsed);
  }

  const lineRegex = /^\s*\[Tool_Call\]\s*(.+)$/gim;
  for (const match of text.matchAll(lineRegex)) {
    const parsed = parseToolCallFromInlineLine(match[1] ?? "", "assistant_structured", sessionId, agentId, sourceMessageId);
    if (parsed) calls.push(parsed);
  }

  const deduped: ToolCallRequest[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    const key = `${call.tool}|${JSON.stringify(call.payload ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(call);
  }

  return deduped;
}

export function parseUserRemindCommand(
  input: string,
  sessionId: string,
  agentId: string
): ToolCallRequest | null {
  const trimmed = input.trim();
  const now = Date.now();
  const match = /^\/remind\s+(\d+)([mhd])\s+(.+)$/i.exec(trimmed);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const message = (match[3] ?? "").trim();
  if (!amount || !message) return null;
  const multiplier = unit === "h" ? 3600_000 : unit === "d" ? 86_400_000 : 60_000;
  return {
    id: uid("tool_call"),
    tool: "cron.add",
    source: "user_command",
    sessionId,
    agentId,
    payload: {
      name: `Reminder (${amount}${unit})`,
      atMs: now + amount * multiplier,
      message,
      deliveryMode: "announce",
      sessionTarget: "current",
      timingClass: "best_effort_background"
    },
    createdAt: Date.now()
  };
}

export function parseNaturalReminderCommand(
  input: string,
  sessionId: string,
  agentId: string
): ToolCallRequest | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const now = Date.now();

  const inMinutes = /(\d+)\s*分钟后提醒我(.+)/i.exec(trimmed);
  if (inMinutes?.[1] && inMinutes?.[2]) {
    const amount = Math.max(1, Number(inMinutes[1]));
    const message = inMinutes[2].trim();
    if (!message) return null;
    return {
      id: uid("tool_call"),
      tool: "cron.add",
      source: "user_command",
      sessionId,
      agentId,
      payload: {
        name: `Reminder (${amount}m)`,
        atMs: now + amount * 60_000,
        message,
        deliveryMode: "announce",
        sessionTarget: "current",
        timingClass: "best_effort_background"
      },
      createdAt: now
    };
  }

  const later = /稍后提醒我(.+)/i.exec(trimmed);
  if (later?.[1]) {
    const message = later[1].trim();
    if (!message) return null;
    return {
      id: uid("tool_call"),
      tool: "cron.add",
      source: "user_command",
      sessionId,
      agentId,
      payload: {
        name: "Reminder (later)",
        atMs: now + 5 * 60_000,
        message,
        deliveryMode: "announce",
        sessionTarget: "current",
        timingClass: "best_effort_background"
      },
      createdAt: now
    };
  }
  return null;
}

export function parseUserCronCommand(
  input: string,
  sessionId: string,
  agentId: string
): ToolCallRequest | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const isListQuery =
    /(定时|cron|任务).*(内容|详情|明细|列表|有哪些|都是什么)/i.test(trimmed) ||
    /^\/cron\s+list$/i.test(trimmed);
  if (isListQuery) {
    return {
      id: uid("tool_call"),
      tool: "cron.list",
      source: "user_command",
      sessionId,
      agentId,
      payload: { includeDisabled: true },
      createdAt: Date.now()
    };
  }
  const isCountQuery =
    /(现在|当前|目前)?有?多少.*(定时|cron|任务)/i.test(trimmed) ||
    /几个.*(定时|cron|任务)/i.test(trimmed);
  if (isCountQuery || /^\/cron\s+status$/i.test(trimmed)) {
    return {
      id: uid("tool_call"),
      tool: "cron.status",
      source: "user_command",
      sessionId,
      agentId,
      payload: {},
      createdAt: Date.now()
    };
  }
  const isRemoveAll =
    /(删除|清空|移除).*(所有|全部).*(定时|cron|任务)/i.test(trimmed) ||
    /(清空|删掉|删除).*(定时|cron|任务)/i.test(trimmed) ||
    /^\/cron\s+remove-all$/i.test(lower);
  if (isRemoveAll) {
    return {
      id: uid("tool_call"),
      tool: "cron.remove_all",
      source: "user_command",
      sessionId,
      agentId,
      payload: {},
      createdAt: Date.now()
    };
  }
  return null;
}

export function parseUserSystemToolCommand(
  input: string,
  sessionId: string,
  agentId: string
): ToolCallRequest | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  const timeMatch = /^\/time(?:\s+now)?$/i.exec(trimmed);
  const naturalTimeIntent = /(现在|当前|此刻).*(几点|时间)|what time is it|current time/i.test(trimmed);
  if (timeMatch || naturalTimeIntent) {
    return {
      id: uid("tool_call"),
      tool: "time.now",
      source: "user_command",
      sessionId,
      agentId,
      payload: {},
      createdAt: Date.now()
    };
  }
  const readMatch = /^\/read\s+(.+)$/i.exec(trimmed);
  const naturalReadMatch = /(?:读取|查看|打开|read)\s+([^\s]+(?:\.md|\.json|\.txt))/i.exec(trimmed);
  if (readMatch?.[1] || naturalReadMatch?.[1]) {
    return {
      id: uid("tool_call"),
      tool: "fs.read",
      source: "user_command",
      sessionId,
      agentId,
      payload: { path: (readMatch?.[1] ?? naturalReadMatch?.[1] ?? "").trim() },
      createdAt: Date.now()
    };
  }
  const listMatch = /^\/(?:list|ls)\s*(.*)$/i.exec(trimmed);
  const naturalListMatch =
    /(?:列一下|列出|看看|查看).*(workspace|目录|文件夹|文件)/i.test(trimmed) ||
    /(workspace|目录|文件夹).*(有什么|有哪些|包含|下面).*(文件|内容)/i.test(trimmed) ||
    /(workspace|目录|文件夹).*(文件|内容).*(有什么|有哪些)/i.test(trimmed);
  const extractedPath = extractWorkspacePathFromUtterance(trimmed);
  if (listMatch || naturalListMatch) {
    const inferredPath =
      (listMatch?.[1] ?? "").trim() ||
      (extractedPath ?? "").trim() ||
      (normalized.includes("workspace") ? "workspace" : normalized.includes("cron") ? "cron" : "");
    return {
      id: uid("tool_call"),
      tool: "fs.list",
      source: "user_command",
      sessionId,
      agentId,
      payload: { path: inferredPath },
      createdAt: Date.now()
    };
  }
  const writeMatch = /^\/write\s+(\S+)\s+([\s\S]+)$/i.exec(trimmed);
  if (writeMatch?.[1] && writeMatch?.[2]) {
    return {
      id: uid("tool_call"),
      tool: "fs.write",
      source: "user_command",
      sessionId,
      agentId,
      payload: { path: writeMatch[1].trim(), content: writeMatch[2].trim(), mode: "replace" },
      createdAt: Date.now()
    };
  }
  const execMatch = /^\/exec\s+([\s\S]+)$/i.exec(trimmed);
  if (execMatch?.[1]) {
    return {
      id: uid("tool_call"),
      tool: "exec.run",
      source: "user_command",
      sessionId,
      agentId,
      payload: { command: execMatch[1].trim() },
      createdAt: Date.now()
    };
  }
  return null;
}
