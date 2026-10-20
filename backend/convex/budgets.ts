import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { projectMember, requireTeamAdmin, requireTeamMember } from "./lib/permissions";

export const WARN_RATIO = 0.8;
const MONTHLY_MAX = 100_000;
const ROWS_MAX = 500;

type Ctx = QueryCtx | MutationCtx;
export type BudgetLevel = "ok" | "warn" | "over";
type Target = { agentId: Id<"workspaceAgents"> } | { projectId: Id<"projects"> };

export const monthOf = (at: number) => new Date(at).toISOString().slice(0, 7);
const dollars = (usd: number) => `$${usd.toFixed(2)}`;

export function budgetLevel(spentUsd: number, monthlyUsd: number | undefined): BudgetLevel {
  if (monthlyUsd === undefined) return "ok";
  if (spentUsd >= monthlyUsd) return "over";
  return spentUsd >= monthlyUsd * WARN_RATIO ? "warn" : "ok";
}

async function budgetFor(ctx: Ctx, target: Target) {
  return "agentId" in target
    ? ctx.db.query("agentBudgets").withIndex("by_agentId", q => q.eq("agentId", target.agentId)).first()
    : ctx.db.query("agentBudgets").withIndex("by_projectId", q => q.eq("projectId", target.projectId)).first();
}

async function spendRow(ctx: Ctx, target: Target, month: string) {
  return "agentId" in target
    ? ctx.db.query("budgetSpend").withIndex("by_agentId_and_month", q => q.eq("agentId", target.agentId).eq("month", month)).first()
    : ctx.db.query("budgetSpend").withIndex("by_projectId_and_month", q => q.eq("projectId", target.projectId).eq("month", month)).first();
}

export type BudgetCheck = { scope: "agent" | "project"; name: string; spentUsd: number; monthlyUsd: number; level: BudgetLevel };

/** The agent's own budget and its project's, each with this month's spend; only the ones that are set. */
export async function budgetChecks(ctx: Ctx, agent: Doc<"workspaceAgents">, projectId: Id<"projects"> | undefined, now: number): Promise<BudgetCheck[]> {
  const month = monthOf(now);
  const checks: BudgetCheck[] = [];
  const own = await budgetFor(ctx, { agentId: agent._id });
  if (own) {
    const spent = (await spendRow(ctx, { agentId: agent._id }, month))?.costUsd ?? 0;
    checks.push({ scope: "agent", name: agent.name, spentUsd: spent, monthlyUsd: own.monthlyUsd, level: budgetLevel(spent, own.monthlyUsd) });
  }
  if (projectId) {
    const shared = await budgetFor(ctx, { projectId });
    const project = shared ? await ctx.db.get(projectId) : null;
    if (shared && project) {
      const spent = (await spendRow(ctx, { projectId }, month))?.costUsd ?? 0;
      checks.push({ scope: "project", name: project.name, spentUsd: spent, monthlyUsd: shared.monthlyUsd, level: budgetLevel(spent, shared.monthlyUsd) });
    }
  }
  return checks;
}

export function refusalLine(check: BudgetCheck): string {
  return `Budget reached: ${check.name} spent ${dollars(check.spentUsd)} of its ${dollars(check.monthlyUsd)} monthly budget. A workspace admin can raise it.`;
}

/** The one-line reason the agent may not start another run this month, or null. */
export async function budgetRefusal(ctx: Ctx, agent: Doc<"workspaceAgents">, projectId: Id<"projects"> | undefined, now: number): Promise<string | null> {
  const over = (await budgetChecks(ctx, agent, projectId, now)).find(check => check.level === "over");
  return over ? refusalLine(over) : null;
}

async function addSpend(ctx: MutationCtx, teamId: Id<"teams">, target: Target, month: string, costUsd: number, now: number) {
  const row = await spendRow(ctx, target, month);
  if (row) await ctx.db.patch(row._id, { costUsd: row.costUsd + costUsd, runs: row.runs + 1, updatedAt: now });
  else await ctx.db.insert("budgetSpend", { teamId, month, ...target, costUsd, runs: 1, updatedAt: now });
}

/** Books what a finished run reported against its agent's and its project's month. */
export async function recordSpend(ctx: MutationCtx, run: Pick<Doc<"workspaceAgentRuns">, "teamId" | "actorAgentId" | "projectId">, costUsd: number | undefined, now: number): Promise<void> {
  if (costUsd === undefined || !Number.isFinite(costUsd) || costUsd <= 0) return;
  const month = monthOf(now);
  await addSpend(ctx, run.teamId, { agentId: run.actorAgentId }, month, costUsd, now);
  if (run.projectId) await addSpend(ctx, run.teamId, { projectId: run.projectId }, month, costUsd, now);
}

const line = v.object({ spentUsd: v.number(), runs: v.number(), monthlyUsd: v.optional(v.number()) });

/** This month's spend and the budgets set on each agent and project the person can see, for the Org page. */
export const overview = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  returns: v.object({
    month: v.string(), canEdit: v.boolean(),
    agents: v.array(v.object({ agentId: v.id("workspaceAgents"), ...line.fields })),
    projects: v.array(v.object({ projectId: v.id("projects"), ...line.fields })),
  }),
  handler: async (ctx, a) => {
    const { member, user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const month = monthOf(Date.now());
    const visible = new Map<Id<"projects">, boolean>();
    const sees = async (projectId: Id<"projects"> | undefined) => {
      if (!projectId) return true;
      if (!visible.has(projectId)) {
        const project = await ctx.db.get(projectId);
        visible.set(projectId, Boolean(project && await projectMember(ctx, project, user)));
      }
      return visible.get(projectId)!;
    };
    const agents = new Map<Id<"workspaceAgents">, { spentUsd: number; runs: number; monthlyUsd?: number }>();
    const projects = new Map<Id<"projects">, { spentUsd: number; runs: number; monthlyUsd?: number }>();
    for (const row of await ctx.db.query("budgetSpend").withIndex("by_teamId_and_month", q => q.eq("teamId", a.teamId).eq("month", month)).take(ROWS_MAX)) {
      if (row.agentId) agents.set(row.agentId, { spentUsd: row.costUsd, runs: row.runs });
      else if (row.projectId && await sees(row.projectId)) projects.set(row.projectId, { spentUsd: row.costUsd, runs: row.runs });
    }
    for (const budget of await ctx.db.query("agentBudgets").withIndex("by_teamId", q => q.eq("teamId", a.teamId)).take(ROWS_MAX)) {
      if (budget.agentId) agents.set(budget.agentId, { spentUsd: 0, runs: 0, ...agents.get(budget.agentId), monthlyUsd: budget.monthlyUsd });
      else if (budget.projectId && await sees(budget.projectId)) projects.set(budget.projectId, { spentUsd: 0, runs: 0, ...projects.get(budget.projectId), monthlyUsd: budget.monthlyUsd });
    }
    const agentRows = [];
    for (const [agentId, row] of agents) {
      const agent = await ctx.db.get(agentId);
      if (agent && agent.teamId === a.teamId && await sees(agent.projectId)) agentRows.push({ agentId, ...row });
    }
    return {
      month, canEdit: member.role === "owner" || member.role === "admin",
      agents: agentRows, projects: [...projects].map(([projectId, row]) => ({ projectId, ...row })),
    };
  },
});

/** Sets or clears (`monthlyUsd: null`) one agent's or one project's monthly budget. Workspace admins only. */
export const set = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), agentId: v.optional(v.id("workspaceAgents")), projectId: v.optional(v.id("projects")), monthlyUsd: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, a) => {
    const { user } = await requireTeamAdmin(ctx, a.teamId, a.sessionToken);
    if (Boolean(a.agentId) === Boolean(a.projectId)) throw new Error("Set a budget on one agent or one project");
    if (a.monthlyUsd !== null && (!Number.isFinite(a.monthlyUsd) || a.monthlyUsd < 1 || a.monthlyUsd > MONTHLY_MAX)) {
      throw new Error(`A monthly budget is between $1 and $${MONTHLY_MAX.toLocaleString("en-US")}`);
    }
    const owner = a.agentId ? await ctx.db.get(a.agentId) : await ctx.db.get(a.projectId!);
    if (!owner || owner.teamId !== a.teamId) throw new Error(a.agentId ? "Agent not found" : "Project not found");
    const target: Target = a.agentId ? { agentId: a.agentId } : { projectId: a.projectId! };
    const existing = await budgetFor(ctx, target);
    if (a.monthlyUsd === null) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const monthlyUsd = Math.round(a.monthlyUsd * 100) / 100;
    if (existing) await ctx.db.patch(existing._id, { monthlyUsd, updatedBy: user._id, updatedAt: Date.now() });
    else await ctx.db.insert("agentBudgets", { teamId: a.teamId, ...target, monthlyUsd, updatedBy: user._id, updatedAt: Date.now() });
    return null;
  },
});

/** The tightest budget on one agent this month, for its chat header: null when none is set. */
export const forAgent = query({
  args: { sessionToken: v.string(), agentId: v.id("workspaceAgents") },
  returns: v.union(v.null(), v.object({
    scope: v.union(v.literal("agent"), v.literal("project")), name: v.string(), spentUsd: v.number(), monthlyUsd: v.number(),
    level: v.union(v.literal("ok"), v.literal("warn"), v.literal("over")), canRaise: v.boolean(), teamId: v.id("teams"), projectId: v.optional(v.id("projects")),
  })),
  handler: async (ctx, a) => {
    const agent = await ctx.db.get(a.agentId);
    if (!agent) return null;
    const { member } = await requireTeamMember(ctx, agent.teamId, a.sessionToken);
    const checks = await budgetChecks(ctx, agent, agent.projectId, Date.now());
    const tightest = checks.sort((x, y) => y.spentUsd / y.monthlyUsd - x.spentUsd / x.monthlyUsd)[0];
    if (!tightest) return null;
    return { ...tightest, canRaise: member.role === "owner" || member.role === "admin", teamId: agent.teamId, ...(tightest.scope === "project" && agent.projectId ? { projectId: agent.projectId } : {}) };
  },
});
