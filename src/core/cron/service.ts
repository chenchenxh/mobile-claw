import type {
  CronDeliveryStatus,
  CronErrorKind,
  CronExecutionRecord,
  CronJob,
  CronPayload,
  CronSchedule
} from "./types.ts";
import { uid } from "../utils/id.ts";

const MAX_RUN_HISTORY_DEFAULT = 200;
const MAX_EXECUTION_RECORDS_DEFAULT = 1000;

interface CronServiceOptions {
  onJob?: (job: CronJob) => Promise<void>;
  now?: () => number;
  maxConcurrentRuns?: number;
  maxRunHistory?: number;
  maxExecutionRecords?: number;
  maxCatchupJobs?: number;
  catchupWindowMs?: number;
  retryBackoffMs?: number[];
  maxTransientAttempts?: number;
  canRunExactForeground?: () => boolean;
}

interface QueuedRun {
  runId: string;
  jobId: string;
  forced: boolean;
  triggeredBy: "schedule" | "manual" | "retry" | "catchup";
}

function cloneJob(job: CronJob): CronJob {
  return {
    ...job,
    schedule: { ...job.schedule },
    payload: { ...job.payload },
    delivery: job.delivery ? { ...job.delivery } : undefined,
    runModelStrategy: job.runModelStrategy,
    state: {
      ...job.state,
      runHistory: [...job.state.runHistory]
    }
  };
}

function cloneExecutionRecord(record: CronExecutionRecord): CronExecutionRecord {
  return { ...record };
}

function normalizePayload(payload: CronPayload | { channelId: string; text: string; tier?: "small" | "large" }): CronPayload {
  if ("kind" in payload) return payload;
  return {
    kind: "systemEvent",
    channelId: payload.channelId,
    text: payload.text,
    tier: payload.tier
  };
}

function classifyError(error?: string): CronErrorKind {
  const text = (error ?? "").toLowerCase();
  if (!text) return "unknown";
  if (/rate[_ ]?limit|429|too many requests/.test(text)) return "rate_limit";
  if (/overload|capacity|high demand|529/.test(text)) return "overloaded";
  if (/network|econnreset|econnrefused|fetch failed|socket/.test(text)) return "network";
  if (/timeout|timed out|etimedout/.test(text)) return "timeout";
  if (/5\d\d|server error/.test(text)) return "server_error";
  if (/delivery|not-delivered|webhook/.test(text)) return "delivery";
  return "unknown";
}

function isTransient(kind: CronErrorKind): boolean {
  return kind === "rate_limit" || kind === "overloaded" || kind === "network" || kind === "timeout" || kind === "server_error";
}

function parseCronField(field: string, min: number, max: number): ((v: number) => boolean) | null {
  const trimmed = field.trim();
  if (trimmed === "*") return () => true;
  const step = /^\*\/(\d+)$/.exec(trimmed);
  if (step) {
    const n = Number(step[1]);
    if (!Number.isInteger(n) || n <= 0) return null;
    return (v: number) => (v - min) % n === 0;
  }
  const single = /^(\d+)$/.exec(trimmed);
  if (single) {
    const n = Number(single[1]);
    if (!Number.isInteger(n) || n < min || n > max) return null;
    return (v: number) => v === n;
  }
  return null;
}

function nextCronRunAtMs(expr: string, afterMs: number): number | undefined {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [minField, hourField, dayField, monthField, dowField] = fields;
  const minMatches = parseCronField(minField!, 0, 59);
  const hourMatches = parseCronField(hourField!, 0, 23);
  const dayMatches = parseCronField(dayField!, 1, 31);
  const monthMatches = parseCronField(monthField!, 1, 12);
  const dowMatches = parseCronField(dowField!, 0, 6);
  if (!minMatches || !hourMatches || !dayMatches || !monthMatches || !dowMatches) return undefined;

  const start = afterMs - (afterMs % 60_000) + 60_000;
  const oneMinute = 60_000;
  const maxProbeMinutes = 366 * 24 * 60;
  for (let i = 0; i < maxProbeMinutes; i += 1) {
    const ts = start + i * oneMinute;
    const d = new Date(ts);
    if (
      minMatches(d.getMinutes()) &&
      hourMatches(d.getHours()) &&
      dayMatches(d.getDate()) &&
      monthMatches(d.getMonth() + 1) &&
      dowMatches(d.getDay())
    ) {
      return ts;
    }
  }
  return undefined;
}

function stableOffsetMs(jobId: string, staggerMs: number): number {
  if (staggerMs <= 1) return 0;
  let hash = 0;
  for (let i = 0; i < jobId.length; i += 1) hash = (hash * 31 + jobId.charCodeAt(i)) >>> 0;
  return hash % staggerMs;
}

export class CronService {
  private readonly onJob?: (job: CronJob) => Promise<void>;
  private readonly now: () => number;
  private readonly maxConcurrentRuns: number;
  private readonly maxRunHistory: number;
  private readonly maxExecutionRecords: number;
  private readonly maxCatchupJobs: number;
  private readonly catchupWindowMs: number;
  private readonly retryBackoffMs: number[];
  private readonly maxTransientAttempts: number;
  private readonly canRunExactForeground?: () => boolean;
  private jobs: CronJob[] = [];
  private executionRecords: CronExecutionRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private runQueue: QueuedRun[] = [];
  private queuedRunIds = new Set<string>();
  private runningJobIds = new Set<string>();

  constructor(options?: CronServiceOptions) {
    this.onJob = options?.onJob;
    this.now = options?.now ?? (() => Date.now());
    this.maxConcurrentRuns = Math.max(1, Math.floor(options?.maxConcurrentRuns ?? 1));
    this.maxRunHistory = Math.max(20, Math.floor(options?.maxRunHistory ?? MAX_RUN_HISTORY_DEFAULT));
    this.maxExecutionRecords = Math.max(100, Math.floor(options?.maxExecutionRecords ?? MAX_EXECUTION_RECORDS_DEFAULT));
    this.maxCatchupJobs = Math.max(1, Math.floor(options?.maxCatchupJobs ?? 5));
    this.catchupWindowMs = Math.max(60_000, Math.floor(options?.catchupWindowMs ?? 30 * 60_000));
    this.retryBackoffMs = options?.retryBackoffMs?.length
      ? options.retryBackoffMs.map((n) => Math.max(1_000, Math.floor(n)))
      : [30_000, 60_000, 300_000];
    this.maxTransientAttempts = Math.max(1, Math.floor(options?.maxTransientAttempts ?? 3));
    this.canRunExactForeground = options?.canRunExactForeground;
  }

  start(): void {
    this.running = true;
    this.recomputeAllNextRuns();
    this.enqueueCatchupJobs();
    this.armTimer();
    this.processQueue();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.jobs = [];
    this.executionRecords = [];
    this.runQueue = [];
    this.queuedRunIds.clear();
    this.runningJobIds.clear();
    this.stop();
  }

  loadJobs(jobs: CronJob[]): void {
    this.jobs = jobs.map((job) => {
      const cloned = cloneJob(job);
      cloned.payload = normalizePayload(cloned.payload as CronPayload);
      if (cloned.schedule.kind === "at" && Number.isFinite(cloned.schedule.atMs) && cloned.schedule.atMs < 1_000_000_000_000) {
        cloned.schedule = { ...cloned.schedule, atMs: Math.floor(cloned.schedule.atMs * 1000) };
      }
      if (!cloned.sessionTarget) cloned.sessionTarget = "main";
      if (!cloned.wakeMode) cloned.wakeMode = "now";
      if (!cloned.timingClass) cloned.timingClass = "best_effort_background";
      if (!cloned.runModelStrategy) cloned.runModelStrategy = "current_session";
      const target = cloned.sessionTarget;
      const isolatedLike = target === "isolated" || target === "current" || target.startsWith("session:");
      if (isolatedLike && cloned.payload.kind === "systemEvent") {
        cloned.payload = {
          kind: "agentTurn",
          channelId: cloned.payload.channelId,
          message: cloned.payload.text
        };
      }
      return cloned;
    });
    this.recomputeAllNextRuns();
    if (this.running) {
      this.enqueueCatchupJobs();
      this.armTimer();
      this.processQueue();
    }
  }

  dumpJobs(): CronJob[] {
    return this.jobs.map((job) => cloneJob(job));
  }

  loadExecutionRecords(records: CronExecutionRecord[]): void {
    this.executionRecords = records.map((it) => cloneExecutionRecord(it));
  }

  dumpExecutionRecords(): CronExecutionRecord[] {
    return this.executionRecords.map((it) => cloneExecutionRecord(it));
  }

  listExecutionRecords(limit = 100): CronExecutionRecord[] {
    return this.executionRecords.slice(-Math.max(1, limit)).map((it) => cloneExecutionRecord(it)).reverse();
  }

  listJobs(includeDisabled = true): CronJob[] {
    const rows = includeDisabled ? this.jobs : this.jobs.filter((job) => job.enabled);
    return rows
      .map((job) => cloneJob(job))
      .sort((a, b) => (a.state.nextRunAtMs ?? Number.POSITIVE_INFINITY) - (b.state.nextRunAtMs ?? Number.POSITIVE_INFINITY));
  }

  addJob(input: {
    name: string;
    schedule: CronSchedule;
    payload: CronPayload | { channelId: string; text: string; tier?: "small" | "large" };
    enabled?: boolean;
    deleteAfterRun?: boolean;
    createdByAgentId?: string;
    idempotencyKey?: string;
    sessionTarget?: CronJob["sessionTarget"];
    wakeMode?: CronJob["wakeMode"];
    delivery?: CronJob["delivery"];
    timingClass?: CronJob["timingClass"];
    runModelStrategy?: CronJob["runModelStrategy"];
  }): CronJob {
    this.validateSchedule(input.schedule);
    const now = this.now();
    const payload = normalizePayload(input.payload);
    const timingClass = input.timingClass ?? "best_effort_background";
    if (timingClass === "exact_foreground" && !this.canRunExactForeground?.()) {
      throw new Error("exact_foreground requires foreground scheduler capability");
    }
    const job: CronJob = {
      id: uid("cron"),
      name: input.name.trim() || "Cron Job",
      enabled: input.enabled ?? true,
      schedule: input.schedule,
      payload,
      sessionTarget: input.sessionTarget ?? (payload.kind === "agentTurn" ? "isolated" : "main"),
      wakeMode: input.wakeMode ?? "now",
      delivery: input.delivery,
      timingClass,
      runModelStrategy: input.runModelStrategy ?? "current_session",
      state: {
        nextRunAtMs: undefined,
        lastRunAtMs: undefined,
        lastStatus: undefined,
        lastError: undefined,
        lastErrorReason: undefined,
        lastDeliveryStatus: undefined,
        consecutiveErrors: 0,
        runHistory: []
      },
      createdAtMs: now,
      updatedAtMs: now,
      deleteAfterRun: input.deleteAfterRun ?? (input.schedule.kind === "at"),
      createdByAgentId: input.createdByAgentId,
      idempotencyKey: input.idempotencyKey?.trim() || undefined,
      retryCount: 0,
      lastRunAt: undefined,
      lastRunStatus: undefined
    };
    this.validateJobSpec(job);
    if (job.enabled) job.state.nextRunAtMs = this.computeNextRun(job, now);
    this.jobs.push(job);
    if (this.running) {
      this.armTimer();
      this.processQueue();
    }
    return cloneJob(job);
  }

  removeJob(jobId: string): boolean {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((job) => job.id !== jobId);
    this.runQueue = this.runQueue.filter((it) => it.jobId !== jobId);
    if (this.running) this.armTimer();
    return this.jobs.length < before;
  }

  removeJobs(jobIds: string[]): { removed: number; removedIds: string[] } {
    if (!jobIds.length) return { removed: 0, removedIds: [] };
    const set = new Set(jobIds);
    const before = this.jobs.length;
    const removedIds = this.jobs.filter((job) => set.has(job.id)).map((job) => job.id);
    this.jobs = this.jobs.filter((job) => !set.has(job.id));
    this.runQueue = this.runQueue.filter((it) => !set.has(it.jobId));
    if (this.running) this.armTimer();
    return { removed: before - this.jobs.length, removedIds };
  }

  setJobEnabled(jobId: string, enabled: boolean): boolean {
    const job = this.jobs.find((it) => it.id === jobId);
    if (!job) return false;
    job.enabled = enabled;
    job.updatedAtMs = this.now();
    job.state.nextRunAtMs = enabled ? this.computeNextRun(job, this.now()) : undefined;
    if (this.running) this.armTimer();
    return true;
  }

  updateJob(
    jobId: string,
    patch: Partial<{
      name: string;
      schedule: CronSchedule;
      payload: CronPayload | { channelId: string; text: string; tier?: "small" | "large" };
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
    const job = this.jobs.find((it) => it.id === jobId);
    if (!job) return null;
    if (typeof patch.name === "string") job.name = patch.name.trim() || job.name;
    if (patch.schedule) {
      this.validateSchedule(patch.schedule);
      job.schedule = patch.schedule;
    }
    if (patch.payload) job.payload = normalizePayload(patch.payload);
    if (typeof patch.enabled === "boolean") job.enabled = patch.enabled;
    if (typeof patch.deleteAfterRun === "boolean") job.deleteAfterRun = patch.deleteAfterRun;
    if (typeof patch.idempotencyKey === "string") job.idempotencyKey = patch.idempotencyKey.trim() || undefined;
    if (patch.sessionTarget) job.sessionTarget = patch.sessionTarget;
    if (patch.wakeMode) job.wakeMode = patch.wakeMode;
    if (patch.delivery) job.delivery = patch.delivery;
    if (patch.runModelStrategy) job.runModelStrategy = patch.runModelStrategy;
    if (patch.timingClass) {
      if (patch.timingClass === "exact_foreground" && !this.canRunExactForeground?.()) {
        throw new Error("exact_foreground requires foreground scheduler capability");
      }
      job.timingClass = patch.timingClass;
    }
    job.updatedAtMs = this.now();
    this.validateJobSpec(job);
    job.state.nextRunAtMs = job.enabled ? this.computeNextRun(job, this.now()) : undefined;
    if (this.running) {
      this.armTimer();
      this.processQueue();
    }
    return cloneJob(job);
  }

  enqueueRun(jobId: string, mode: "due" | "force" = "due"): { ok: true; enqueued: boolean; runId?: string; reason?: string } {
    const job = this.jobs.find((it) => it.id === jobId);
    if (!job) return { ok: true, enqueued: false, reason: "not-found" };
    if (this.runningJobIds.has(jobId)) return { ok: true, enqueued: false, reason: "already-running" };
    if (this.runQueue.some((it) => it.jobId === jobId)) return { ok: true, enqueued: false, reason: "already-queued" };
    if (mode === "due" && !this.isJobDue(job, this.now())) return { ok: true, enqueued: false, reason: "not-due" };
    const runId = uid("cron_run");
    this.runQueue.push({
      runId,
      jobId,
      forced: mode === "force",
      triggeredBy: "manual"
    });
    this.queuedRunIds.add(runId);
    this.processQueue();
    return { ok: true, enqueued: true, runId };
  }

  retryJobNow(jobId: string): boolean {
    const job = this.jobs.find((it) => it.id === jobId);
    if (!job) return false;
    const runId = uid("cron_run");
    this.runQueue.push({ runId, jobId: job.id, forced: true, triggeredBy: "retry" });
    this.queuedRunIds.add(runId);
    job.retryCount = (job.retryCount ?? 0) + 1;
    job.updatedAtMs = this.now();
    this.processQueue();
    return true;
  }

  private validateSchedule(schedule: CronSchedule): void {
    if (schedule.kind === "at" && schedule.atMs <= 0) throw new Error("invalid schedule.atMs");
    if (schedule.kind === "every" && schedule.everyMs <= 0) throw new Error("invalid schedule.everyMs");
    if (schedule.kind === "cron" && !schedule.expr.trim()) throw new Error("invalid schedule.cron.expr");
    if (schedule.kind === "at") {
      const atMs = schedule.atMs < 1_000_000_000_000 ? Math.floor(schedule.atMs * 1000) : schedule.atMs;
      const diffMs = atMs - this.now();
      if (diffMs < -60_000) throw new Error("schedule.at is in the past (>1 minute)");
      if (diffMs > 10 * 365.25 * 24 * 60 * 60 * 1000) throw new Error("schedule.at is too far in the future (>10 years)");
    }
  }

  private validateJobSpec(job: CronJob): void {
    const target = job.sessionTarget ?? "main";
    if (target === "main" && job.payload.kind !== "systemEvent") {
      throw new Error('sessionTarget="main" requires payload.kind="systemEvent"');
    }
    const isolatedLike = target === "isolated" || target === "current" || target.startsWith("session:");
    if (isolatedLike && job.payload.kind !== "agentTurn") {
      throw new Error('isolated/current/session jobs require payload.kind="agentTurn"');
    }
  }

  private recomputeAllNextRuns(): void {
    const now = this.now();
    for (const job of this.jobs) {
      if (!job.enabled) {
        job.state.nextRunAtMs = undefined;
        continue;
      }
      job.state.nextRunAtMs = this.computeNextRun(job, now);
    }
  }

  private computeNextRun(job: CronJob, now: number): number | undefined {
    const schedule = job.schedule;
    if (schedule.kind === "at") return schedule.atMs > now ? schedule.atMs : undefined;
    if (schedule.kind === "every") {
      const anchor = schedule.anchorMs && schedule.anchorMs > 0 ? schedule.anchorMs : (job.state.lastRunAtMs ?? now);
      const elapsed = Math.max(0, now - anchor);
      const cycles = Math.floor(elapsed / schedule.everyMs) + 1;
      return anchor + cycles * schedule.everyMs;
    }
    const baseNext = nextCronRunAtMs(schedule.expr, now);
    if (baseNext === undefined) return undefined;
    const staggerMs = Math.max(0, Math.floor(schedule.staggerMs ?? 0));
    const offset = stableOffsetMs(job.id, staggerMs);
    const shifted = baseNext + offset;
    if (shifted > now) return shifted;
    return nextCronRunAtMs(schedule.expr, shifted + 60_000);
  }

  private getNextWakeMs(): number | undefined {
    let min: number | undefined;
    for (const job of this.jobs) {
      if (!job.enabled || !job.state.nextRunAtMs) continue;
      if (min === undefined || job.state.nextRunAtMs < min) min = job.state.nextRunAtMs;
    }
    return min;
  }

  private armTimer(): void {
    if (!this.running) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const next = this.getNextWakeMs();
    if (!next) return;
    const delay = Math.max(0, next - this.now());
    this.timer = setTimeout(() => void this.onTimer(), delay);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  private async onTimer(): Promise<void> {
    if (!this.running) return;
    const now = this.now();
    const dueJobs = this.jobs.filter((job) => job.enabled && this.isJobDue(job, now));
    for (const job of dueJobs) {
      const runId = uid("cron_run");
      this.runQueue.push({
        runId,
        jobId: job.id,
        forced: false,
        triggeredBy: job.retryCount && job.retryCount > 0 ? "retry" : "schedule"
      });
      this.queuedRunIds.add(runId);
    }
    this.processQueue();
    this.armTimer();
  }

  private processQueue(): void {
    if (!this.running) return;
    while (this.runningJobIds.size < this.maxConcurrentRuns && this.runQueue.length > 0) {
      const queued = this.runQueue.shift()!;
      this.queuedRunIds.delete(queued.runId);
      const job = this.jobs.find((it) => it.id === queued.jobId);
      if (!job) continue;
      if (!job.enabled && !queued.forced) continue;
      if (this.runningJobIds.has(job.id)) continue;
      if (!queued.forced && !this.isJobDue(job, this.now())) continue;
      this.runningJobIds.add(job.id);
      void this.executeJob(job, queued).finally(() => {
        this.runningJobIds.delete(job.id);
        this.processQueue();
      });
    }
  }

  private async executeJob(job: CronJob, queued: QueuedRun): Promise<void> {
    const start = this.now();
    let status: CronExecutionRecord["status"] = "ok";
    let errorSummary: string | undefined;
    let errorKind: CronErrorKind | undefined;
    if (job.timingClass === "exact_foreground" && !this.canRunExactForeground?.()) {
      status = "error";
      errorSummary = "foreground scheduler not ready";
      errorKind = "timeout";
    } else {
      try {
        if (this.onJob) await this.onJob(cloneJob(job));
      } catch (err) {
        status = "error";
        errorSummary = err instanceof Error ? err.message : String(err);
        errorKind = classifyError(errorSummary);
      }
    }

    const finishedAt = this.now();
    const deliveryStatus = this.resolveDeliveryStatus(job, status, errorSummary);
    job.state.lastRunAtMs = start;
    job.state.lastStatus = status;
    job.state.lastError = errorSummary;
    job.state.lastErrorReason = errorKind;
    job.state.lastDeliveryStatus = deliveryStatus;
    job.state.consecutiveErrors = status === "error" ? (job.state.consecutiveErrors ?? 0) + 1 : 0;
    job.updatedAtMs = finishedAt;
    job.lastRunAt = start;
    job.lastRunStatus = status;

    const durationMs = Math.max(0, finishedAt - start);
    job.state.runHistory.push({
      runId: queued.runId,
      runAtMs: start,
      status,
      durationMs,
      error: errorSummary,
      errorKind,
      deliveryStatus,
      triggeredBy: queued.triggeredBy,
      startedAt: start,
      finishedAt
    });
    job.state.runHistory = job.state.runHistory.slice(-this.maxRunHistory);
    this.executionRecords.push({
      runId: queued.runId,
      jobId: job.id,
      status,
      errorSummary,
      errorKind,
      deliveryStatus,
      startedAt: start,
      finishedAt,
      durationMs,
      triggeredBy: queued.triggeredBy
    });
    this.executionRecords = this.executionRecords.slice(-this.maxExecutionRecords);

    if (status === "error" && job.schedule.kind === "at" && isTransient(errorKind ?? "unknown")) {
      const attempts = job.state.consecutiveErrors ?? 1;
      if (attempts <= this.maxTransientAttempts) {
        const idx = Math.min(this.retryBackoffMs.length - 1, attempts - 1);
        const backoff = this.retryBackoffMs[Math.max(0, idx)]!;
        job.enabled = true;
        job.state.nextRunAtMs = this.now() + backoff;
        return;
      }
    }

    if (job.schedule.kind === "at") {
      if (job.deleteAfterRun) {
        this.jobs = this.jobs.filter((it) => it.id !== job.id);
      } else {
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
      }
      return;
    }

    job.state.nextRunAtMs = this.computeNextRun(job, this.now());
    if (queued.triggeredBy === "retry") job.retryCount = 0;
  }

  private resolveDeliveryStatus(job: CronJob, status: "ok" | "error", error?: string): CronDeliveryStatus {
    const delivery = job.delivery;
    if (!delivery || delivery.mode === "none") return "not-requested";
    if (delivery.mode === "webhook") return status === "ok" ? "unknown" : "not-delivered";
    if (status === "ok") {
      if (!delivery.to && !delivery.channel) return "unknown";
      return "delivered";
    }
    if (delivery.bestEffort && error) return "unknown";
    return "not-delivered";
  }

  private isJobDue(job: CronJob, now: number): boolean {
    const next = job.state.nextRunAtMs;
    return typeof next === "number" && next <= now;
  }

  private enqueueCatchupJobs(): void {
    const now = this.now();
    const due = this.jobs
      .filter((job) => job.enabled && typeof job.state.nextRunAtMs === "number" && job.state.nextRunAtMs <= now)
      .sort((a, b) => (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0))
      .slice(0, this.maxCatchupJobs);
    for (const job of due) {
      if (!job.state.nextRunAtMs) continue;
      const lag = now - job.state.nextRunAtMs;
      if (lag > this.catchupWindowMs) continue;
      const runId = uid("cron_run");
      this.runQueue.push({ runId, jobId: job.id, forced: false, triggeredBy: "catchup" });
      this.queuedRunIds.add(runId);
    }
  }
}
