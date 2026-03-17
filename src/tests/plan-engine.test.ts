import test from "node:test";
import assert from "node:assert/strict";
import { PlanEngine } from "../core/agent/plan-engine.ts";
import type { ChannelContext } from "../types/contracts.ts";

const emptyContext: ChannelContext = {
  channelId: "ch1",
  recentMessages: [],
  activePlan: null,
  memoryRecall: []
};

test("plan engine pause/resume/terminate lifecycle", async () => {
  const engine = new PlanEngine();
  engine.createPlan([
    { title: "step1", tool: "noop", input: {} },
    { title: "step2", tool: "noop", input: {} }
  ]);
  engine.pause();
  let snapshot = engine.resume();
  assert.equal(snapshot.status, "running");

  snapshot = await engine.run(emptyContext, {
    execute: async (step) => ({ ok: true, step: step.title })
  });
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.steps.every((s) => s.status === "completed"), true);

  engine.createPlan([{ title: "step3", tool: "noop", input: {} }]);
  snapshot = engine.terminate();
  assert.equal(snapshot.status, "terminated");
});

test("plan engine marks failed step and run", async () => {
  const engine = new PlanEngine();
  engine.createPlan([
    { title: "good", tool: "noop", input: {} },
    { title: "bad", tool: "fail", input: {} }
  ]);
  const snapshot = await engine.run(emptyContext, {
    execute: async (step) => {
      if (step.tool === "fail") throw new Error("boom");
      return "ok";
    }
  });
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.steps[1].status, "failed");
  assert.match(String(snapshot.error), /boom/);
});
