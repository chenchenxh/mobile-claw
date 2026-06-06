import type { ModelTier } from "../../types/contracts.ts";

export type CronSchedule =
  | {
      kind: "at";
      atMs: number;
    }
  | {
      kind: "every";
      everyMs: number;
      anchorMs?: number;
    }
  | {
      kind: "cron";
      expr: string;
      tz?: string;
      staggerMs?: number;
    };

export type CronSessionTarget = "main" | "isolated" | "current" | `session:${string}`;
export type CronWakeMode = "now" | "next-heartbeat";
export type CronTimingClass = "exact_foreground" | "best_effort_background";
export type CronDeliveryMode = "announce" | "webhook" | "none";
export type CronDeliveryStatus = "delivered" | "not-delivered" | "unknown" | "not-requested";
export type CronErrorKind = "rate_limit" | "overloaded" | "network" | "timeout" | "server_error" | "delivery" | "unknown";

export type CronPayload =
  | {
      kind: "systemEvent";
      channelId: string;
      text: string;
      tier?: ModelTier;
    }
  | {
      kind: "agentTurn";
      channelId: string;
      message: string;
      modelId?: string;
    };

export type CronExecutionStatus = "ok" | "error";

export interface CronRunRecord {
  runId?: string;
  runAtMs: number;
  status: CronExecutionStatus;
  durationMs: number;
  error?: string;
  errorKind?: CronErrorKind;
  deliveryStatus?: CronDeliveryStatus;
  triggeredBy?: "schedule" | "manual" | "retry" | "catchup";
  startedAt?: number;
  finishedAt?: number;
}

export interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: CronExecutionStatus;
  lastError?: string;
  lastErrorReason?: CronErrorKind;
  lastDeliveryStatus?: CronDeliveryStatus;
  consecutiveErrors?: number;
  runHistory: CronRunRecord[];
}

export interface CronDelivery {
  mode: CronDeliveryMode;
  channel?: "last" | string;
  to?: string;
  bestEffort?: boolean;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  sessionTarget?: CronSessionTarget;
  wakeMode?: CronWakeMode;
  delivery?: CronDelivery;
  timingClass?: CronTimingClass;
  runModelStrategy?: "current_session";
  state: CronJobState;
  createdAtMs: number;
  updatedAtMs: number;
  deleteAfterRun?: boolean;
  createdByAgentId?: string;
  idempotencyKey?: string;
  retryCount?: number;
  lastRunStatus?: CronExecutionStatus;
  lastRunAt?: number;
}

export interface CronExecutionRecord {
  runId: string;
  jobId: string;
  status: CronExecutionStatus;
  errorSummary?: string;
  errorKind?: CronErrorKind;
  deliveryStatus?: CronDeliveryStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  triggeredBy: "schedule" | "manual" | "retry" | "catchup";
}
