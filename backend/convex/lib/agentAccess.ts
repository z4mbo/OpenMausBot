import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireUser } from "./auth";
import { getActiveTeamMember, projectMember } from "./permissions";

type Ctx = QueryCtx | MutationCtx;
type Person = Pick<Doc<"users">, "_id" | "email">;
type Role = "owner" | "admin" | "member" | "viewer";

export interface AgentAccess {
  user: Doc<"users">;
  membership: Doc<"teamMembers">;
  /** The narrower of the workspace role and, for a project agent, the project role. */
  role: Role;
  canEdit: boolean;
  canSend: boolean;
}

async function teamMembership(ctx: Ctx, teamId: Id<"teams">, user: Person) {
  const member = await getActiveTeamMember(ctx, teamId, user.email);
  return member && (!member.userId || member.userId === user._id) ? member : null;
}

export async function sharedAgentsOn(ctx: Ctx, teamId: Id<"teams">): Promise<boolean> {
  return (await ctx.db.get(teamId))?.sharedAgents === true;
}

export async function requireSharedAgents(ctx: Ctx, teamId: Id<"teams">): Promise<void> {
  if (!await sharedAgentsOn(ctx, teamId)) throw new Error("Shared agents are off for this workspace");
}

/** Read needs project (or workspace) membership; edit needs owner/admin/project admin or the creator; send needs a non-viewer role. */
export async function agentAccess(ctx: Ctx, agent: Doc<"workspaceAgents">, user: Doc<"users">): Promise<AgentAccess | null> {
  const membership = await teamMembership(ctx, agent.teamId, user);
  if (!membership) return null;
  let role: Role = membership.role;
  if (agent.projectId) {
    const project = await ctx.db.get(agent.projectId);
    if (!project || project.teamId !== agent.teamId) return null;
    const member = await projectMember(ctx, project, user);
    if (!member) return null;
    role = member.role;
  }
  const workspaceAdmin = membership.role === "owner" || membership.role === "admin";
  const projectAdmin = role === "owner" || role === "admin";
  return {
    user, membership, role,
    canEdit: workspaceAdmin || projectAdmin || (agent.createdBy === user._id && role !== "viewer"),
    canSend: role !== "viewer" && membership.role !== "viewer",
  };
}

export async function requireAgent(ctx: Ctx, agentId: Id<"workspaceAgents">, sessionToken: string) {
  const user = await requireUser(ctx, sessionToken);
  const agent = await ctx.db.get(agentId);
  const access = agent ? await agentAccess(ctx, agent, user) : null;
  if (!agent || !access) throw new Error("Agent not found");
  return { agent, access };
}

export function canSeeThread(thread: Doc<"agentThreads">, user: Pick<Doc<"users">, "_id">): boolean {
  return !thread.private || thread.createdBy === user._id;
}

export async function requireThread(ctx: Ctx, threadId: Id<"agentThreads">, sessionToken: string) {
  const user = await requireUser(ctx, sessionToken);
  const thread = await ctx.db.get(threadId);
  const agent = thread ? await ctx.db.get(thread.agentId) : null;
  const access = agent ? await agentAccess(ctx, agent, user) : null;
  if (!thread || !agent || !access || !canSeeThread(thread, user)) throw new Error("Thread not found");
  return { thread, agent, access, user };
}

export async function requireWritableThread(ctx: Ctx, threadId: Id<"agentThreads">, sessionToken: string) {
  const context = await requireThread(ctx, threadId, sessionToken);
  await requireSharedAgents(ctx, context.thread.teamId);
  if (!context.access.canSend) throw new Error("View-only access");
  if (context.thread.archivedAt !== undefined || context.agent.archivedAt !== undefined) throw new Error("This thread is archived");
  if (context.agent.disabled) throw new Error("This agent is disabled");
  return context;
}

export async function canResumeThreadRun(ctx: Ctx, run: Doc<"workspaceAgentRuns">, user: Doc<"users">): Promise<boolean> {
  if (!run.threadId || run.requesterUserId !== user._id) return false;
  const thread = await ctx.db.get(run.threadId);
  if (!thread || thread.archivedAt !== undefined || !canSeeThread(thread, user)) return false;
  const agent = await ctx.db.get(thread.agentId);
  if (!agent || agent.disabled || agent.archivedAt !== undefined || !await sharedAgentsOn(ctx, thread.teamId)) return false;
  return (await agentAccess(ctx, agent, user))?.canSend === true;
}

/** Security: a bot-role row is written only by the person whose run produced it, while that run is live or just ended. */
export const BOT_WRITE_GRACE_MS = 120_000;

export function runAcceptsBotWrites(run: Doc<"workspaceAgentRuns"> | null, userId: Id<"users">, threadId: Id<"agentThreads">, now: number): boolean {
  if (!run || run.requesterUserId !== userId || run.threadId !== threadId) return false;
  if (run.status === "running") return true;
  return run.endedAt !== undefined && now - run.endedAt <= BOT_WRITE_GRACE_MS && run.status !== "queued";
}
