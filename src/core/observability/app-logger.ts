export type AppLogLevel = "VERBOSE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface AppLogEntry {
  id: string;
  ts: number;
  level: AppLogLevel;
  module: string;
  event: string;
  message: string;
  context?: Record<string, unknown>;
  error?: string;
}

type Listener = () => void;

const MAX_ENTRIES = 500;
const entries: AppLogEntry[] = [];
const listeners = new Set<Listener>();

const redactedKeyPattern = /(token|api[-_]?key|authorization|secret|password|code)/i;

function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function mask(value: string): string {
  if (!value) return value;
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function sanitizeUnknown(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/bearer\s+/i.test(value)) {
      return value.replace(/bearer\s+([a-z0-9._\-]+)/gi, (_s, token) => `Bearer ${mask(String(token))}`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (redactedKeyPattern.test(k)) {
        out[k] = typeof v === "string" ? mask(v) : "***";
      } else {
        out[k] = sanitizeUnknown(v);
      }
    }
    return out;
  }
  return value;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function push(entry: Omit<AppLogEntry, "id" | "ts">): AppLogEntry {
  const next: AppLogEntry = {
    id: uid(),
    ts: Date.now(),
    ...entry,
    context: entry.context ? (sanitizeUnknown(entry.context) as Record<string, unknown>) : undefined,
    error: entry.error ? String(sanitizeUnknown(entry.error)) : undefined
  };
  entries.unshift(next);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  const text = `[MobileClaw][${next.level}] ${next.module}:${next.event} ${next.message}`;
  if (next.level === "ERROR" || next.level === "FATAL") console.error(text, next.context ?? "", next.error ?? "");
  else if (next.level === "WARN") console.warn(text, next.context ?? "");
  else console.log(text, next.context ?? "");
  notify();
  return next;
}

export const appLogger = {
  list(): AppLogEntry[] {
    return [...entries];
  },
  clear(): void {
    entries.length = 0;
    notify();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  verbose(input: Omit<AppLogEntry, "id" | "ts" | "level">): AppLogEntry {
    return push({ ...input, level: "VERBOSE" });
  },
  debug(input: Omit<AppLogEntry, "id" | "ts" | "level">): AppLogEntry {
    return push({ ...input, level: "DEBUG" });
  },
  info(input: Omit<AppLogEntry, "id" | "ts" | "level">): AppLogEntry {
    return push({ ...input, level: "INFO" });
  },
  warn(input: Omit<AppLogEntry, "id" | "ts" | "level">): AppLogEntry {
    return push({ ...input, level: "WARN" });
  },
  error(input: Omit<AppLogEntry, "id" | "ts" | "level">): AppLogEntry {
    return push({ ...input, level: "ERROR" });
  },
  fatal(input: Omit<AppLogEntry, "id" | "ts" | "level">): AppLogEntry {
    return push({ ...input, level: "FATAL" });
  }
};
