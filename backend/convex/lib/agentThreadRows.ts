import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { threadAttachment, threadMessageKind, threadMessageTool } from "../agentsTables";
import { canResumeThreadRun, runnerOf } from "./agentAccess";

/** A thread holds one live run; it lapses this long after the runner's last heartbeat. */
export const LEASE_MS = 60_000;
export const USER_TEXT_MAX = 32_000;
export const BOT_TEXT_MAX = 64_000;
export const TOOL_FIELD_MAX = 2_048;
export const PAYLOAD_MAX = 16_384;

export const messageView = v.object({
  _id: v.id("agentThreadMessages"), seq: v.number(), updSeq: v.number(), clientId: v.string(), role: v.union(v.literal("user"), v.literal("bot")),
  kind: threadMessageKind, text: v.optional(v.string()), tool: v.optional(threadMessageTool), authorUserId: v.optional(v.id("users")),
  authorName: v.optional(v.string()), runId: v.optional(v.id("workspaceAgentRuns")), runBy: v.optional(v.string()), runByUserId: v.optional(v.id("users")),
  engineLabel: v.optional(v.string()), status: v.union(v.literal("streaming"), v.literal("final"), v.literal("interrupted")),
  executedByUserId: v.optional(v.id("users")), executedByName: v.optional(v.string()), hostId: v.optional(v.id("agentHosts")), sourceId: v.optional(v.id("modelHostSources")),
  attachments: v.optional(v.array(threadAttachment)), payload: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
});

export const runView = v.object({
  runId: v.id("workspaceAgentRuns"), requesterUserId: v.id("users"), requesterName: v.string(),
  /** Set when another member's app or server runs it. */
  runnerUserId: v.optional(v.id("users")), runnerName: v.optional(v.string()),
  status: v.string(), engineLabel: v.optional(v.string()), createdAt: v.number(),
  executedByUserId: v.optional(v.id("users")), executedByName: v.optional(v.string()), hostId: v.optional(v.id("agentHosts")), sourceId: v.optional(v.id("modelHostSources")),
});

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

export function cleanTool(tool: Doc<"agentThreadMessages">["tool"]) {
  if (!tool) return undefined;
  return {
    name: clip(tool.name, 200), ...(tool.ok !== undefined ? { ok: tool.ok } : {}),
    ...(tool.summary !== undefined ? { summary: clip(tool.summary, TOOL_FIELD_MAX) } : {}),
    ...(tool.input !== undefined ? { input: clip(tool.input, TOOL_FIELD_MAX) } : {}),
    ...(tool.output !== undefined ? { output: clip(tool.output, TOOL_FIELD_MAX) } : {}),
  };
}

export function cleanText(text: string | undefined, role: "user" | "bot") {
  return text === undefined ? undefined : clip(text, role === "user" ? USER_TEXT_MAX : BOT_TEXT_MAX);
}

export function cleanPayload(payload: string | undefined) {
  if (payload === undefined) return undefined;
  if (payload.length > PAYLOAD_MAX) throw new Error(`payload must be at most ${PAYLOAD_MAX} characters`);
  return payload;
}

export async function nextSeq(ctx: MutationCtx, thread: Doc<"agentThreads">, now: number, message = false): Promise<number> {
  const seq = thread.seq + 1;
  thread.seq = seq;
  await ctx.db.patch(thread._id, { seq, updatedAt: now, ...(message ? { lastMessageAt: now } : {}) });
  return seq;
}

export async function messageByClientId(ctx: QueryCtx | MutationCtx, threadId: Id<"agentThreads">, clientId: string) {
  return ctx.db.query("agentThreadMessages").withIndex("by_threadId_and_clientId", (q) => q.eq("threadId", threadId).eq("clientId", clientId)).first();
}

export function userNames(ctx: QueryCtx) {
  const cache = new Map<Id<"users">, string>();
  return async (userId: Id<"users"> | undefined) => {
    if (!userId) return undefined;
    if (!cache.has(userId)) cache.set(userId, (await ctx.db.get(userId))?.name ?? "Someone");
    return cache.get(userId)!;
  };
}

export async function runSummary(ctx: QueryCtx, run: Doc<"workspaceAgentRuns">, name: (id: Id<"users">) => Promise<string | undefined>) {
  const execution = run.modelExecutionId ? await ctx.db.get(run.modelExecutionId) : null;
  return {
    runId: run._id, requesterUserId: run.requesterUserId, requesterName: (await name(run.requesterUserId)) ?? "Someone",
    ...(run.runnerUserId && run.runnerUserId !== run.requesterUserId ? { runnerUserId: run.runnerUserId, runnerName: (await name(run.runnerUserId)) ?? "a teammate" } : {}),
    status: run.status, ...(run.engineLabel ? { engineLabel: run.engineLabel } : {}), createdAt: run.createdAt,
    ...(run.executedByUserId ? { executedByUserId: run.executedByUserId, executedByName: await name(run.executedByUserId) } : {}),
    ...(execution ? { hostId: execution.hostId, sourceId: execution.sourceId } : {}),
  };
}

export async function promoteQueuedRun(ctx: MutationCtx, threadId: Id<"agentThreads">, previousRunId: Id<"workspaceAgentRuns">, now: number): Promise<void> {
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.activeRunId !== previousRunId) return;
  const queued = await ctx.db.query("workspaceAgentRuns")
    .withIndex("by_threadId_and_status", (q) => q.eq("threadId", thread._id).eq("status", "queued")).take(50);
  for (const next of queued) {
    const runner = await ctx.db.get(runnerOf(next));
    if (!runner || runner.status !== "active" || !await canResumeThreadRun(ctx, next, runner)) {
      await ctx.db.patch(next._id, { status: "interrupted", endedAt: now, updatedAt: now });
      continue;
    }
    await ctx.db.patch(next._id, { status: "running", heartbeatAt: now, updatedAt: now });
    await ctx.db.patch(thread._id, { activeRunId: next._id, leaseUntil: now + LEASE_MS, updatedAt: now });
    return;
  }
  if (queued.length === 50) {
    await ctx.scheduler.runAfter(0, internal.agentRuns.promoteQueued, { threadId, previousRunId });
    return;
  }
  await ctx.db.patch(thread._id, { activeRunId: undefined, leaseUntil: undefined, updatedAt: now });
}

/** Ends a run; when it held the thread's lease, hands the lease to the oldest queued run. */
export async function settleRun(
  ctx: MutationCtx, run: Doc<"workspaceAgentRuns">, status: "succeeded" | "failed" | "cancelled" | "interrupted", now: number,
  extra: Partial<Pick<Doc<"workspaceAgentRuns">, "usage" | "engineLabel">> = {},
): Promise<void> {
  await ctx.db.patch(run._id, { status, endedAt: now, updatedAt: now, ...extra });
  {
    for (const row of await ctx.db.query("agentThreadMessages").withIndex("by_runId", (q) => q.eq("runId", run._id)).take(500)) {
      if (row.status !== "streaming") continue;
      const thread = await ctx.db.get(row.threadId);
      if (!thread) continue;
      await ctx.db.patch(row._id, { status: status === "succeeded" ? "final" : "interrupted", updSeq: await nextSeq(ctx, thread, now), updatedAt: now });
    }
  }
  if (!run.threadId) return;
  await promoteQueuedRun(ctx, run.threadId, run._id, now);
}
