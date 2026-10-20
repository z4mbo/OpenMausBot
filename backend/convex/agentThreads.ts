import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { canSeeThread, requireAgent, requireSharedAgents, requireThread } from "./lib/agentAccess";
import { messageView, runSummary, runView, userNames } from "./lib/agentThreadRows";

const TITLE_MAX = 80;
const PAGE_MAX = 200;

const threadView = v.object({
  _id: v.id("agentThreads"), agentId: v.id("workspaceAgents"), title: v.string(), createdBy: v.id("users"), creatorName: v.string(),
  clientId: v.optional(v.string()), private: v.boolean(), seq: v.number(), lastMessageAt: v.optional(v.number()), unread: v.boolean(),
  activeRun: v.union(runView, v.null()), createdAt: v.number(),
});

const cleanTitle = (title: string) => title.trim().slice(0, TITLE_MAX) || "New thread";

export const list = query({
  args: { sessionToken: v.string(), agentId: v.id("workspaceAgents") },
  returns: v.array(threadView),
  handler: async (ctx, args) => {
    const { access } = await requireAgent(ctx, args.agentId, args.sessionToken);
    const name = userNames(ctx);
    const rows = await ctx.db.query("agentThreads").withIndex("by_agentId_and_updatedAt", (q) => q.eq("agentId", args.agentId)).order("desc").take(200);
    const out = [];
    for (const thread of rows) {
      if (thread.archivedAt !== undefined || !canSeeThread(thread, access.user)) continue;
      const read = await ctx.db.query("agentThreadReads").withIndex("by_threadId_and_userId", (q) => q.eq("threadId", thread._id).eq("userId", access.user._id)).unique();
      const run = thread.activeRunId ? await ctx.db.get(thread.activeRunId) : null;
      out.push({
        _id: thread._id, agentId: thread.agentId, title: thread.title, createdBy: thread.createdBy, creatorName: (await name(thread.createdBy)) ?? "Someone",
        ...(thread.clientId ? { clientId: thread.clientId } : {}), private: thread.private === true, seq: thread.seq,
        ...(thread.lastMessageAt ? { lastMessageAt: thread.lastMessageAt } : {}), unread: (read?.seq ?? 0) < thread.seq,
        activeRun: run ? await runSummary(ctx, run, name) : null, createdAt: thread.createdAt,
      });
    }
    return out;
  },
});

/** Idempotent per creator and clientId, so a desktop binding a local thread never makes two. */
export const create = mutation({
  args: { sessionToken: v.string(), agentId: v.id("workspaceAgents"), title: v.string(), private: v.optional(v.boolean()), clientId: v.optional(v.string()) },
  returns: v.id("agentThreads"),
  handler: async (ctx, args) => {
    const { agent, access } = await requireAgent(ctx, args.agentId, args.sessionToken);
    await requireSharedAgents(ctx, agent.teamId);
    if (!access.canSend) throw new Error("View-only access");
    if (agent.archivedAt !== undefined) throw new Error("This agent is archived");
    const clientId = args.clientId?.slice(0, 128);
    if (clientId) {
      const existing = await ctx.db.query("agentThreads").withIndex("by_createdBy_and_clientId", (q) => q.eq("createdBy", access.user._id).eq("clientId", clientId)).first();
      if (existing && existing.agentId === agent._id) return existing._id;
    }
    const now = Date.now();
    return ctx.db.insert("agentThreads", {
      teamId: agent.teamId, ...(agent.projectId ? { projectId: agent.projectId } : {}), agentId: agent._id, title: cleanTitle(args.title),
      createdBy: access.user._id, ...(clientId ? { clientId } : {}), ...(args.private ? { private: true } : {}), seq: 0, createdAt: now, updatedAt: now,
    });
  },
});

export const rename = mutation({
  args: { sessionToken: v.string(), threadId: v.id("agentThreads"), title: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { thread, access, user } = await requireThread(ctx, args.threadId, args.sessionToken);
    if (thread.createdBy !== user._id && !access.canEdit) throw new Error("Only the thread's creator or an agent editor can rename it");
    await ctx.db.patch(thread._id, { title: cleanTitle(args.title), updatedAt: Date.now() });
    return null;
  },
});

export const archive = mutation({
  args: { sessionToken: v.string(), threadId: v.id("agentThreads") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { thread, access, user } = await requireThread(ctx, args.threadId, args.sessionToken);
    if (thread.createdBy !== user._id && !access.canEdit) throw new Error("Only the thread's creator or an agent editor can archive it");
    if (thread.archivedAt === undefined) await ctx.db.patch(thread._id, { archivedAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});

/** Rows written or changed after afterSeq, oldest change first, with the run holding the thread and the runs queued behind it. */
export const messagesSince = query({
  args: { sessionToken: v.string(), threadId: v.id("agentThreads"), afterSeq: v.number(), limit: v.optional(v.number()) },
  returns: v.object({
    seq: v.number(), title: v.string(), archived: v.boolean(), messages: v.array(messageView), more: v.boolean(),
    activeRun: v.union(runView, v.null()), queued: v.array(runView),
  }),
  handler: async (ctx, args) => {
    const { thread } = await requireThread(ctx, args.threadId, args.sessionToken);
    const name = userNames(ctx);
    const limit = Math.max(1, Math.min(PAGE_MAX, Math.floor(args.limit ?? PAGE_MAX)));
    const rows = await ctx.db.query("agentThreadMessages")
      .withIndex("by_threadId_and_updSeq", (q) => q.eq("threadId", thread._id).gt("updSeq", args.afterSeq)).take(limit + 1);
    const runs = new Map<string, { by?: string; byUserId?: Id<"users">; engineLabel?: string; executedByUserId?: Id<"users">; executedByName?: string; hostId?: Id<"agentHosts">; sourceId?: Id<"modelHostSources"> }>();
    const messages = [];
    for (const row of rows.slice(0, limit)) {
      let run = row.runId ? runs.get(row.runId) : undefined;
      if (row.runId && !run) {
        const doc = await ctx.db.get(row.runId);
        const execution = doc?.modelExecutionId ? await ctx.db.get(doc.modelExecutionId) : null;
        run = doc ? { by: await name(doc.requesterUserId), byUserId: doc.requesterUserId, engineLabel: doc.engineLabel,
          ...(doc.executedByUserId ? { executedByUserId: doc.executedByUserId, executedByName: await name(doc.executedByUserId) } : {}),
          ...(execution ? { hostId: execution.hostId, sourceId: execution.sourceId } : {}) } : {};
        runs.set(row.runId, run);
      }
      messages.push({
        _id: row._id, seq: row.seq, updSeq: row.updSeq, clientId: row.clientId, role: row.role, kind: row.kind,
        ...(row.text !== undefined ? { text: row.text } : {}), ...(row.tool ? { tool: row.tool } : {}),
        ...(row.authorUserId ? { authorUserId: row.authorUserId, authorName: await name(row.authorUserId) } : {}),
        ...(row.runId ? { runId: row.runId } : {}), ...(run?.by ? { runBy: run.by } : {}),
        ...(run?.byUserId ? { runByUserId: run.byUserId } : {}), ...(run?.engineLabel ? { engineLabel: run.engineLabel } : {}),
        ...(run?.executedByUserId ? { executedByUserId: run.executedByUserId, executedByName: run.executedByName } : {}),
        ...(run?.hostId ? { hostId: run.hostId, sourceId: run.sourceId } : {}),
        status: row.status, ...(row.attachments ? { attachments: row.attachments } : {}), ...(row.payload !== undefined ? { payload: row.payload } : {}),
        createdAt: row.createdAt, updatedAt: row.updatedAt,
      });
    }
    const active = thread.activeRunId ? await ctx.db.get(thread.activeRunId) : null;
    const queuedRows = await ctx.db.query("workspaceAgentRuns").withIndex("by_threadId_and_status", (q) => q.eq("threadId", thread._id).eq("status", "queued")).take(20);
    const queued = [];
    for (const run of queuedRows) queued.push(await runSummary(ctx, run, name));
    return {
      seq: thread.seq, title: thread.title, archived: thread.archivedAt !== undefined, messages, more: rows.length > limit,
      activeRun: active && active.status === "running" ? await runSummary(ctx, active, name) : null, queued,
    };
  },
});

export const markRead = mutation({
  args: { sessionToken: v.string(), threadId: v.id("agentThreads"), seq: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { thread, user } = await requireThread(ctx, args.threadId, args.sessionToken);
    const seq = Math.max(0, Math.min(thread.seq, Math.floor(args.seq)));
    const read = await ctx.db.query("agentThreadReads").withIndex("by_threadId_and_userId", (q) => q.eq("threadId", thread._id).eq("userId", user._id)).unique();
    if (!read) await ctx.db.insert("agentThreadReads", { threadId: thread._id, userId: user._id, seq, updatedAt: Date.now() });
    else if (read.seq < seq) await ctx.db.patch(read._id, { seq, updatedAt: Date.now() });
    return null;
  },
});
