import type { CapabilityDescriptor, ToolCallRequest, ToolPlanStep } from "../../../src/types/contracts";
import { uid } from "../../../src/core/utils/id";

export const DEFAULT_CAPABILITIES: CapabilityDescriptor[] = [
  { tool: "time.now", enabled: true, requiresApproval: false, domain: "time" },
  { tool: "cron.add", enabled: true, requiresApproval: true, domain: "cron" },
  { tool: "cron.update", enabled: true, requiresApproval: true, domain: "cron" },
  { tool: "cron.remove", enabled: true, requiresApproval: true, domain: "cron" },
  { tool: "cron.remove_all", enabled: true, requiresApproval: true, domain: "cron" },
  { tool: "cron.run", enabled: true, requiresApproval: false, domain: "cron" },
  { tool: "cron.status", enabled: true, requiresApproval: false, domain: "cron" },
  { tool: "cron.list", enabled: true, requiresApproval: false, domain: "cron" },
  { tool: "fs.read", enabled: true, requiresApproval: false, domain: "filesystem" },
  { tool: "fs.list", enabled: true, requiresApproval: false, domain: "filesystem" },
  { tool: "fs.write", enabled: true, requiresApproval: true, domain: "filesystem" },
  { tool: "exec.run", enabled: true, requiresApproval: true, domain: "system" }
];

export function planToolsByIntent(text: string): ToolPlanStep[] {
  const v = text.trim();
  if (!v) return [];
  if (/(现在|当前).*(几点|时间)|what time/i.test(v)) {
    return [{ tool: "time.now", reason: "time_truth_required" }];
  }
  if (/(多少|几个).*(定时|cron|任务)/i.test(v)) {
    return [{ tool: "cron.status", reason: "cron_fact_query" }];
  }
  if (/(定时|cron|任务).*(内容|详情|列表|明细|有哪些|都是什么)/i.test(v)) {
    return [{ tool: "cron.list", reason: "cron_listing_query" }];
  }
  if (/(读取|查看|列出).*(目录|文件夹)|\b(ls|list)\b/i.test(v)) {
    return [{ tool: "fs.list", reason: "directory_listing_required" }];
  }
  return [];
}

export function toPlannedToolCalls(
  plans: ToolPlanStep[],
  sessionId: string,
  agentId: string
): ToolCallRequest[] {
  return plans.map((p) => ({
    id: uid("tool_call"),
    tool: p.tool,
    source: "user_command",
    sessionId,
    agentId,
    payload: {},
    createdAt: Date.now()
  }));
}
