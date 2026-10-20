import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { budgetRefusal } from "./budgets";
import { requireSharedAgents } from "./lib/agentAccess";
import { cleanText, nextSeq } from "./lib/agentThreadRows";
import { projectMember, requireAdmin, requireMember, requireTeamMember } from "./lib/permissions";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const CLAIM_MS = 10 * 60_000;
const LIST_MAX = 6;
const TASK_SCAN = 1_000;
const TEXT_MAX = 140;
const NOTE_MAX = 2_000;
const CLAIMS_PER_CALL = 5;
export const HEARTBEAT_DEFAULTS = { intervalHours: 4, staleDays: 3 } as const;
export const HEARTBEAT_LIMITS = { intervalHours: [1, 24], staleDays: [1, 30] } as const;

const staleIssue = v.object({ taskId: v.id("tasks"), title: v.string(), column: v.string(), days: v.number() });
const blockedAgent = v.object({ agentName: v.string(), kind: v.union(v.literal("approval"), v.literal("failed_run")), text: v.string(), taskId: v.optional(v.id("tasks")) });
const waitingPull = v.object({ number: v.number(), url: v.string(), title: v.string(), waitingFor: v.union(v.literal("merge"), v.literal("review")) });
export const heartbeatFindings = v.object({ stale: v.array(staleIssue), blocked: v.array(blockedAgent), waiting: v.array(waitingPull) });
export type HeartbeatFindings = typeof heartbeatFindings.type;

const clip = (text: string) => { const line = text.replace(/\s+/g, " ").trim(); return line.length > TEXT_MAX ? `${line.slice(0, TEXT_MAX - 1)}…` : line; };
const bounded = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, Math.round(value)));

async function chiefOf(ctx: QueryCtx, projectId: Id<"projects">) {
  const agents = await ctx.db.query("workspaceAgents").withIndex("by_projectId", q => q.eq("projectId", projectId)).take(50);
  return agents.find(agent => agent.kind === "chief" && !agent.archivedAt && !agent.disabled) ?? null;
}

/** Open issues nobody touched for `staleDays`, agents stuck on an approval or a failed run, and PRs waiting on a person. */
export async function heartbeatFindingsFor(ctx: QueryCtx, project: Doc<"projects">, staleDays: number, since: number, now: number): Promise<HeartbeatFindings> {
  const columns = new Map((await ctx.db.query("columns").withIndex("by_project", q => q.eq("projectId", project._id)).take(200)).map(column => [column._id, column]));
  const tasks = await ctx.db.query("tasks").withIndex("by_project", q => q.eq("projectId", project._id)).take(TASK_SCAN);
  const byId = new Map(tasks.map(task => [task._id, task]));
  const cutoff = now - staleDays * DAY_MS;
  const stale = tasks
    .filter(task => !task.done && task.updatedAt < cutoff && !columns.get(task.columnId)?.isDraft && !columns.get(task.columnId)?.isDone)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, LIST_MAX)
    .map(task => ({ taskId: task._id, title: clip(task.title), column: columns.get(task.columnId)?.title ?? "", days: Math.floor((now - task.updatedAt) / DAY_MS) }));

  const names = new Map<Id<"workspaceAgents">, string>();
  const agentName = async (id: Id<"workspaceAgents">) => {
    if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "An agent");
    return names.get(id)!;
  };
  const blocked: HeartbeatFindings["blocked"] = [];
  for (const approval of await ctx.db.query("agentApprovals").withIndex("by_projectId_and_outcome", q => q.eq("projectId", project._id).eq("outcome", "pending")).take(20)) {
    const run = await ctx.db.get(approval.runId);
    if (run) blocked.push({ agentName: await agentName(run.actorAgentId), kind: "approval", text: clip(run.task), ...(run.taskId ? { taskId: run.taskId } : {}) });
  }
  const failed = await ctx.db.query("workspaceAgentRuns").withIndex("by_projectId_and_status_and_retryRunId", q => q.eq("projectId", project._id).eq("status", "failed").eq("retryRunId", undefined)).order("desc").take(30);
  for (const run of failed) {
    if ((run.endedAt ?? run.updatedAt) < since) continue;
    blocked.push({ agentName: await agentName(run.actorAgentId), kind: "failed_run", text: clip(run.summary || run.task), ...(run.taskId ? { taskId: run.taskId } : {}) });
  }

  const waiting: HeartbeatFindings["waiting"] = [];
  for (const pull of await ctx.db.query("taskPullRequests").withIndex("by_projectId_and_number", q => q.eq("projectId", project._id)).order("desc").take(200)) {
    if (pull.state !== "open") continue;
    const task = byId.get(pull.taskId) ?? await ctx.db.get(pull.taskId);
    waiting.push({ number: pull.number, url: pull.url, title: clip(task?.title ?? `Pull request #${pull.number}`), waitingFor: pull.review === "approved" ? "merge" : "review" });
  }
  return { stale, blocked: blocked.slice(0, LIST_MAX), waiting: waiting.slice(0, LIST_MAX) };
}

export const isQuiet = (findings: HeartbeatFindings) => !findings.stale.length && !findings.blocked.length && !findings.waiting.length;

export function findingsKey(findings: HeartbeatFindings): string {
  return [
    ...findings.stale.map(item => `s:${item.taskId}`),
    ...findings.blocked.map(item => `b:${item.kind}:${item.agentName}:${item.text}`),
    ...findings.waiting.map(item => `w:${item.number}:${item.waitingFor}`),
  ].sort().join("|");
}

const settingsView = v.object({
  enabled: v.boolean(), intervalHours: v.number(), staleDays: v.number(), lastRunAt: v.optional(v.number()),
  canEdit: v.boolean(), chiefName: v.union(v.string(), v.null()),
});

export const settings = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  returns: settingsView,
  handler: async (ctx, a) => {
    const { member } = await requireMember(ctx, a.projectId, a.sessionToken);
    const row = await ctx.db.query("chiefHeartbeats").withIndex("by_projectId", q => q.eq("projectId", a.projectId)).unique();
    const chief = await chiefOf(ctx, a.projectId);
    return {
      enabled: row?.enabled ?? false, intervalHours: row?.intervalHours ?? HEARTBEAT_DEFAULTS.intervalHours, staleDays: row?.staleDays ?? HEARTBEAT_DEFAULTS.staleDays,
      ...(row?.lastRunAt ? { lastRunAt: row.lastRunAt } : {}), canEdit: member.role === "owner" || member.role === "admin", chiefName: chief?.name ?? null,
    };
  },
});

export const configure = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), enabled: v.boolean(), intervalHours: v.number(), staleDays: v.number() },
  returns: v.null(),
  handler: async (ctx, a) => {
    const { user, project } = await requireAdmin(ctx, a.projectId, a.sessionToken);
    if (!project.teamId) throw new Error("Only a workspace project has a Chief");
    const fields = {
      enabled: a.enabled, intervalHours: bounded(a.intervalHours, HEARTBEAT_LIMITS.intervalHours), staleDays: bounded(a.staleDays, HEARTBEAT_LIMITS.staleDays),
      updatedBy: user._id, updatedAt: Date.now(),
    };
    const row = await ctx.db.query("chiefHeartbeats").withIndex("by_projectId", q => q.eq("projectId", a.projectId)).unique();
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("chiefHeartbeats", { teamId: project.teamId, projectId: a.projectId, ...fields });
    return null;
  },
});

const claimView = v.object({
  claimId: v.string(), projectId: v.id("projects"), projectName: v.string(), chiefAgentId: v.id("workspaceAgents"), chiefName: v.string(),
  staleDays: v.number(), findings: heartbeatFindings,
});

/** A desktop that runs one of `agentIds` takes the projects whose heartbeat is due. A due project with nothing new is marked run
 * and left out; each one returned waits for its note through `post` for ten minutes. */
export const claim = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), agentIds: v.array(v.id("workspaceAgents")) },
  returns: v.array(claimView),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const mine = new Set(a.agentIds.slice(0, 100));
    const now = Date.now();
    const out: (typeof claimView.type)[] = [];
    for (const row of await ctx.db.query("chiefHeartbeats").withIndex("by_teamId", q => q.eq("teamId", a.teamId)).take(200)) {
      if (out.length >= CLAIMS_PER_CALL) break;
      if (!row.enabled || (row.lastRunAt !== undefined && now - row.lastRunAt < row.intervalHours * HOUR_MS) || (row.claim && row.claim.until > now)) continue;
      const project = await ctx.db.get(row.projectId);
      const chief = project?.status === "active" ? await chiefOf(ctx, row.projectId) : null;
      if (!project || !chief || !mine.has(chief._id) || !await projectMember(ctx, project, user)) continue;
      const since = row.lastRunAt ?? now - row.intervalHours * HOUR_MS;
      if (await budgetRefusal(ctx, chief, project._id, now)) {
        await ctx.db.patch(row._id, { lastRunAt: now, claim: undefined });
        continue;
      }
      const findings = await heartbeatFindingsFor(ctx, project, row.staleDays, since, now);
      const key = findingsKey(findings);
      if (isQuiet(findings) || key === row.lastKey) {
        await ctx.db.patch(row._id, { lastRunAt: now, claim: undefined, ...(isQuiet(findings) ? { lastKey: undefined } : {}) });
        continue;
      }
      const claimId = `${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      await ctx.db.patch(row._id, { lastRunAt: now, claim: { id: claimId, userId: user._id, until: now + CLAIM_MS, key } });
      out.push({ claimId, projectId: project._id, projectName: project.name, chiefAgentId: chief._id, chiefName: chief.name, staleDays: row.staleDays, findings });
    }
    return out;
  },
});

async function heartbeatThread(ctx: MutationCtx, row: Doc<"chiefHeartbeats">, chief: Doc<"workspaceAgents">, userId: Id<"users">, now: number) {
  const existing = row.threadId ? await ctx.db.get(row.threadId) : null;
  if (existing && existing.archivedAt === undefined && existing.agentId === chief._id) return existing;
  const threadId = await ctx.db.insert("agentThreads", {
    teamId: chief.teamId, projectId: row.projectId, agentId: chief._id, title: "Heartbeat", createdBy: userId, seq: 0, createdAt: now, updatedAt: now,
  });
  await ctx.db.patch(row._id, { threadId });
  return (await ctx.db.get(threadId))!;
}

/** Posts the claimed heartbeat's note as the Chief's message in its Heartbeat thread, which every member's app shows. */
export const post = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), claimId: v.string(), text: v.string() },
  returns: v.union(v.id("agentThreads"), v.null()),
  handler: async (ctx, a) => {
    const { user, project } = await requireMember(ctx, a.projectId, a.sessionToken);
    const row = await ctx.db.query("chiefHeartbeats").withIndex("by_projectId", q => q.eq("projectId", a.projectId)).unique();
    const now = Date.now();
    if (!row?.claim || row.claim.id !== a.claimId || row.claim.userId !== user._id || row.claim.until <= now) return null;
    const chief = await chiefOf(ctx, a.projectId);
    const text = a.text.trim().slice(0, NOTE_MAX);
    if (!chief || !project.teamId || !text) {
      await ctx.db.patch(row._id, { claim: undefined });
      return null;
    }
    await requireSharedAgents(ctx, project.teamId);
    const thread = await heartbeatThread(ctx, row, chief, user._id, now);
    const seq = await nextSeq(ctx, thread, now, true);
    await ctx.db.insert("agentThreadMessages", {
      teamId: thread.teamId, threadId: thread._id, seq, updSeq: seq, clientId: `heartbeat:${a.claimId}`, role: "bot", kind: "text",
      text: cleanText(text, "bot"), status: "final", createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(row._id, { lastKey: row.claim.key, claim: undefined });
    return thread._id;
  },
});
