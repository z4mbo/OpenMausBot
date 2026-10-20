import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { projectMember, requireAdmin, requireMember, requireTeamMember } from "./lib/permissions";
import { standupBlocker, standupIssue, standupPull } from "./standupTables";

const DAY_MS = 86_400_000;
const LIST_MAX = 8;
const TASK_SCAN = 1_000;
const RECIPIENTS_MAX = 200;
const TEXT_MAX = 160;

type Issue = typeof standupIssue.type;
type Pull = typeof standupPull.type;
type Blocker = typeof standupBlocker.type;
export interface StandupContent { completed: Issue[]; moved: Issue[]; waiting: Pull[]; blockers: Blocker[] }

export const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
const clip = (text: string) => { const line = text.replace(/\s+/g, " ").trim(); return line.length > TEXT_MAX ? `${line.slice(0, TEXT_MAX - 1)}…` : line; };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function standupPreview(content: StandupContent): string {
  return [
    content.completed.length && plural(content.completed.length, "issue done", "issues done"),
    content.moved.length && plural(content.moved.length, "issue moved", "issues moved"),
    content.waiting.length && `${plural(content.waiting.length, "PR", "PRs")} waiting for your merge`,
    content.blockers.length && plural(content.blockers.length, "blocker", "blockers"),
  ].filter(Boolean).join(" · ");
}

async function chiefName(ctx: QueryCtx, projectId: Id<"projects">): Promise<string> {
  const agents = await ctx.db.query("workspaceAgents").withIndex("by_projectId", q => q.eq("projectId", projectId)).take(50);
  const chief = agents.find(agent => agent.kind === "chief" && !agent.archivedAt && !agent.disabled);
  return chief?.name ?? "Chief";
}

/** What happened in a project between `since` and `now`, bounded to a few rows per section. */
export async function composeStandup(ctx: QueryCtx, project: Doc<"projects">, since: number, now: number): Promise<StandupContent> {
  const columns = new Map((await ctx.db.query("columns").withIndex("by_project", q => q.eq("projectId", project._id)).take(200)).map(column => [column._id, column]));
  const tasks = await ctx.db.query("tasks").withIndex("by_project", q => q.eq("projectId", project._id)).take(TASK_SCAN);
  const byId = new Map(tasks.map(task => [task._id, task]));

  const completed: Issue[] = [];
  const done = new Set<Id<"tasks">>();
  if (project.teamId) {
    const rows = await ctx.db.query("taskCompletions").withIndex("by_teamId_and_completedAt", q => q.eq("teamId", project.teamId!).gte("completedAt", since).lte("completedAt", now)).take(500);
    for (const row of rows) {
      const task = byId.get(row.taskId) ?? await ctx.db.get(row.taskId);
      if (row.projectId !== project._id || !task?.done || done.has(task._id)) continue;
      done.add(task._id);
      completed.push({ taskId: task._id, title: clip(task.title), column: "Done" });
    }
  }

  const moved = tasks
    .filter(task => !task.done && task.updatedAt >= since && task.updatedAt <= now && !columns.get(task.columnId)?.isDraft)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(task => ({ taskId: task._id, title: clip(task.title), column: columns.get(task.columnId)?.title ?? "" }));

  const pulls = await ctx.db.query("taskPullRequests").withIndex("by_projectId_and_number", q => q.eq("projectId", project._id)).order("desc").take(300);
  const waiting: Pull[] = [];
  for (const pull of pulls) {
    if (pull.state !== "open" || pull.review !== "approved") continue;
    const task = byId.get(pull.taskId) ?? await ctx.db.get(pull.taskId);
    waiting.push({ number: pull.number, url: pull.url, taskId: pull.taskId, title: clip(task?.title ?? `Pull request #${pull.number}`), checks: pull.checks });
  }

  const blockers: Blocker[] = [];
  const agentName = async (id: Id<"workspaceAgents">) => (await ctx.db.get(id))?.name;
  for (const approval of await ctx.db.query("agentApprovals").withIndex("by_projectId_and_outcome", q => q.eq("projectId", project._id).eq("outcome", "pending")).take(20)) {
    const run = await ctx.db.get(approval.runId);
    if (!run) continue;
    blockers.push({ kind: "approval", text: clip(run.task), ...(run.taskId ? { taskId: run.taskId } : {}), ...(await agentName(run.actorAgentId).then(name => name ? { agentName: name } : {})) });
  }
  const failed = await ctx.db.query("workspaceAgentRuns").withIndex("by_projectId_and_status_and_retryRunId", q => q.eq("projectId", project._id).eq("status", "failed").eq("retryRunId", undefined)).order("desc").take(50);
  for (const run of failed) {
    if ((run.endedAt ?? run.updatedAt) < since) continue;
    blockers.push({ kind: "failed_run", text: clip(run.summary || run.task), ...(run.taskId ? { taskId: run.taskId } : {}), ...(await agentName(run.actorAgentId).then(name => name ? { agentName: name } : {})) });
  }

  return { completed: completed.slice(0, LIST_MAX), moved: moved.slice(0, LIST_MAX), waiting: waiting.slice(0, LIST_MAX), blockers: blockers.slice(0, LIST_MAX) };
}

const isEmpty = (content: StandupContent) => !content.completed.length && !content.moved.length && !content.waiting.length && !content.blockers.length;

async function recipients(ctx: QueryCtx, project: Doc<"projects">): Promise<Doc<"users">[]> {
  const found = new Map<Id<"users">, Doc<"users">>();
  const candidates = [
    ...(await ctx.db.query("members").withIndex("by_project", q => q.eq("projectId", project._id)).take(RECIPIENTS_MAX)),
    ...(project.teamId ? (await ctx.db.query("teamMembers").withIndex("by_team", q => q.eq("teamId", project.teamId!)).take(RECIPIENTS_MAX)).filter(row => row.role === "owner" || row.role === "admin") : []),
  ];
  for (const row of candidates) {
    if (row.status !== "active" || !row.userId || found.has(row.userId)) continue;
    const user = await ctx.db.get(row.userId);
    if (user?.status === "active" && await projectMember(ctx, project, user)) found.set(user._id, user);
  }
  return [...found.values()];
}

/** Writes the project's standup for the UTC day of `now` and links it from each member's Inbox once. */
export async function publishStandup(ctx: MutationCtx, projectId: Id<"projects">, now: number): Promise<Id<"standupDigests"> | null> {
  const project = await ctx.db.get(projectId);
  if (!project?.teamId || project.status !== "active") return null;
  const since = now - DAY_MS;
  const content = await composeStandup(ctx, project, since, now);
  if (isEmpty(content)) return null;
  const day = utcDay(now);
  const row = { ...content, chiefName: await chiefName(ctx, project._id), since };
  const existing = await ctx.db.query("standupDigests").withIndex("by_projectId_and_day", q => q.eq("projectId", project._id).eq("day", day)).unique();
  const digestId = existing ? existing._id : await ctx.db.insert("standupDigests", { teamId: project.teamId, projectId: project._id, day, ...row, createdAt: now });
  if (existing) await ctx.db.patch(existing._id, row);
  const eventId = `standup:${project._id}:${day}`;
  const preview = standupPreview(content);
  for (const user of await recipients(ctx, project)) {
    const preferences = await ctx.db.query("notificationPreferences").withIndex("by_teamId_and_userId", q => q.eq("teamId", project.teamId!).eq("userId", user._id)).unique();
    if (preferences?.mutedProjects.includes(project._id)) continue;
    const sent = await ctx.db.query("notifications").withIndex("by_user_event", q => q.eq("userId", user._id).eq("eventId", eventId)).first();
    if (sent) { await ctx.db.patch(sent._id, { preview }); continue; }
    await ctx.db.insert("notifications", { teamId: project.teamId, userId: user._id, actorId: user._id, kind: "digest", eventId, digestId, projectId: project._id, preview, read: false, createdAt: now });
  }
  return digestId;
}

export const runProject = internalMutation({
  args: { projectId: v.id("projects"), now: v.number() }, returns: v.null(),
  handler: async (ctx, a) => { await publishStandup(ctx, a.projectId, a.now); return null; },
});

export const runAll = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), now: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, a) => {
    const now = a.now ?? Date.now();
    const page = await ctx.db.query("projects").paginate({ cursor: a.cursor, numItems: 50 });
    for (const project of page.page) if (project.status === "active" && project.teamId) await ctx.scheduler.runAfter(0, internal.standup.runProject, { projectId: project._id, now });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.standup.runAll, { cursor: page.continueCursor, now });
    return null;
  },
});

/** A project admin asks the Chief for today's standup now instead of waiting for the morning run. */
export const requestNow = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  returns: v.union(v.id("standupDigests"), v.null()),
  handler: async (ctx, a) => {
    await requireAdmin(ctx, a.projectId, a.sessionToken);
    return publishStandup(ctx, a.projectId, Date.now());
  },
});

/** What the Chief's standup would say right now, for any project member, without writing it or notifying anyone. */
export const preview = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  returns: v.object({ chiefName: v.string(), since: v.number(), completed: v.array(standupIssue), moved: v.array(standupIssue), waiting: v.array(standupPull), blockers: v.array(standupBlocker) }),
  handler: async (ctx, a) => {
    const { project } = await requireMember(ctx, a.projectId, a.sessionToken);
    const now = Date.now();
    return { chiefName: await chiefName(ctx, project._id), since: now - DAY_MS, ...await composeStandup(ctx, project, now - DAY_MS, now) };
  },
});

export const get = query({
  args: { sessionToken: v.string(), teamId: v.id("teams"), digestId: v.id("standupDigests") },
  returns: v.union(v.null(), v.object({
    _id: v.id("standupDigests"), projectId: v.id("projects"), projectName: v.string(), accent: v.string(), day: v.string(), chiefName: v.string(), since: v.number(), createdAt: v.number(),
    completed: v.array(standupIssue), moved: v.array(standupIssue), waiting: v.array(standupPull), blockers: v.array(standupBlocker),
  })),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const digest = await ctx.db.get(a.digestId);
    if (!digest || digest.teamId !== a.teamId) return null;
    const project = await ctx.db.get(digest.projectId);
    if (!project || !await projectMember(ctx, project, user)) return null;
    const { teamId: _teamId, _creationTime, ...rest } = digest;
    return { ...rest, projectName: project.name, accent: project.accent };
  },
});
