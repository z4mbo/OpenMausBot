import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { avatarLook, runUsage, threadAttachment, threadMessageKind, threadMessageTool } from "./agentsTables";
import { hostedModelTarget, modelExecutionStatus, modelSourceBilling } from "./modelHostsTables";
import { hashToken, requireUser } from "./lib/auth";
import { requireThread, requireWritableThread } from "./lib/agentAccess";
import { cleanPayload, cleanText, cleanTool, messageByClientId, nextSeq, settleRun, userNames } from "./lib/agentThreadRows";
import { canEdit, projectMember, requireTeamMember } from "./lib/permissions";
import { authenticateModelHost, cleanHostText, executionHasReplies, executionRun, fencedModelExecution, hostCapacity, hostModels, hostOnline, hostOwner, hostWorkView, hostedSourceContext, liveHostClaims, MODEL_HOST_SCOPE_MAX, MODEL_HOST_TTL, opaqueHostId } from "./lib/modelHostAccess";
import { latestModelExecution, modelExecutionRetryable, recoveryQueryTime } from "./lib/modelHostRecovery";
import { budgetRefusal, recordSpend } from "./budgets";

const hostAuth = { hostId: v.id("agentHosts"), hostToken: v.string() };
const fenced = { ...hostAuth, executionId: v.id("modelHostExecutions"), leaseToken: v.string() };
const definitionView = v.object({ name: v.string(), title: v.string(), description: v.string(), soul: v.string(), color: v.string(), mascotExpression: v.optional(v.string()), mascotBody: v.optional(v.string()), look: v.optional(avatarLook) });
const workView = v.object({
  executionId: v.id("modelHostExecutions"), runId: v.id("workspaceAgentRuns"), threadId: v.id("agentThreads"), agentId: v.id("workspaceAgents"), teamId: v.id("teams"), projectId: v.optional(v.id("projects")),
  sourceId: v.id("modelHostSources"), sourceKey: v.string(), provider: v.string(), model: v.string(), requesterUserId: v.id("users"), requesterName: v.string(), requestClientId: v.string(), requestSeq: v.number(), text: v.string(),
  definitionVersion: v.number(), definitionHash: v.string(), definition: definitionView,
  status: modelExecutionStatus, leaseUntil: v.optional(v.number()), billing: modelSourceBilling, allowMetered: v.boolean(),
});
const requestKey = (value: string) => cleanHostText(value, 160, "Request key");
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("");

async function requireMonthlyBudget(ctx: MutationCtx, agent: Doc<"workspaceAgents">, projectId: Id<"projects"> | undefined, now: number) {
  const refusal = await budgetRefusal(ctx, agent, projectId ?? agent.projectId, now);
  if (refusal) throw new Error(refusal);
}

async function ownedHost(ctx: MutationCtx, sessionToken: string, hostId: Id<"agentHosts">) {
  const user = await requireUser(ctx, sessionToken), host = await ctx.db.get(hostId);
  if (!host || host.ownerUserId !== user._id || !host.deviceId || host.revoked) throw new Error("Host not found");
  await hostOwner(ctx, host);
  return { host, user };
}

async function offer(ctx: MutationCtx, run: Doc<"workspaceAgentRuns">, sourceId: Id<"modelHostSources">, model: string, key: string, allowMetered = false) {
  const thread = run.threadId ? await ctx.db.get(run.threadId) : null, requester = await ctx.db.get(run.requesterUserId), source = await ctx.db.get(sourceId);
  const now = Date.now();
  if (!thread || !requester || !source || run.status !== "running" && run.status !== "queued") throw new Error("Run or source not found");
  const { agent } = await hostedSourceContext(ctx, source, thread, requester, model, now, allowMetered);
  await requireMonthlyBudget(ctx, agent, thread.projectId, now);
  const attempts = await ctx.db.query("modelHostExecutions").withIndex("by_runId", q => q.eq("runId", run._id)).take(17);
  if (attempts.length >= 16) throw new Error("This message reached its model attempt limit");
  if (attempts.some(attempt => attempt.sourceId === sourceId && attempt.model === model || attempt.requestKey === key)) throw new Error("This source or request was already attempted for this message");
  const executionId = await ctx.db.insert("modelHostExecutions", { teamId: run.teamId, runId: run._id, hostId: source.hostId, sourceId, model, requestKey: key, status: "pending", activityObserved: false, safeToRetry: false, allowMetered, createdAt: now, updatedAt: now });
  await ctx.db.patch(run._id, { modelExecutionId: executionId, hostId: source.hostId, engine: source.provider, model, engineLabel: source.label, heartbeatAt: now, updatedAt: now });
  return executionId;
}

export const register = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), deviceId: v.string(), name: v.string(), capacity: v.number() },
  returns: v.object({ hostId: v.id("agentHosts"), hostToken: v.union(v.string(), v.null()), created: v.boolean() }),
  handler: async (ctx, args) => {
    const { user, member } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Read-only members cannot offer a computer");
    const deviceId = opaqueHostId(args.deviceId), capacity = hostCapacity(args.capacity), name = cleanHostText(args.name, 80, "Computer name");
    const existing = await ctx.db.query("agentHosts").withIndex("by_ownerUserId_and_teamId_and_deviceId", q => q.eq("ownerUserId", user._id).eq("teamId", args.teamId).eq("deviceId", deviceId)).unique();
    if (existing) {
      if (existing.revoked) throw new Error("This computer was revoked; explicitly register a new device identity");
      await ctx.db.patch(existing._id, { name, capabilities: { ...existing.capabilities, capacity } });
      return { hostId: existing._id, hostToken: null, created: false };
    }
    const hosts = await ctx.db.query("agentHosts").withIndex("by_teamId", q => q.eq("teamId", args.teamId)).take(MODEL_HOST_SCOPE_MAX + 1);
    if (hosts.length >= MODEL_HOST_SCOPE_MAX) throw new Error("This workspace has too many registered computers");
    if (hosts.filter(host => host.ownerUserId === user._id && host.deviceId && !host.revoked).length >= 20) throw new Error("Offer at most 20 computers in one workspace");
    const token = secret(), now = Date.now();
    const hostId = await ctx.db.insert("agentHosts", { teamId: args.teamId, ownerUserId: user._id, ownerMembershipId: member._id, deviceId, credentialHash: await hashToken(token), name, kind: "local", shared: false, online: false, revoked: false, heartbeatAt: now, capabilities: { engines: [], models: [], computers: [], capacity }, activeRuns: 0, createdAt: now });
    return { hostId, hostToken: token, created: true };
  },
});

export const setSource = mutation({
  args: { sessionToken: v.string(), hostId: v.id("agentHosts"), sourceKey: v.string(), provider: v.string(), label: v.string(), billing: modelSourceBilling, models: v.array(v.string()), enabled: v.boolean(), projectIds: v.array(v.id("projects")), workspaceHead: v.boolean(), capacity: v.number() },
  returns: v.id("modelHostSources"),
  handler: async (ctx, args) => {
    const { host, user } = await ownedHost(ctx, args.sessionToken, args.hostId);
    const sourceKey = opaqueHostId(args.sourceKey), models = hostModels(args.models), capacity = hostCapacity(args.capacity), provider = cleanHostText(args.provider, 80, "Provider"), label = cleanHostText(args.label, 80, "Account label");
    if (args.projectIds.length > 100 || new Set(args.projectIds).size !== args.projectIds.length) throw new Error("Choose up to 100 distinct projects");
    for (const id of args.projectIds) {
      const project = await ctx.db.get(id), member = project && project.teamId === host.teamId ? await projectMember(ctx, project, user) : null;
      if (!member || !canEdit(member)) throw new Error("Source scope requires current project write access");
    }
    const existing = await ctx.db.query("modelHostSources").withIndex("by_hostId_and_sourceKey", q => q.eq("hostId", host._id).eq("sourceKey", sourceKey)).unique();
    if (existing && existing.provider !== provider) throw new Error("A different provider needs a new source identity");
    const all = await ctx.db.query("modelHostSources").withIndex("by_hostId", q => q.eq("hostId", host._id)).take(21);
    if (!existing && all.length >= 20) throw new Error("Offer at most 20 accounts from one computer");
    if (args.enabled) {
      const enabled = await ctx.db.query("modelHostSources").withIndex("by_teamId_and_enabled", q => q.eq("teamId", host.teamId).eq("enabled", true)).take(MODEL_HOST_SCOPE_MAX + 1);
      if ((!existing || !existing.enabled) && enabled.length >= MODEL_HOST_SCOPE_MAX) throw new Error("This workspace has too many shared model accounts");
    }
    const availableModels = existing?.availableModels.filter(model => models.includes(model)) ?? [];
    const values = { provider, label, billing: args.billing, models, enabled: args.enabled, projectIds: args.projectIds, workspaceHead: args.workspaceHead, capacity, availableModels, available: args.enabled && existing?.available === true && availableModels.length > 0, availabilityAt: existing?.availabilityAt ?? 0, updatedAt: Date.now() };
    const id = existing?._id ?? await ctx.db.insert("modelHostSources", { teamId: host.teamId, hostId: host._id, sourceKey, ...values });
    if (existing) await ctx.db.patch(existing._id, values);
    await ctx.db.patch(host._id, { shared: args.enabled || all.some(source => source._id !== id && source.enabled) });
    return id;
  },
});

export const heartbeat = mutation({
  args: { ...hostAuth, online: v.boolean(), sources: v.array(v.object({ sourceId: v.id("modelHostSources"), available: v.boolean(), models: v.array(v.string()) })) },
  returns: v.object({ heartbeatAt: v.number(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const { host } = await authenticateModelHost(ctx, args.hostId, args.hostToken), now = Date.now();
    if (args.sources.length > 20 || new Set(args.sources.map(source => source.sourceId)).size !== args.sources.length) throw new Error("Invalid source availability list");
    const owned = await ctx.db.query("modelHostSources").withIndex("by_hostId", q => q.eq("hostId", host._id)).take(21);
    for (const report of args.sources) {
      const source = owned.find(candidate => candidate._id === report.sourceId), models = hostModels(report.models);
      if (!source || models.some(model => !source.models.includes(model))) throw new Error("Heartbeat cannot add or widen a model account grant");
      await ctx.db.patch(source._id, { available: args.online && source.enabled && report.available, availableModels: models, availabilityAt: now });
    }
    for (const source of owned) if (!args.sources.some(report => report.sourceId === source._id)) await ctx.db.patch(source._id, { available: false, availableModels: [], availabilityAt: now });
    await ctx.db.patch(host._id, { online: args.online, heartbeatAt: now, activeRuns: (await liveHostClaims(ctx, host._id, now)).length });
    return { heartbeatAt: now, expiresAt: now + MODEL_HOST_TTL };
  },
});

export const catalog = query({
  args: { sessionToken: v.string(), teamId: v.id("teams"), projectId: v.optional(v.id("projects")), now: v.number() },
  returns: v.array(v.object({ sourceId: v.id("modelHostSources"), hostId: v.id("agentHosts"), ownerUserId: v.id("users"), ownerName: v.string(), computerName: v.string(), provider: v.string(), label: v.string(), billing: modelSourceBilling, models: v.array(v.string()), heartbeatAt: v.number(), expiresAt: v.number(), capacity: v.number() })),
  handler: async (ctx, args) => {
    const { user, member } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    if (!canEdit(member)) return [];
    if ((await ctx.db.get(args.teamId))?.sharedAgents !== true) return [];
    const project = args.projectId ? await ctx.db.get(args.projectId) : null;
    if (args.projectId && (!project || project.teamId !== args.teamId || !canEdit((await projectMember(ctx, project, user)) ?? { role: "viewer" }))) throw new Error("No project write access");
    const sources = await ctx.db.query("modelHostSources").withIndex("by_teamId_and_enabled", q => q.eq("teamId", args.teamId).eq("enabled", true)).take(MODEL_HOST_SCOPE_MAX + 1);
    if (sources.length > MODEL_HOST_SCOPE_MAX) throw new Error("Shared model catalog exceeds its bound");
    const out = [];
    for (const source of sources) {
      if (!source.available || source.availabilityAt <= args.now - MODEL_HOST_TTL || (args.projectId ? !source.projectIds.includes(args.projectId) : !source.workspaceHead)) continue;
      const host = await ctx.db.get(source.hostId);
      if (!host || !hostOnline(host, args.now)) continue;
      try {
        const { user: owner } = await hostOwner(ctx, host);
        if (project && !canEdit((await projectMember(ctx, project, owner)) ?? { role: "viewer" })) continue;
        out.push({ sourceId: source._id, hostId: host._id, ownerUserId: owner._id, ownerName: owner.name, computerName: host.name, provider: source.provider, label: source.label, billing: source.billing, models: source.availableModels.filter(model => source.models.includes(model)), heartbeatAt: host.heartbeatAt, expiresAt: Math.min(host.heartbeatAt, source.availabilityAt) + MODEL_HOST_TTL, capacity: Math.min(source.capacity, host.capabilities.capacity) });
      } catch { continue; }
    }
    return out;
  },
});

export const ownedHosts = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  returns: v.array(v.object({ hostId: v.id("agentHosts"), deviceId: v.string(), name: v.string(), online: v.boolean(), revoked: v.boolean(), heartbeatAt: v.number(), capacity: v.number() })),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const hosts = await ctx.db.query("agentHosts").withIndex("by_ownerUserId_and_teamId_and_deviceId", q => q.eq("ownerUserId", user._id).eq("teamId", args.teamId)).take(MODEL_HOST_SCOPE_MAX + 1);
    if (hosts.length > MODEL_HOST_SCOPE_MAX) throw new Error("Computer list exceeds its bound");
    return hosts.flatMap(host => host.deviceId ? [{ hostId: host._id, deviceId: host.deviceId, name: host.name, online: host.online, revoked: host.revoked, heartbeatAt: host.heartbeatAt, capacity: host.capabilities.capacity }] : []);
  },
});

export const ownedSources = query({
  args: { sessionToken: v.string(), hostId: v.id("agentHosts") },
  returns: v.array(v.object({ sourceId: v.id("modelHostSources"), sourceKey: v.string(), provider: v.string(), label: v.string(), billing: modelSourceBilling, models: v.array(v.string()), enabled: v.boolean(), projectIds: v.array(v.id("projects")), workspaceHead: v.boolean(), capacity: v.number() })),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken), host = await ctx.db.get(args.hostId);
    if (!host || host.ownerUserId !== user._id) throw new Error("Host not found"); await requireTeamMember(ctx, host.teamId, args.sessionToken);
    const sources = await ctx.db.query("modelHostSources").withIndex("by_hostId", q => q.eq("hostId", host._id)).take(21);
    if (sources.length > 20) throw new Error("Model account list exceeds its bound");
    return sources.map(source => ({ sourceId: source._id, sourceKey: source.sourceKey, provider: source.provider, label: source.label, billing: source.billing, models: source.models, enabled: source.enabled, projectIds: source.projectIds, workspaceHead: source.workspaceHead, capacity: source.capacity }));
  },
});

export const begin = mutation({
  args: { sessionToken: v.string(), threadId: v.id("agentThreads"), clientId: v.string(), text: v.string(), ...hostedModelTarget.fields, attachments: v.optional(v.array(threadAttachment)) },
  returns: v.object({ runId: v.id("workspaceAgentRuns"), messageId: v.id("agentThreadMessages"), executionId: v.id("modelHostExecutions"), status: v.string(), seq: v.number() }),
  handler: async (ctx, args) => {
    const { thread, agent, access, user } = await requireWritableThread(ctx, args.threadId, args.sessionToken), clientId = requestKey(args.clientId), now = Date.now();
    const existing = await messageByClientId(ctx, thread._id, clientId);
    if (existing) {
      const run = existing.runId ? await ctx.db.get(existing.runId) : null;
      const execution = run?.modelExecutionId ? await ctx.db.get(run.modelExecutionId) : null;
      if (existing.authorUserId !== user._id || !run || !execution || execution.sourceId !== args.sourceId || execution.model !== args.model) throw new Error("This message already has another execution route");
      return { runId: run._id, messageId: existing._id, executionId: execution._id, status: run.status, seq: existing.seq };
    }
    await requireMonthlyBudget(ctx, agent, thread.projectId, now);
    const holder = thread.activeRunId ? await ctx.db.get(thread.activeRunId) : null;
    if (holder?.status === "running" && (thread.leaseUntil ?? 0) <= now) await settleRun(ctx, holder, "interrupted", now);
    const fresh = (await ctx.db.get(thread._id))!, status = fresh.activeRunId ? "queued" as const : "running" as const;
    const runId = await ctx.db.insert("workspaceAgentRuns", { teamId: thread.teamId, ...(thread.projectId ? { projectId: thread.projectId } : {}), threadId: thread._id, requestClientId: clientId, requesterUserId: user._id, requesterMembershipId: access.membership._id, actorAgentId: agent._id, status, task: args.text.slice(0, 500), engine: agent.engine, model: args.model, effort: agent.effort, depth: 0, eventSequence: 0, lastEventAt: now, heartbeatAt: now, createdAt: now, updatedAt: now });
    const executionId = await offer(ctx, (await ctx.db.get(runId))!, args.sourceId, args.model, clientId, args.allowMetered);
    const seq = await nextSeq(ctx, fresh, now, true);
    const messageId = await ctx.db.insert("agentThreadMessages", { teamId: thread.teamId, threadId: thread._id, seq, updSeq: seq, clientId, role: "user", kind: "text", text: cleanText(args.text, "user"), authorUserId: user._id, runId, status: "final", ...(args.attachments?.length ? { attachments: args.attachments.slice(0, 20) } : {}), createdAt: now, updatedAt: now });
    if (status === "running") await ctx.db.patch(thread._id, { activeRunId: runId, leaseUntil: now + MODEL_HOST_TTL });
    return { runId, messageId, executionId, status, seq };
  },
});

export const offerExisting = mutation({
  args: { sessionToken: v.string(), runId: v.id("workspaceAgentRuns"), ...hostedModelTarget.fields, requestKey: v.string(), safeInitialRefusal: v.literal(true), quiesced: v.literal(true) },
  returns: v.id("modelHostExecutions"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken), run = await ctx.db.get(args.runId), key = requestKey(args.requestKey);
    if (!run?.threadId || run.requesterUserId !== user._id) throw new Error("Run not found");
    await requireWritableThread(ctx, run.threadId, args.sessionToken);
    if (run.modelExecutionId) {
      const current = await ctx.db.get(run.modelExecutionId);
      if (current?.runId === run._id && current.requestKey === key && current.sourceId === args.sourceId && current.model === args.model) return current._id;
      throw new Error("This run is already assigned to an executor");
    }
    if (run.status !== "running") throw new Error("Run not found");
    if (await executionHasReplies(ctx, run._id)) throw new Error("Work already produced output; automatic transfer is unavailable");
    const thread = (await ctx.db.get(run.threadId))!;
    if (thread.activeRunId !== run._id || (thread.leaseUntil ?? 0) <= Date.now()) throw new Error("Conversation lease expired");
    return offer(ctx, run, args.sourceId, args.model, key, args.allowMetered);
  },
});

export const pending = query({
  args: { ...hostAuth, now: v.number() }, returns: v.array(workView),
  handler: async (ctx, args) => {
    const { host } = await authenticateModelHost(ctx, args.hostId, args.hostToken);
    const rows = await ctx.db.query("modelHostExecutions").withIndex("by_hostId_and_status_and_leaseUntil", q => q.eq("hostId", host._id).eq("status", "pending")).take(50);
    const out = [];
    for (const execution of rows) { try { out.push(await hostWorkView(ctx, execution, args.now)); } catch { continue; } }
    return out;
  },
});

export const claim = mutation({
  args: { ...hostAuth, executionId: v.id("modelHostExecutions"), claimId: v.string(), leaseToken: v.string() }, returns: v.object({ work: workView, leaseUntil: v.number() }),
  handler: async (ctx, args) => {
    const { host } = await authenticateModelHost(ctx, args.hostId, args.hostToken), execution = await ctx.db.get(args.executionId), now = Date.now();
    const claimId = opaqueHostId(args.claimId);
    if (!/^[a-f0-9]{64}$/.test(args.leaseToken)) throw new Error("Use a random 256-bit execution lease token");
    const leaseHash = await hashToken(args.leaseToken);
    if (!execution || execution.hostId !== host._id) throw new Error("Execution not found");
    const context = await executionRun(ctx, execution, now);
    if (execution.status === "claimed" && execution.claimId === claimId && execution.leaseHash === leaseHash && (execution.leaseUntil ?? 0) > now) return { work: await hostWorkView(ctx, execution, now), leaseUntil: execution.leaseUntil! };
    if (execution.status !== "pending") throw new Error("This execution was already accepted or ended; it cannot be replayed");
    await requireMonthlyBudget(ctx, context.agent, context.thread.projectId, now);
    const active = await liveHostClaims(ctx, host._id, now);
    if (active.length >= host.capabilities.capacity || active.filter(row => row.sourceId === execution.sourceId).length >= context.source.capacity) throw new Error("This model account or computer is at capacity");
    await ctx.db.patch(execution._id, { status: "claimed", claimId, leaseHash, leaseUntil: now + MODEL_HOST_TTL, updatedAt: now });
    await ctx.db.patch(host._id, { activeRuns: active.length + 1 });
    await ctx.db.patch(context.run._id, { executedByUserId: context.owner._id, heartbeatAt: now, updatedAt: now });
    await ctx.db.patch(context.thread._id, { leaseUntil: now + MODEL_HOST_TTL });
    return { work: await hostWorkView(ctx, (await ctx.db.get(execution._id))!, now), leaseUntil: now + MODEL_HOST_TTL };
  },
});

export const started = mutation({
  args: fenced, returns: v.null(), handler: async (ctx, args) => {
    const { execution, now, agent, thread } = await fencedModelExecution(ctx, args);
    if (execution.status !== "running") await requireMonthlyBudget(ctx, agent, thread.projectId, now);
    await ctx.db.patch(execution._id, { status: "running", startedAt: execution.startedAt ?? now, updatedAt: now }); return null;
  },
});

export const activity = mutation({
  args: fenced, returns: v.null(), handler: async (ctx, args) => {
    const { execution, now } = await fencedModelExecution(ctx, args);
    await ctx.db.patch(execution._id, { activityObserved: true, updatedAt: now }); return null;
  },
});

export const heartbeatExecution = mutation({
  args: fenced, returns: v.object({ leaseUntil: v.number() }), handler: async (ctx, args) => {
    const { execution, now, run, thread } = await fencedModelExecution(ctx, args);
    await ctx.db.patch(execution._id, { leaseUntil: now + MODEL_HOST_TTL, updatedAt: now });
    await ctx.db.patch(run._id, { heartbeatAt: now, updatedAt: now }); await ctx.db.patch(thread._id, { leaseUntil: now + MODEL_HOST_TTL });
    return { leaseUntil: now + MODEL_HOST_TTL };
  },
});

export const context = mutation({
  args: { ...fenced, afterSeq: v.number(), limit: v.optional(v.number()) },
  returns: v.object({ requestSeq: v.number(), nextSeq: v.number(), more: v.boolean(), messages: v.array(v.object({ seq: v.number(), role: v.union(v.literal("user"), v.literal("bot")), kind: threadMessageKind, text: v.optional(v.string()), tool: v.optional(threadMessageTool), authorUserId: v.optional(v.id("users")), authorName: v.optional(v.string()), runBy: v.optional(v.string()), executedByName: v.optional(v.string()), status: v.union(v.literal("streaming"), v.literal("final"), v.literal("interrupted")), createdAt: v.number() })) }),
  handler: async (ctx, args) => {
    const { run, thread } = await fencedModelExecution(ctx, args);
    if (!Number.isSafeInteger(args.afterSeq) || args.afterSeq < 0 || args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 50)) throw new Error("Choose a valid bounded context page");
    const request = run.requestClientId ? await messageByClientId(ctx, thread._id, run.requestClientId) : null;
    if (!request || request.runId !== run._id) throw new Error("Canonical request not found");
    const rows = await ctx.db.query("agentThreadMessages").withIndex("by_threadId_and_seq", q => q.eq("threadId", thread._id).gt("seq", args.afterSeq).lt("seq", request.seq)).take((args.limit ?? 50) + 1);
    const messages = [], encoder = new TextEncoder(), name = userNames(ctx); let used = 0, nextSeq = args.afterSeq;
    for (const row of rows.slice(0, args.limit ?? 50)) {
      const previousRun = row.runId ? await ctx.db.get(row.runId) : null;
      const message = { seq: row.seq, role: row.role, kind: row.kind, ...(row.text !== undefined ? { text: row.text } : {}), ...(row.tool ? { tool: row.tool } : {}),
        ...(row.authorUserId ? { authorUserId: row.authorUserId, authorName: await name(row.authorUserId) } : {}),
        ...(previousRun ? { runBy: await name(previousRun.requesterUserId), ...(previousRun.executedByUserId ? { executedByName: await name(previousRun.executedByUserId) } : {}) } : {}),
        status: row.status, createdAt: row.createdAt };
      const size = encoder.encode(JSON.stringify(message)).length;
      if (size > 262_144) throw new Error("A context row exceeds its safe page size");
      if (used + size > 262_144) break;
      used += size; messages.push(message); nextSeq = row.seq;
    }
    return { requestSeq: request.seq, nextSeq, more: rows.length > messages.length, messages };
  },
});

export const appendReply = mutation({
  args: { ...fenced, clientId: v.string(), kind: threadMessageKind, text: v.optional(v.string()), tool: v.optional(threadMessageTool), payload: v.optional(v.string()), status: v.union(v.literal("streaming"), v.literal("final")) },
  returns: v.object({ messageId: v.id("agentThreadMessages"), seq: v.number() }), handler: async (ctx, args) => {
    const { execution, now, run, thread } = await fencedModelExecution(ctx, args), clientId = requestKey(args.clientId);
    const existing = await messageByClientId(ctx, thread._id, clientId);
    if (existing) { if (existing.role !== "bot" || existing.runId !== run._id) throw new Error("Message ID belongs to another writer"); return { messageId: existing._id, seq: existing.seq }; }
    const seq = await nextSeq(ctx, thread, now, true);
    const messageId = await ctx.db.insert("agentThreadMessages", { teamId: thread.teamId, threadId: thread._id, runId: run._id, clientId, role: "bot", kind: args.kind, seq, updSeq: seq, status: args.status, ...(args.text !== undefined ? { text: cleanText(args.text, "bot") } : {}), ...(args.tool ? { tool: cleanTool(args.tool) } : {}), ...(args.payload !== undefined ? { payload: cleanPayload(args.payload) } : {}), createdAt: now, updatedAt: now });
    await ctx.db.patch(execution._id, { activityObserved: true, updatedAt: now }); return { messageId, seq };
  },
});

export const patchReply = mutation({
  args: { ...fenced, clientId: v.string(), text: v.optional(v.string()), tool: v.optional(threadMessageTool), payload: v.optional(v.string()), status: v.union(v.literal("streaming"), v.literal("final")) }, returns: v.object({ seq: v.number() }),
  handler: async (ctx, args) => {
    const { execution, now, run, thread } = await fencedModelExecution(ctx, args), row = await messageByClientId(ctx, thread._id, requestKey(args.clientId));
    if (!row || row.role !== "bot" || row.runId !== run._id || row.status === "interrupted") throw new Error("Reply not found");
    const seq = await nextSeq(ctx, thread, now);
    await ctx.db.patch(row._id, { updSeq: seq, status: args.status, ...(args.text !== undefined ? { text: cleanText(args.text, "bot") } : {}), ...(args.tool ? { tool: cleanTool(args.tool) } : {}), ...(args.payload !== undefined ? { payload: cleanPayload(args.payload) } : {}), updatedAt: now });
    await ctx.db.patch(execution._id, { activityObserved: true, updatedAt: now }); return { seq };
  },
});

export const finish = mutation({
  args: { ...fenced, outcome: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("quota_exhausted")), safeInitialRefusal: v.optional(v.boolean()), quiesced: v.optional(v.boolean()), usage: v.optional(runUsage) }, returns: v.object({ safeToRetry: v.boolean() }),
  handler: async (ctx, args) => {
    const { execution, now, run, thread } = await fencedModelExecution(ctx, args);
    const safeToRetry = args.outcome === "quota_exhausted" && args.safeInitialRefusal === true && args.quiesced === true && !execution.activityObserved && !await executionHasReplies(ctx, run._id);
    await ctx.db.patch(execution._id, { status: safeToRetry ? "refused" : args.outcome === "succeeded" ? "succeeded" : "failed", safeToRetry, ...(safeToRetry ? { refusal: "quota_exhausted" } : {}), leaseUntil: undefined, updatedAt: now });
    if (safeToRetry) { await ctx.db.patch(run._id, { heartbeatAt: now, updatedAt: now }); await ctx.db.patch(thread._id, { leaseUntil: now + MODEL_HOST_TTL }); }
    else {
      await settleRun(ctx, run, args.outcome === "succeeded" ? "succeeded" : "failed", now, args.usage ? { usage: args.usage } : {});
      await recordSpend(ctx, run, args.usage?.costUsd, now);
    }
    return { safeToRetry };
  },
});

export const decline = mutation({
  args: { ...hostAuth, executionId: v.id("modelHostExecutions"), reason: v.union(v.literal("unavailable"), v.literal("configuration"), v.literal("budget"), v.literal("policy")) }, returns: v.null(),
  handler: async (ctx, args) => {
    await authenticateModelHost(ctx, args.hostId, args.hostToken); const execution = await ctx.db.get(args.executionId);
    if (!execution || execution.hostId !== args.hostId || execution.status !== "pending") throw new Error("Only an unaccepted execution can be declined");
    const { run } = await executionRun(ctx, execution, Date.now());
    if (await executionHasReplies(ctx, run._id)) throw new Error("Work already produced output");
    await ctx.db.patch(execution._id, { status: "refused", safeToRetry: true, refusal: args.reason, updatedAt: Date.now() }); return null;
  },
});

export const advance = mutation({
  args: { sessionToken: v.string(), runId: v.id("workspaceAgentRuns"), previousExecutionId: v.id("modelHostExecutions"), requestKey: v.string(), target: v.union(hostedModelTarget, v.object({ kind: v.literal("sender"), provider: v.string(), model: v.string() }), v.null()) },
  returns: v.object({ executionId: v.union(v.id("modelHostExecutions"), v.null()), route: v.union(v.literal("host"), v.literal("sender"), v.literal("stopped")) }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken), run = await ctx.db.get(args.runId), previous = await ctx.db.get(args.previousExecutionId), now = Date.now(), key = requestKey(args.requestKey);
    if (!run?.threadId || run.requesterUserId !== user._id || !previous || previous.runId !== run._id) throw new Error("Run not found");
    const { thread } = await requireWritableThread(ctx, run.threadId, args.sessionToken);
    if (previous.status === "superseded" && (await latestModelExecution(ctx, run))?._id === previous._id) {
      if (args.target === null && run.status === "failed" && run.modelExecutionId === previous._id) return { executionId: null, route: "stopped" as const };
      if (args.target && "kind" in args.target && !run.modelExecutionId && run.executedByUserId === user._id && run.engine === cleanHostText(args.target.provider, 80, "Provider") && run.model === cleanHostText(args.target.model, 200, "Model")) return { executionId: null, route: "sender" as const };
    }
    if (run.status !== "running" || thread.activeRunId !== run._id || (thread.leaseUntil ?? 0) <= now) throw new Error("Conversation lease expired");
    if (run.modelExecutionId !== previous._id) {
      const current = run.modelExecutionId ? await ctx.db.get(run.modelExecutionId) : null;
      if (current?.requestKey === key && args.target && "sourceId" in args.target && current.sourceId === args.target.sourceId && current.model === args.target.model) return { executionId: current._id, route: "host" as const };
      throw new Error("This execution was already replaced");
    }
    if (!await modelExecutionRetryable(ctx, previous, run, thread, now)) throw new Error("Accepted or uncertain work cannot be automatically retried");
    await ctx.db.patch(previous._id, { status: "superseded", safeToRetry: false, leaseUntil: undefined, updatedAt: now });
    if (args.target === null) { await settleRun(ctx, run, "failed", now); return { executionId: null, route: "stopped" as const }; }
    if ("sourceId" in args.target) return { executionId: await offer(ctx, run, args.target.sourceId, args.target.model, key, args.target.allowMetered), route: "host" as const };
    await ctx.db.patch(run._id, { modelExecutionId: undefined, hostId: undefined, executedByUserId: user._id, engine: cleanHostText(args.target.provider, 80, "Provider"), model: cleanHostText(args.target.model, 200, "Model"), heartbeatAt: now, updatedAt: now });
    await ctx.db.patch(thread._id, { leaseUntil: now + MODEL_HOST_TTL }); return { executionId: null, route: "sender" as const };
  },
});

export const executionStatus = query({
  args: { sessionToken: v.string(), executionId: v.id("modelHostExecutions"), now: v.optional(v.number()) }, returns: v.object({ sourceId: v.id("modelHostSources"), model: v.string(), requestKey: v.string(), status: v.string(), runStatus: v.string(), currentExecutionId: v.union(v.id("modelHostExecutions"), v.null()), safeToRetry: v.boolean(), refusal: v.optional(v.string()), leaseUntil: v.optional(v.number()), createdAt: v.number() }),
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId), run = execution ? await ctx.db.get(execution.runId) : null;
    if (!execution || !run?.threadId) throw new Error("Execution not found"); const { thread } = await requireThread(ctx, run.threadId, args.sessionToken);
    return { sourceId: execution.sourceId, model: execution.model, requestKey: execution.requestKey, status: execution.status, runStatus: run.status, currentExecutionId: run.modelExecutionId ?? null, safeToRetry: await modelExecutionRetryable(ctx, execution, run, thread, recoveryQueryTime(args.now)), createdAt: execution.createdAt, ...(execution.refusal ? { refusal: execution.refusal } : {}), ...(execution.leaseUntil ? { leaseUntil: execution.leaseUntil } : {}) };
  },
});

export const requestStatus = query({
  args: { sessionToken: v.string(), threadId: v.id("agentThreads"), clientId: v.string(), now: v.optional(v.number()) },
  returns: v.union(v.null(), v.object({ runId: v.id("workspaceAgentRuns"), runStatus: v.string(), route: v.union(v.literal("host"), v.literal("sender"), v.literal("none")), currentExecutionId: v.union(v.id("modelHostExecutions"), v.null()), previousExecutionId: v.optional(v.id("modelHostExecutions")), sourceId: v.optional(v.id("modelHostSources")), hostId: v.optional(v.id("agentHosts")), executionStatus: v.optional(v.string()), requestKey: v.optional(v.string()), model: v.string(), provider: v.string(), safeToRetry: v.boolean() })),
  handler: async (ctx, args) => {
    const { thread, user } = await requireWritableThread(ctx, args.threadId, args.sessionToken);
    const key = requestKey(args.clientId), row = await messageByClientId(ctx, thread._id, key);
    if (!row) return null;
    const run = row.runId ? await ctx.db.get(row.runId) : null;
    if (row.role !== "user" || row.authorUserId !== user._id || !run || run.threadId !== thread._id || run.requesterUserId !== user._id || run.requestClientId !== key) throw new Error("Request not found");
    const execution = run.modelExecutionId ? await ctx.db.get(run.modelExecutionId) : null;
    const latest = execution ? null : await latestModelExecution(ctx, run), now = recoveryQueryTime(args.now);
    const active = run.status === "queued" || run.status === "running" && thread.activeRunId === run._id && (thread.leaseUntil ?? 0) > now;
    return { runId: run._id, runStatus: run.status, route: active ? execution ? "host" as const : "sender" as const : "none" as const, currentExecutionId: run.modelExecutionId ?? null,
      ...(latest?.status === "superseded" && run.executedByUserId === user._id ? { previousExecutionId: latest._id } : {}),
      ...(execution ? { sourceId: execution.sourceId, hostId: execution.hostId, executionStatus: execution.status, requestKey: execution.requestKey } : {}),
      model: run.model, provider: run.engine, safeToRetry: execution ? await modelExecutionRetryable(ctx, execution, run, thread, now) : false };
  },
});

export const revoke = mutation({
  args: { sessionToken: v.string(), hostId: v.id("agentHosts") }, returns: v.null(), handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken), host = await ctx.db.get(args.hostId), now = Date.now();
    if (!host || host.ownerUserId !== user._id) throw new Error("Host not found");
    if (host.revoked) return null;
    await ctx.db.patch(host._id, { revoked: true, shared: false, online: false });
    for (const execution of await liveHostClaims(ctx, host._id, now)) {
      await ctx.db.patch(execution._id, { status: "interrupted", safeToRetry: false, leaseUntil: undefined, updatedAt: now });
      const run = await ctx.db.get(execution.runId); if (run?.status === "running") await settleRun(ctx, run, "interrupted", now);
    }
    return null;
  },
});
