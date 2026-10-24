import { v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { runUsage, threadAttachment, threadMessageKind, threadMessageTool } from "./agentsTables";
import { requireUser } from "./lib/auth";
import { canResumeThreadRun, requireThread, requireWritableThread, runAcceptsBotWrites, runnerOf } from "./lib/agentAccess";
import { chosenRunner } from "./lib/agentRunner";
import { cleanPayload, cleanText, cleanTool, LEASE_MS, messageByClientId, nextSeq, promoteQueuedRun, settleRun } from "./lib/agentThreadRows";
import { requireTeamMember } from "./lib/permissions";
import { budgetRefusal, recordSpend } from "./budgets";

const CLIENT_ID_MAX = 160;
const ENGINE_LABEL_MAX = 120;
const clientIdOf = (value: string) => {
  const id = value.trim();
  if (!id || id.length > CLIENT_ID_MAX) throw new Error("clientId must be 1 to 160 characters");
  return id;
};

const beginResult = v.object({
  runId: v.id("workspaceAgentRuns"), messageId: v.id("agentThreadMessages"), status: v.string(), seq: v.number(),
  /** Set when another member's app or server runs it; the sender's app only shows it. */
  runner: v.optional(v.object({ userId: v.id("users"), name: v.string(), host: v.string() })),
  /** The agent's chosen computer was unavailable, so it runs on the sender's app. */
  fallback: v.optional(v.string()),
});

/** Records a person's message and starts their run, or queues it behind the run that holds the thread. Idempotent per clientId. */
export const begin = mutation({
  args: {
    sessionToken: v.string(), threadId: v.id("agentThreads"), clientId: v.string(), text: v.string(),
    engineLabel: v.optional(v.string()), attachments: v.optional(v.array(threadAttachment)),
  },
  returns: beginResult,
  handler: async (ctx, args): Promise<Infer<typeof beginResult>> => {
    const { thread, agent, access, user } = await requireWritableThread(ctx, args.threadId, args.sessionToken);
    const clientId = clientIdOf(args.clientId);
    const existing = await messageByClientId(ctx, thread._id, clientId);
    if (existing) {
      if (existing.authorUserId !== user._id || !existing.runId) throw new Error("clientId already belongs to another message");
      if (existing.text !== cleanText(args.text, "user")) throw new Error("clientId already belongs to another message");
      const run = await ctx.db.get(existing.runId);
      const runner = run && runnerOf(run) !== user._id ? await ctx.db.get(runnerOf(run)) : null;
      const host = run?.hostId ? await ctx.db.get(run.hostId) : null;
      return {
        runId: existing.runId, messageId: existing._id, status: run?.status ?? "failed", seq: existing.seq,
        ...(runner ? { runner: { userId: runner._id, name: runner.name || runner.email, host: host?.name ?? "" } } : {}),
      };
    }
    const now = Date.now();
    const overBudget = await budgetRefusal(ctx, agent, thread.projectId ?? agent.projectId, now);
    if (overBudget) throw new Error(overBudget);
    const holder = thread.activeRunId ? await ctx.db.get(thread.activeRunId) : null;
    if (holder && holder.status === "running" && (thread.leaseUntil ?? 0) <= now) await settleRun(ctx, holder, "interrupted", now);
    const fresh = (await ctx.db.get(thread._id))!;
    const busy = fresh.activeRunId !== undefined;
    const status = busy ? "queued" as const : "running" as const;
    const { runner: chosen, unavailable } = await chosenRunner(ctx, agent, now);
    const runner = chosen && (chosen.userId !== user._id || chosen.hostKind !== "local") ? chosen : null;
    const engineLabel = runner ? undefined : args.engineLabel?.trim().slice(0, ENGINE_LABEL_MAX);
    const runId = await ctx.db.insert("workspaceAgentRuns", {
      teamId: thread.teamId, ...(thread.projectId ? { projectId: thread.projectId } : {}), threadId: thread._id, requestClientId: clientId,
      ...(engineLabel ? { engineLabel } : {}), requesterUserId: user._id, requesterMembershipId: access.membership._id, actorAgentId: agent._id,
      status, task: args.text.slice(0, 500), engine: agent.engine, model: agent.model, effort: agent.effort, depth: 0, eventSequence: 0,
      lastEventAt: now, ...(status === "running" ? { heartbeatAt: now } : {}), createdAt: now, updatedAt: now,
      ...(chosen ? { hostId: chosen.hostId } : {}), ...(runner ? { runnerUserId: runner.userId, runnerMembershipId: runner.membershipId } : {}),
    });
    const seq = await nextSeq(ctx, fresh, now, true);
    const messageId = await ctx.db.insert("agentThreadMessages", {
      teamId: thread.teamId, threadId: thread._id, seq, updSeq: seq, clientId, role: "user", kind: "text", text: cleanText(args.text, "user"),
      authorUserId: user._id, runId, status: "final", ...(args.attachments?.length ? { attachments: args.attachments.slice(0, 20) } : {}),
      createdAt: now, updatedAt: now,
    });
    if (status === "running") await ctx.db.patch(thread._id, { activeRunId: runId, leaseUntil: now + LEASE_MS });
    return {
      runId, messageId, status, seq,
      ...(runner ? { runner: { userId: runner.userId, name: runner.ownerName, host: runner.hostName } } : {}), ...(unavailable ? { fallback: unavailable } : {}),
    };
  },
});

export const heartbeat = mutation({
  args: { sessionToken: v.string(), runId: v.id("workspaceAgentRuns"), engineLabel: v.optional(v.string()), executorId: v.optional(v.string()) },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const run = await ctx.db.get(args.runId);
    if (!run || runnerOf(run) !== user._id) throw new Error("Run not found");
    if (run.modelExecutionId) throw new Error("Hosted runs require their executor lease");
    if (run.status !== "running" || !run.threadId) return { status: run.status };
    const now = Date.now();
    const thread = await ctx.db.get(run.threadId);
    if (thread?.activeRunId !== run._id || (thread.leaseUntil ?? 0) <= now) {
      await settleRun(ctx, run, "interrupted", now);
      return { status: "interrupted" };
    }
    if (args.executorId !== undefined && (!args.executorId || args.executorId.length > 128)) throw new Error("Invalid executor identity");
    if (run.executorId && run.executorId !== args.executorId) return { status: "claimed_elsewhere" };
    if (!await canResumeThreadRun(ctx, run, user)) {
      await settleRun(ctx, run, "interrupted", now);
      return { status: "interrupted" };
    }
    const engineLabel = args.engineLabel?.trim().slice(0, ENGINE_LABEL_MAX);
    await ctx.db.patch(run._id, { heartbeatAt: now, updatedAt: now, ...(engineLabel ? { engineLabel } : {}), ...(args.executorId ? { executorId: args.executorId } : {}) });
    if (thread?.activeRunId === run._id) await ctx.db.patch(thread._id, { leaseUntil: now + LEASE_MS });
    return { status: "running" };
  },
});

/** Mirrors one transcript row. A person writes their own user rows; bot rows belong to the run's requester while it is live. */
export const appendMessage = mutation({
  args: {
    sessionToken: v.string(), threadId: v.id("agentThreads"), clientId: v.string(), runId: v.optional(v.id("workspaceAgentRuns")),
    role: v.union(v.literal("user"), v.literal("bot")), kind: threadMessageKind, text: v.optional(v.string()), tool: v.optional(threadMessageTool),
    status: v.optional(v.union(v.literal("streaming"), v.literal("final"))), attachments: v.optional(v.array(threadAttachment)), payload: v.optional(v.string()),
  },
  returns: v.object({ messageId: v.id("agentThreadMessages"), seq: v.number() }),
  handler: async (ctx, args) => {
    const { thread, user } = await requireWritableThread(ctx, args.threadId, args.sessionToken);
    const clientId = clientIdOf(args.clientId);
    const existing = await messageByClientId(ctx, thread._id, clientId);
    if (existing) {
      if (existing.authorUserId !== user._id && existing.role === "user") throw new Error("clientId already belongs to another message");
      return { messageId: existing._id, seq: existing.seq };
    }
    const now = Date.now();
    if (args.role === "bot" && (!args.runId || !runAcceptsBotWrites(await ctx.db.get(args.runId), user._id, thread._id, now))) {
      throw new Error("Only the app running this reply can write it");
    }
    const seq = await nextSeq(ctx, thread, now, true);
    const messageId = await ctx.db.insert("agentThreadMessages", {
      teamId: thread.teamId, threadId: thread._id, seq, updSeq: seq, clientId, role: args.role, kind: args.kind,
      ...(args.text !== undefined ? { text: cleanText(args.text, args.role) } : {}), ...(args.tool ? { tool: cleanTool(args.tool) } : {}),
      ...(args.role === "user" ? { authorUserId: user._id } : {}), ...(args.runId ? { runId: args.runId } : {}),
      status: args.status ?? "final", ...(args.attachments?.length ? { attachments: args.attachments.slice(0, 20) } : {}),
      ...(args.payload !== undefined ? { payload: cleanPayload(args.payload) } : {}), createdAt: now, updatedAt: now,
    });
    return { messageId, seq };
  },
});

export const importMessages = mutation({
  args: { sessionToken: v.string(), threadId: v.id("agentThreads"), messages: v.array(v.object({
    clientId: v.string(), role: v.union(v.literal("user"), v.literal("bot")), kind: threadMessageKind,
    text: v.optional(v.string()), tool: v.optional(threadMessageTool), payload: v.optional(v.string()),
  })) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { thread, user } = await requireWritableThread(ctx, args.threadId, args.sessionToken);
    if (thread.createdBy !== user._id || !thread.clientId || thread.activeRunId) throw new Error("Only the creator can import a local conversation before it runs");
    if (args.messages.length > 20 || JSON.stringify(args.messages).length > 128_000) throw new Error("Import batch is too large");
    const now = Date.now();
    for (const row of args.messages) {
      const clientId = clientIdOf(row.clientId);
      if (await messageByClientId(ctx, thread._id, clientId)) continue;
      const seq = await nextSeq(ctx, thread, now, true);
      await ctx.db.insert("agentThreadMessages", {
        teamId: thread.teamId, threadId: thread._id, seq, updSeq: seq, clientId, role: row.role, kind: row.kind,
        ...(row.text !== undefined ? { text: cleanText(row.text, row.role) } : {}), ...(row.tool ? { tool: cleanTool(row.tool) } : {}),
        ...(row.payload !== undefined ? { payload: cleanPayload(row.payload) } : {}), authorUserId: user._id,
        status: "final", createdAt: now, updatedAt: now,
      });
    }
    return null;
  },
});

export const patchMessage = mutation({
  args: {
    sessionToken: v.string(), threadId: v.id("agentThreads"), clientId: v.string(), text: v.optional(v.string()), tool: v.optional(threadMessageTool),
    status: v.optional(v.union(v.literal("streaming"), v.literal("final"))), payload: v.optional(v.string()),
  },
  returns: v.object({ seq: v.number() }),
  handler: async (ctx, args) => {
    const { thread, user } = await requireWritableThread(ctx, args.threadId, args.sessionToken);
    const row = await messageByClientId(ctx, thread._id, clientIdOf(args.clientId));
    if (!row) throw new Error("Message not found");
    const now = Date.now();
    const allowed = row.role === "user"
      ? row.authorUserId === user._id
      : Boolean(row.runId) && runAcceptsBotWrites(await ctx.db.get(row.runId!), user._id, thread._id, now);
    if (!allowed) throw new Error("Only the message's writer can change it");
    if (row.status === "interrupted") return { seq: row.updSeq };
    const updSeq = await nextSeq(ctx, thread, now);
    await ctx.db.patch(row._id, {
      ...(args.text !== undefined ? { text: cleanText(args.text, row.role) } : {}), ...(args.tool ? { tool: cleanTool(args.tool) } : {}),
      ...(args.status ? { status: args.status } : {}), ...(args.payload !== undefined ? { payload: cleanPayload(args.payload) } : {}),
      updSeq, updatedAt: now,
    });
    return { seq: updSeq };
  },
});

export const finish = mutation({
  args: {
    sessionToken: v.string(), runId: v.id("workspaceAgentRuns"), status: v.union(v.literal("succeeded"), v.literal("failed")),
    usage: v.optional(runUsage), engineLabel: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const run = await ctx.db.get(args.runId);
    if (!run || runnerOf(run) !== user._id) throw new Error("Run not found");
    if (run.modelExecutionId) throw new Error("Hosted runs require their executor lease");
    if (run.status !== "running" && run.status !== "queued") return null;
    const engineLabel = args.engineLabel?.trim().slice(0, ENGINE_LABEL_MAX);
    await settleRun(ctx, run, args.status, Date.now(), { ...(args.usage ? { usage: args.usage } : {}), ...(engineLabel ? { engineLabel } : {}) });
    await recordSpend(ctx, run, args.usage?.costUsd, Date.now());
    return null;
  },
});

/** The requester or an agent editor stops a run; a queued one never starts. */
export const cancel = mutation({
  args: { sessionToken: v.string(), runId: v.id("workspaceAgentRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.threadId) throw new Error("Run not found");
    const { access, user } = await requireThread(ctx, run.threadId, args.sessionToken);
    if (run.requesterUserId !== user._id && runnerOf(run) !== user._id && !access.canEdit) throw new Error("Only the requester can stop this run");
    if (run.status === "running" || run.status === "queued") await settleRun(ctx, run, "cancelled", Date.now());
    return null;
  },
});

/** The live and queued runs this member's app runs in a workspace: its own, and teammates' runs of agents set to run on it.
 * A desktop starts each one that holds its thread. */
export const pendingForMe = query({
  /** `hostId`: the asking app's own host, so a person signed in on a laptop and a server runs each hosted message once, on the host it went to. */
  args: { sessionToken: v.string(), teamId: v.id("teams"), hostId: v.optional(v.id("agentHosts")) },
  returns: v.array(v.object({
    runId: v.id("workspaceAgentRuns"), threadId: v.id("agentThreads"), agentId: v.id("workspaceAgents"), status: v.string(),
    requestClientId: v.optional(v.string()), text: v.string(), createdAt: v.number(),
    threadSeq: v.number(),
    /** A teammate's run of an agent set to run here: the cloud row of their message, and who sent it. */
    hostedFor: v.optional(v.object({ userId: v.id("users"), name: v.string(), messageId: v.optional(v.id("agentThreadMessages")) })),
  })),
  handler: async (ctx, args) => {
    const { member, user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const out = [];
    const seen = new Set<string>();
    const hostsHere = (run: Doc<"workspaceAgentRuns">) => args.hostId ? run.hostId === args.hostId : run.requesterUserId !== user._id;
    for (const status of ["running", "queued"] as const) {
      const own = await ctx.db.query("workspaceAgentRuns")
        .withIndex("by_requesterMembershipId_and_status", (q) => q.eq("requesterMembershipId", member._id).eq("status", status)).take(50);
      const hosted = await ctx.db.query("workspaceAgentRuns")
        .withIndex("by_runnerMembershipId_and_status", (q) => q.eq("runnerMembershipId", member._id).eq("status", status)).take(50);
      for (const run of [...hosted.filter(hostsHere), ...own]) {
        if (seen.has(run._id)) continue;
        seen.add(run._id);
        if (!run.threadId || !await canResumeThreadRun(ctx, run, user)) continue;
        const request = run.requestClientId ? await messageByClientId(ctx, run.threadId, run.requestClientId) : null;
        const requester = run.runnerUserId && hostsHere(run) ? await ctx.db.get(run.requesterUserId) : null;
        const thread = await ctx.db.get(run.threadId);
        out.push({
          runId: run._id, threadId: run.threadId, agentId: run.actorAgentId, status: run.status,
          threadSeq: thread?.seq ?? 0,
          ...(run.requestClientId ? { requestClientId: run.requestClientId } : {}), text: request?.text ?? run.task, createdAt: run.createdAt,
          ...(requester ? { hostedFor: { userId: requester._id, name: requester.name || requester.email, ...(request ? { messageId: request._id } : {}) } } : {}),
        });
      }
    }
    return out;
  },
});

export const expireStale = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db.query("workspaceAgentRuns")
      .withIndex("by_status_and_heartbeatAt", (q) => q.eq("status", "running").gt("heartbeatAt", 0).lt("heartbeatAt", now - LEASE_MS)).take(100);
    let expired = 0;
    for (const run of stale) {
      if (!run.threadId) continue;
      await settleRun(ctx, run, "interrupted", now);
      expired += 1;
    }
    return expired;
  },
});

export const promoteQueued = internalMutation({
  args: { threadId: v.id("agentThreads"), previousRunId: v.id("workspaceAgentRuns") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await promoteQueuedRun(ctx, args.threadId, args.previousRunId, Date.now());
    return null;
  },
});

