import type { ChannelContext, PlanExecutor, PlanRun, PlanStep, PlanStatus } from "../../types/contracts.ts";
import { uid } from "../utils/id.ts";

export class PlanEngine {
  private active: PlanRun | null = null;

  createPlan(steps: Omit<PlanStep, "id" | "status">[]): PlanRun {
    this.active = {
      runId: uid("plan"),
      status: "idle",
      currentStep: 0,
      steps: steps.map((s) => ({ ...s, id: uid("step"), status: "pending" }))
    };
    return this.snapshot();
  }

  getActivePlan(): PlanRun | null {
    return this.snapshotOrNull();
  }

  pause(): PlanRun {
    this.assertActive();
    if (this.active!.status === "running" || this.active!.status === "idle") {
      this.active!.status = "paused";
    }
    return this.snapshot();
  }

  resume(): PlanRun {
    this.assertActive();
    if (this.active!.status === "paused") {
      this.active!.status = "running";
    }
    return this.snapshot();
  }

  terminate(): PlanRun {
    this.assertActive();
    this.active!.status = "terminated";
    return this.snapshot();
  }

  async run(context: ChannelContext, executor: PlanExecutor): Promise<PlanRun> {
    this.assertActive();
    if (this.active!.status === "idle" || this.active!.status === "paused") {
      this.active!.status = "running";
    }
    for (let i = this.active!.currentStep; i < this.active!.steps.length; i += 1) {
      if (this.active!.status === "paused" || this.active!.status === "terminated") break;
      const step = this.active!.steps[i];
      step.status = "running";
      this.active!.currentStep = i;
      try {
        step.output = await executor.execute(step, context);
        step.status = "completed";
      } catch (err) {
        step.status = "failed";
        step.error = err instanceof Error ? err.message : String(err);
        this.active!.status = "failed";
        this.active!.error = step.error;
        return this.snapshot();
      }
    }
    if (this.active!.status === "running" && this.active!.steps.every((s) => s.status === "completed")) {
      this.active!.status = "completed";
    }
    return this.snapshot();
  }

  private snapshotOrNull(): PlanRun | null {
    if (!this.active) return null;
    return JSON.parse(JSON.stringify(this.active)) as PlanRun;
  }

  private snapshot(): PlanRun {
    return this.snapshotOrNull() as PlanRun;
  }

  private assertActive(): void {
    if (!this.active) throw new Error("no active plan");
  }
}

export function isTerminalStatus(status: PlanStatus): boolean {
  return status === "completed" || status === "failed" || status === "terminated";
}
