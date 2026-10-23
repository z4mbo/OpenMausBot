import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { definitionHash, definitionOf } from "../../../shared/origin-shared-agents";
import { agentAccess, canSeeThread, sharedAgentsOn } from "./agentAccess";
import { hashToken } from "./auth";
import { getActiveTeamMember } from "./permissions";
import { messageByClientId } from "./agentThreadRows";

type Ctx = MutationCtx | QueryCtx;
export const MODEL_HOST_TTL = 60_000;
export const MODEL_HOST_CLAIM_TIMEOUT = 10_000;
export const MODEL_HOST_SCOPE_MAX = 200;

export function cleanHostText(value: string, max: number, label: string): string {
  const clean = value.trim();
  if (!clean || clean.length > max || Array.from(clean).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error(`${label} must be 1 to ${max} printable characters`);
  return clean;
}

export function opaqueHostId(value: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new Error("Use a persistent random device or source ID");
  return value.toLowerCase();
}

export function hostCapacity(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 8) throw new Error("Capacity must be between 1 and 8");
  return value;
}

export function hostModels(values: string[]): string[] {
  if (values.length > 100) throw new Error("Publish at most 100 model IDs per source");
  const models = values.map(value => cleanHostText(value, 200, "Model ID"));
  if (new Set(models).size !== models.length) throw new Error("Duplicate model ID");
  return models;
}

export async function hostOwner(ctx: Ctx, host: Doc<"agentHosts">) {
  const user = await ctx.db.get(host.ownerUserId);
  const member = user?.status === "active" ? await getActiveTeamMember(ctx, host.teamId, user.email) : null;
  if (!user || !member || member._id !== host.ownerMembershipId || member.role === "viewer" || member.userId && member.userId !== user._id) throw new Error("Host access is no longer active");
  return { user, member };
}

export async function authenticateModelHost(ctx: Ctx, hostId: Id<"agentHosts">, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Host authentication failed");
  const host = await ctx.db.get(hostId);
  if (!host || host.revoked || !host.credentialHash || await hashToken(token) !== host.credentialHash) throw new Error("Host authentication failed");
  return { host, ...await hostOwner(ctx, host) };
}

export function hostOnline(host: Doc<"agentHosts">, now: number): boolean {
  return host.online && !host.revoked && host.heartbeatAt <= now + 5_000 && host.heartbeatAt > now - MODEL_HOST_TTL;
}

export async function hostedSourceContext(ctx: Ctx, source: Doc<"modelHostSources">, thread: Doc<"agentThreads">, requester: Doc<"users">, model: string, now: number, allowMetered = false) {
  const host = await ctx.db.get(source.hostId);
  if (!host || host.teamId !== thread.teamId || source.teamId !== thread.teamId || !hostOnline(host, now) || !source.enabled || !source.available || source.availabilityAt <= now - MODEL_HOST_TTL || !source.models.includes(model) || !source.availableModels.includes(model)) throw new Error("Hosted model is unavailable");
  if (thread.projectId ? !source.projectIds.includes(thread.projectId) : !source.workspaceHead) throw new Error("This source is not shared with this project");
  if (source.billing !== "subscription" && !allowMetered) throw new Error("Paid or unknown API billing needs the requester's explicit permission");
  const { user: owner } = await hostOwner(ctx, host);
  const agent = await ctx.db.get(thread.agentId);
  if (!agent || agent.archivedAt !== undefined || agent.disabled || thread.archivedAt !== undefined || !await sharedAgentsOn(ctx, thread.teamId)) throw new Error("Shared execution is unavailable");
  if (requester.status !== "active" || !canSeeThread(thread, requester) || !canSeeThread(thread, owner) || !(await agentAccess(ctx, agent, requester))?.canSend || !(await agentAccess(ctx, agent, owner))?.canSend) throw new Error("Both people need current write access to this conversation");
  return { host, owner, agent };
}

export async function executionRun(ctx: Ctx, execution: Doc<"modelHostExecutions">, now: number) {
  const run = await ctx.db.get(execution.runId);
  const thread = run?.threadId ? await ctx.db.get(run.threadId) : null;
  const requester = run ? await ctx.db.get(run.requesterUserId) : null;
  if (!run || !thread || !requester || run.modelExecutionId !== execution._id || run.status !== "running" || thread.activeRunId !== run._id || (thread.leaseUntil ?? 0) <= now) throw new Error("This execution no longer holds its conversation lease");
  const source = await ctx.db.get(execution.sourceId);
  if (!source || source.hostId !== execution.hostId) throw new Error("Hosted source not found");
  const context = await hostedSourceContext(ctx, source, thread, requester, execution.model, now, execution.allowMetered === true);
  return { run, thread, requester, source, ...context };
}

export async function fencedModelExecution(ctx: MutationCtx, args: { hostId: Id<"agentHosts">; hostToken: string; executionId: Id<"modelHostExecutions">; leaseToken: string }) {
  await authenticateModelHost(ctx, args.hostId, args.hostToken);
  if (!/^[a-f0-9]{64}$/.test(args.leaseToken)) throw new Error("Execution authentication failed");
  const execution = await ctx.db.get(args.executionId), now = Date.now();
  if (!execution || execution.hostId !== args.hostId || !["claimed", "running"].includes(execution.status) || execution.leaseHash !== await hashToken(args.leaseToken) || (execution.leaseUntil ?? 0) <= now) throw new Error("Execution authentication expired or was replaced");
  return { execution, now, ...await executionRun(ctx, execution, now) };
}

export async function liveHostClaims(ctx: Ctx, hostId: Id<"agentHosts">, now: number) {
  const rows = [];
  for (const status of ["claimed", "running"] as const) {
    const active = await ctx.db.query("modelHostExecutions").withIndex("by_hostId_and_status_and_leaseUntil", q => q.eq("hostId", hostId).eq("status", status).gt("leaseUntil", now)).take(9);
    for (const row of active) {
      const run = await ctx.db.get(row.runId);
      if (run?.status === "running" && run.modelExecutionId === row._id) rows.push(row);
    }
  }
  return rows;
}

export async function executionHasReplies(ctx: Ctx, runId: Id<"workspaceAgentRuns">): Promise<boolean> {
  const rows = await ctx.db.query("agentThreadMessages").withIndex("by_runId", q => q.eq("runId", runId)).take(501);
  return rows.length > 500 || rows.some(row => row.role === "bot");
}

export async function hostWorkView(ctx: Ctx, execution: Doc<"modelHostExecutions">, now: number) {
  const context = await executionRun(ctx, execution, now);
  const { agent, run, thread, requester, source } = context;
  const message = run.requestClientId ? await messageByClientId(ctx, thread._id, run.requestClientId) : null;
  if (!message || message.runId !== run._id || message.authorUserId !== requester._id) throw new Error("Canonical request not found");
  const definition = definitionOf({ ...agent, soul: agent.soul ?? agent.instructions }, agent.look);
  return {
    executionId: execution._id, runId: run._id, threadId: thread._id, agentId: agent._id, teamId: thread.teamId,
    ...(thread.projectId ? { projectId: thread.projectId } : {}), sourceId: source._id, sourceKey: source.sourceKey, provider: source.provider, model: execution.model,
    requesterUserId: requester._id, requesterName: requester.name, requestClientId: message.clientId, requestSeq: message.seq, text: message.text ?? "",
    definitionVersion: agent.soulVersion ?? 1, definitionHash: definitionHash(definition), definition,
    status: execution.status, ...(execution.leaseUntil ? { leaseUntil: execution.leaseUntil } : {}), billing: source.billing, allowMetered: execution.allowMetered === true,
  };
}
