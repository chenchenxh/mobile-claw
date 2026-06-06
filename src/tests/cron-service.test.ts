import test from "node:test";
import assert from "node:assert/strict";
import { CronService } from "../core/cron/service.ts";

test("cron service executes recurring jobs", async () => {
  let runCount = 0;
  const cron = new CronService({
    onJob: async () => {
      runCount += 1;
    }
  });

  cron.start();
  cron.addJob({
    name: "tick",
    schedule: { kind: "every", everyMs: 10 },
    payload: { channelId: "ch", text: "ping" }
  });

  await new Promise((resolve) => setTimeout(resolve, 45));
  cron.stop();
  assert.ok(runCount >= 2);
});

test("cron one-shot job can delete after run", async () => {
  const cron = new CronService({
    onJob: async () => undefined
  });
  cron.start();
  const job = cron.addJob({
    name: "once",
    schedule: { kind: "at", atMs: Date.now() + 15 },
    payload: { channelId: "ch", text: "once" },
    deleteAfterRun: true
  });

  await new Promise((resolve) => setTimeout(resolve, 35));
  cron.stop();
  assert.equal(cron.listJobs(true).some((j) => j.id === job.id), false);
});

test("cron one-shot job defaults to delete after run", async () => {
  const cron = new CronService({
    onJob: async () => undefined
  });
  cron.start();
  const job = cron.addJob({
    name: "once-default-delete",
    schedule: { kind: "at", atMs: Date.now() + 15 },
    payload: { channelId: "ch", text: "once" }
  });

  await new Promise((resolve) => setTimeout(resolve, 35));
  cron.stop();
  assert.equal(cron.listJobs(true).some((j) => j.id === job.id), false);
});

test("cron service records execution and supports retry", async () => {
  let runCount = 0;
  const cron = new CronService({
    onJob: async () => {
      runCount += 1;
    }
  });
  cron.start();
  const job = cron.addJob({
    name: "retryable",
    schedule: { kind: "every", everyMs: 10_000 },
    payload: { channelId: "ch", text: "retry me" }
  });
  const ok = cron.retryJobNow(job.id);
  assert.equal(ok, true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  cron.stop();
  assert.ok(runCount >= 1);
  const records = cron.listExecutionRecords(10);
  assert.ok(records.length >= 1);
  assert.equal(records[0]?.jobId, job.id);
});

test("cron service removeJobs removes batch ids", () => {
  const cron = new CronService();
  const a = cron.addJob({
    name: "a",
    schedule: { kind: "every", everyMs: 60_000 },
    payload: { channelId: "ch", text: "a" }
  });
  const b = cron.addJob({
    name: "b",
    schedule: { kind: "every", everyMs: 60_000 },
    payload: { channelId: "ch", text: "b" }
  });
  const c = cron.addJob({
    name: "c",
    schedule: { kind: "every", everyMs: 60_000 },
    payload: { channelId: "ch", text: "c" }
  });

  const result = cron.removeJobs([a.id, c.id]);
  assert.equal(result.removed, 2);
  assert.deepEqual(new Set(result.removedIds), new Set([a.id, c.id]));
  const remaining = cron.listJobs(true).map((job) => job.id);
  assert.deepEqual(remaining, [b.id]);
});
