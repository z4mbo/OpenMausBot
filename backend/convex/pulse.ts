import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { projectMember, requireMember, requireTeamMember } from "./lib/permissions";
import { budgetLevel, monthOf } from "./budgets";
import { inferStage, pulseAttention, pulseDays, type ProjectPulse, type PulseCount, type PulseRange } from "../../shared/origin-pulse";
import { BRIEF_TAG } from "../../shared/origin-docs";
import type { JourneyFacts } from "../../shared/origin-journey";

const DAY_MS = 86_400_000;
const COMPLETIONS_MAX = 2_000;
const CREATED_MAX = 1_500;
const IDEAS_MAX = 500;
const PRS_MAX = 300;
const RUNS_MAX = 800;
const LIVE_MAX = 50;
const APPROVALS_MAX = 50;
const CYCLE_SAMPLE = 150;
const PROJECTS_MAX = 50;
const LIVE_STATUSES = ["queued", "claimed", "running", "waiting_approval"] as const;

export const pulseRange = v.union(v.literal(7), v.literal(30));

class Window {
  readonly days: string[];
  readonly since: number;
  readonly previousSince: number;
  private readonly index: Map<string, number>;
  constructor(now: number, range: PulseRange) {
    this.days = pulseDays(now, range);
    this.since = Date.parse(`${this.days[0]}T00:00:00Z`);
    this.previousSince = this.since - range * DAY_MS;
    this.index = new Map(this.days.map((day, at) => [day, at]));
  }
  series(): number[] { return this.days.map(() => 0); }
  add(count: PulseCount, at: number, series?: number[], amount = 1): void {
    const slot = this.index.get(new Date(at).toISOString().slice(0, 10));
    if (slot !== undefined) { if (series) series[slot] += amount; count.value += amount; }
    else if (at >= this.previousSince && at < this.since) count.previous += amount;
  }
}

const zero = (): PulseCount => ({ value: 0, previous: 0 });
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

async function buildSignals(ctx: QueryCtx, project: Doc<"projects">, w: Window) {
  let truncated = false;
  const draft = await ctx.db.query("columns").withIndex("by_projectId_and_isDraft_and_order", (q) => q.eq("projectId", project._id).eq("isDraft", true)).first();
  const ideaRows = draft ? await ctx.db.query("tasks").withIndex("by_column", (q) => q.eq("columnId", draft._id)).take(IDEAS_MAX) : [];
  const ideas = ideaRows.filter((task) => !task.done).length;
  truncated ||= ideaRows.length === IDEAS_MAX;
  const openAll = project.openIssueCount ?? (await ctx.db.query("tasks").withIndex("by_project_and_done", (q) => q.eq("projectId", project._id).eq("done", false)).take(1_000)).length;

  const completions = await ctx.db.query("taskCompletions").withIndex("by_projectId_and_completedAt", (q) => q.eq("projectId", project._id).gte("completedAt", w.previousSince)).take(COMPLETIONS_MAX);
  truncated ||= completions.length === COMPLETIONS_MAX;
  const done = zero();
  const doneSeries = w.series();
  for (const row of completions) w.add(done, row.completedAt, doneSeries);
  const recent = completions.filter((row) => row.completedAt >= w.since).sort((a, b) => b.completedAt - a.completedAt).slice(0, CYCLE_SAMPLE);
  const cycles: number[] = [];
  for (const row of recent) {
    const task = await ctx.db.get(row.taskId);
    if (task?.done) cycles.push(Math.max(0, row.completedAt - task.createdAt) / 3_600_000);
  }

  const created = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", project._id).gte("_creationTime", w.previousSince)).take(CREATED_MAX);
  truncated ||= created.length === CREATED_MAX;
  const opened = zero();
  const openedSeries = w.series();
  for (const task of created) if (!draft || task.columnId !== draft._id) w.add(opened, task.createdAt, openedSeries);
  const hasIssues = openAll > ideas || completions.length > 0 || opened.value + opened.previous > 0
    || Boolean(await ctx.db.query("taskCompletions").withIndex("by_projectId_and_completedAt", (q) => q.eq("projectId", project._id)).first());

  const pulls = await ctx.db.query("taskPullRequests").withIndex("by_projectId_and_number", (q) => q.eq("projectId", project._id)).order("desc").take(PRS_MAX);
  const waiting = pulls.filter((pull) => pull.state === "open");
  return {
    truncated, ideas, hasIssues, prsSeen: pulls.length,
    build: {
      open: Math.max(0, openAll - ideas), done, opened, doneSeries, openedSeries,
      prsWaiting: waiting.length, prsApproved: waiting.filter((pull) => pull.review === "approved").length, cycleHours: median(cycles),
    },
  };
}

async function teamSignals(ctx: QueryCtx, projectId: Id<"projects">, w: Window, now: number) {
  const runs = await ctx.db.query("workspaceAgentRuns").withIndex("by_projectId", (q) => q.eq("projectId", projectId).gte("_creationTime", w.previousSince)).take(RUNS_MAX);
  const count = zero();
  const runsSeries = w.series();
  const spend = zero();
  const spendSeries = w.series();
  const agents = new Set<Id<"workspaceAgents">>();
  let succeeded = 0, failed = 0;
  for (const run of runs) {
    w.add(count, run.createdAt, runsSeries);
    if (run.usage?.costUsd) w.add(spend, run.endedAt ?? run.updatedAt, spendSeries, run.usage.costUsd);
    if (run.createdAt < w.since) continue;
    agents.add(run.actorAgentId);
    if (run.status === "succeeded") succeeded += 1;
    if (run.status === "failed" && !run.retryRunId) failed += 1;
  }
  const live = (await Promise.all(LIVE_STATUSES.map((status) => ctx.db.query("workspaceAgentRuns")
    .withIndex("by_projectId_and_status_and_retryRunId", (q) => q.eq("projectId", projectId).eq("status", status)).take(LIVE_MAX)))).flat();
  const approvals = await ctx.db.query("agentApprovals").withIndex("by_projectId_and_outcome", (q) => q.eq("projectId", projectId).eq("outcome", "pending")).take(APPROVALS_MAX);
  const budget = await ctx.db.query("agentBudgets").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).first();
  const month = await ctx.db.query("budgetSpend").withIndex("by_projectId_and_month", (q) => q.eq("projectId", projectId).eq("month", monthOf(now))).first();
  const spendMonthUsd = month?.costUsd ?? 0;
  return {
    truncated: runs.length === RUNS_MAX,
    team: {
      runs: count, runsSeries, succeeded, failed, live: live.length, agents: agents.size, approvalsWaiting: approvals.length,
      spendSeries: spendSeries.map((usd) => Math.round(usd * 100) / 100), spendRangeUsd: Math.round(spend.value * 100) / 100,
      spendMonthUsd, budgetUsd: budget?.monthlyUsd ?? null, budgetLevel: budgetLevel(spendMonthUsd, budget?.monthlyUsd),
    },
  };
}

export async function projectPulse(ctx: QueryCtx, project: Doc<"projects">, range: PulseRange, now: number): Promise<ProjectPulse> {
  const w = new Window(now, range);
  const [build, team] = await Promise.all([buildSignals(ctx, project, w), teamSignals(ctx, project._id, w, now)]);
  const { stage, reached } = inferStage({
    ideas: build.ideas, issues: build.hasIssues ? 1 : 0, runs: team.team.runs.value + team.team.runs.previous, prs: build.prsSeen,
  });
  const signals = { build: build.build, team: team.team };
  return {
    projectId: project._id, name: project.name, accent: project.accent, range, days: w.days, generatedAt: now, stage, reached,
    idea: { ideas: build.ideas }, ...signals, attention: pulseAttention(signals),
    truncated: build.truncated || team.truncated,
  };
}

/** A project's dashboard over the last 7 or 30 UTC days, for any member of it. */
export const project = query({
  args: { sessionToken: v.string(), projectId: v.id("projects"), range: pulseRange },
  handler: async (ctx, args): Promise<ProjectPulse> => {
    const { project } = await requireMember(ctx, args.projectId, args.sessionToken);
    return projectPulse(ctx, project, args.range, Date.now());
  },
});

const JOURNEY_MAX = 200;

export async function journeyFacts(ctx: QueryCtx, project: Doc<"projects">): Promise<JourneyFacts> {
  const projectId = project._id;
  const docs = (await ctx.db.query("wikiPages").withIndex("by_project", (q) => q.eq("projectId", projectId)).take(JOURNEY_MAX)).filter((page) => page.type !== "credential_note");
  const draft = await ctx.db.query("columns").withIndex("by_projectId_and_isDraft_and_order", (q) => q.eq("projectId", projectId).eq("isDraft", true)).first();
  const open = await ctx.db.query("tasks").withIndex("by_project_and_done", (q) => q.eq("projectId", projectId).eq("done", false)).take(JOURNEY_MAX * 5);
  const drafts = draft ? open.filter((task) => task.columnId === draft._id).length : 0;
  const done = await ctx.db.query("tasks").withIndex("by_project_and_done", (q) => q.eq("projectId", projectId).eq("done", true)).take(JOURNEY_MAX);
  const releases = await ctx.db.query("shipReleases").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", projectId)).order("desc").take(50);
  return {
    name: project.name,
    brief: docs.some((doc) => doc.tags.includes(BRIEF_TAG)),
    docs: docs.length,
    drafts,
    issuesOpen: open.length - drafts,
    issuesDone: done.filter((task) => !draft || task.columnId !== draft._id).length,
    shipped: releases.some((release) => release.status === "published"),
  };
}

/** What a project has made so far, from Brief to a published release, for its next step. */
export const journey = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args): Promise<JourneyFacts> => {
    const { project } = await requireMember(ctx, args.projectId, args.sessionToken);
    return journeyFacts(ctx, project);
  },
});

/** The active projects of a workspace the person can open, for the workspace Pulse to read one by one. */
export const projects = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  returns: v.object({ projects: v.array(v.object({ _id: v.id("projects"), name: v.string(), accent: v.string() })), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const rows = await ctx.db.query("projects").withIndex("by_team", (q) => q.eq("teamId", args.teamId)).take(PROJECTS_MAX + 1);
    const visible = [];
    for (const row of rows.slice(0, PROJECTS_MAX)) if (row.status === "active" && await projectMember(ctx, row, user)) visible.push({ _id: row._id, name: row.name, accent: row.accent });
    return { projects: visible.sort((a, b) => a.name.localeCompare(b.name)), truncated: rows.length > PROJECTS_MAX };
  },
});
