import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { executionHasReplies, executionRun, MODEL_HOST_CLAIM_TIMEOUT } from "./modelHostAccess";

type Ctx = MutationCtx | QueryCtx;

export async function latestModelExecution(ctx: Ctx, run: Doc<"workspaceAgentRuns">) {
  return ctx.db.query("modelHostExecutions").withIndex("by_runId", q => q.eq("runId", run._id)).order("desc").first();
}

export async function modelExecutionRetryable(ctx: Ctx, execution: Doc<"modelHostExecutions">, run: Doc<"workspaceAgentRuns">, thread: Doc<"agentThreads">, now: number): Promise<boolean> {
  if (run.status !== "running" || run.modelExecutionId !== execution._id || thread.activeRunId !== run._id || (thread.leaseUntil ?? 0) <= now || execution.activityObserved || await executionHasReplies(ctx, run._id)) return false;
  if (execution.status === "refused") return execution.safeToRetry;
  if (execution.status !== "pending") return false;
  try { await executionRun(ctx, execution, now); return now >= execution.createdAt + MODEL_HOST_CLAIM_TIMEOUT; }
  catch { return true; }
}

export function recoveryQueryTime(now: number | undefined): number {
  if (now !== undefined && (!Number.isFinite(now) || now < 0)) throw new Error("Choose a valid status polling time");
  return Date.now();
}
