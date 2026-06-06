export interface ReminderTimeResolution {
  resolvedAtMs: number;
  resolutionMethod: "local" | "model" | "merged";
  timezone: string;
  sourceTimeMs: number;
  modelAtMs?: number;
  localAtMs?: number;
  conflict?: boolean;
}

const ONE_MINUTE_MS = 60_000;
const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;

function normalizeTimestampMs(raw: unknown): number | null {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num < 1_000_000_000_000) return Math.floor(num * 1000);
  return Math.floor(num);
}

export function validateAtMs(atMs: number, nowMs: number): { ok: true } | { ok: false; reason: string } {
  const diffMs = atMs - nowMs;
  if (diffMs < -ONE_MINUTE_MS) return { ok: false, reason: "时间早于当前超过 1 分钟" };
  if (diffMs > TEN_YEARS_MS) return { ok: false, reason: "时间晚于当前超过 10 年" };
  return { ok: true };
}

function resolveTodayOrTomorrowHourMinute(base: Date, dayOffset: number, hour: number, minute: number): number {
  const d = new Date(base.getTime());
  d.setSeconds(0, 0);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

export function resolveReminderLocalAtMs(input: string, nowMs: number): number | null {
  const text = input.trim();
  if (!text) return null;
  const now = new Date(nowMs);

  const relative = /(\d+)\s*(分钟|分|小时|天|m|h|d)\s*后/i.exec(text);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const multiplier =
      unit === "小时" || unit === "h"
        ? 3600_000
        : unit === "天" || unit === "d"
          ? 86_400_000
          : 60_000;
    if (amount > 0) return nowMs + amount * multiplier;
  }

  const tomorrow = /明天\s*(\d{1,2})(?:[:点时]\s*(\d{1,2}))?/.exec(text);
  if (tomorrow) {
    const hour = Math.max(0, Math.min(23, Number(tomorrow[1] ?? 0)));
    const minute = Math.max(0, Math.min(59, Number(tomorrow[2] ?? 0)));
    return resolveTodayOrTomorrowHourMinute(now, 1, hour, minute);
  }

  const today = /今天\s*(\d{1,2})(?:[:点时]\s*(\d{1,2}))?/.exec(text);
  if (today) {
    const hour = Math.max(0, Math.min(23, Number(today[1] ?? 0)));
    const minute = Math.max(0, Math.min(59, Number(today[2] ?? 0)));
    return resolveTodayOrTomorrowHourMinute(now, 0, hour, minute);
  }

  return null;
}

export function resolveReminderAtMs(params: {
  userText: string;
  modelAtMsRaw?: unknown;
  nowMs: number;
  timezone: string;
  conflictThresholdMs?: number;
}): ReminderTimeResolution | null {
  const modelAtMs = normalizeTimestampMs(params.modelAtMsRaw);
  const localAtMs = resolveReminderLocalAtMs(params.userText, params.nowMs);
  const conflictThresholdMs = Math.max(60_000, params.conflictThresholdMs ?? 2 * 60_000);

  if (localAtMs === null && modelAtMs === null) return null;
  if (localAtMs !== null && modelAtMs === null) {
    return {
      resolvedAtMs: localAtMs,
      resolutionMethod: "local",
      timezone: params.timezone,
      sourceTimeMs: params.nowMs,
      localAtMs
    };
  }
  if (localAtMs === null && modelAtMs !== null) {
    return {
      resolvedAtMs: modelAtMs,
      resolutionMethod: "model",
      timezone: params.timezone,
      sourceTimeMs: params.nowMs,
      modelAtMs
    };
  }

  const diff = Math.abs((localAtMs as number) - (modelAtMs as number));
  const conflict = diff > conflictThresholdMs;
  return {
    resolvedAtMs: conflict ? (localAtMs as number) : (modelAtMs as number),
    resolutionMethod: conflict ? "merged" : "model",
    timezone: params.timezone,
    sourceTimeMs: params.nowMs,
    modelAtMs: modelAtMs as number,
    localAtMs: localAtMs as number,
    conflict
  };
}
