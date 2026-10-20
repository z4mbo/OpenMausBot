import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { projectMember, requireTeamMember } from "./lib/permissions";

const AGENTS_MAX = 300;
const RUNS_MAX = 500;
const USAGE_WINDOW_MS = 7 * 86_400_000;
const TASK_MAX = 140;
const LIVE = ["queued", "claimed", "running", "waiting_approval"] as const;
const ENDED = ["succeeded", "failed", "cancelled", "interrupted"] as const;

const phase = v.union(v.literal("idle"), v.literal("queued"), v.literal("working"), v.literal("waiting_approval"));
const node = v.object({
  _id: v.id("workspaceAgents"), kind: v.union(v.literal("head"), v.literal("chief"), v.literal("agent")), name: v.string(), title: v.optional(v.string()),
  color: v.string(), projectId: v.optional(v.id("projects")), engine: v.string(), model: v.string(),
  phase, task: v.optional(v.string()), liveRuns: v.number(),
  runs: v.number(), tokens: v.number(), costUsd: v.number(),
});
const project = v.object({ _id: v.id("projects"), name: v.string(), accent: v.string() });

type Phase = typeof phase.type;
const clip = (text: string) => { const line = text.replace(/\s+/g, " ").trim(); return line.length > TASK_MAX ? `${line.slice(0, TASK_MAX - 1)}…` : line; };

export function runPhase(status: Doc<"workspaceAgentRuns">["status"]): Phase {
  if (status === "waiting_approval") return "waiting_approval";
  if (status === "running" || status === "claimed") return "working";
  if (status === "queued") return "queued";
  return "idle";
}
const PHASE_RANK: Record<Phase, number> = { idle: 0, queued: 1, working: 2, waiting_approval: 3 };

async function visibleProjects(ctx: QueryCtx, teamId: Id<"teams">, user: Doc<"users">) {
  const rows = await ctx.db.query("projects").withIndex("by_team", q => q.eq("teamId", teamId)).take(200);
  const visible = new Map<Id<"projects">, Doc<"projects">>();
  for (const row of rows) if (row.status === "active" && await projectMember(ctx, row, user)) visible.set(row._id, row);
  return visible;
}

/** The workspace's boss, project Chiefs and their agents, each with what it is doing now and its last seven days of usage. */
export const tree = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  returns: v.object({ agents: v.array(node), projects: v.array(project), truncated: v.boolean() }),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const projects = await visibleProjects(ctx, a.teamId, user);
    const agents = (await ctx.db.query("workspaceAgents").withIndex("by_teamId", q => q.eq("teamId", a.teamId)).take(AGENTS_MAX + 1))
      .filter(agent => !agent.archivedAt && !agent.disabled && (!agent.projectId || projects.has(agent.projectId)));
    const since = Date.now() - USAGE_WINDOW_MS;
    const livePages = await Promise.all(LIVE.map(status => ctx.db.query("workspaceAgentRuns").withIndex("by_teamId_and_status", q => q.eq("teamId", a.teamId).eq("status", status)).take(RUNS_MAX)));
    const endedPages = await Promise.all(ENDED.map(status => ctx.db.query("workspaceAgentRuns")
      .withIndex("by_teamId_and_status_and_historyPurgedAt_and_updatedAt", q => q.eq("teamId", a.teamId).eq("status", status).eq("historyPurgedAt", undefined).gte("updatedAt", since))
      .order("desc").take(RUNS_MAX)));
    const live = livePages.flat(), ended = endedPages.flat();
    const seen = (run: Doc<"workspaceAgentRuns">) => !run.projectId || projects.has(run.projectId);

    const nodes = agents.slice(0, AGENTS_MAX).map(agent => {
      const mine = live.filter(run => run.actorAgentId === agent._id && seen(run));
      const current = mine.sort((x, y) => PHASE_RANK[runPhase(y.status)] - PHASE_RANK[runPhase(x.status)] || y.updatedAt - x.updatedAt)[0];
      const used = [...mine, ...ended.filter(run => run.actorAgentId === agent._id && seen(run))].filter(run => run.createdAt >= since);
      return {
        _id: agent._id, kind: agent.kind ?? "agent", name: agent.name, ...(agent.title ? { title: agent.title } : {}),
        color: agent.color ?? agent.avatarColor, ...(agent.projectId ? { projectId: agent.projectId } : {}), engine: agent.engine, model: agent.model,
        phase: current ? runPhase(current.status) : "idle" as Phase, ...(current ? { task: clip(current.task) } : {}), liveRuns: mine.length,
        runs: used.length,
        tokens: used.reduce((sum, run) => sum + (run.usage ? run.usage.input + run.usage.output : 0), 0),
        costUsd: used.reduce((sum, run) => sum + (run.usage?.costUsd ?? 0), 0),
      };
    });
    return {
      agents: nodes,
      projects: [...projects.values()].map(row => ({ _id: row._id, name: row.name, accent: row.accent })),
      truncated: agents.length > AGENTS_MAX || [...livePages, ...endedPages].some(page => page.length >= RUNS_MAX),
    };
  },
});
