/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { createSession } from "./lib/auth";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const device = "10000000-0000-4000-8000-000000000001";
const sourceKey = "20000000-0000-4000-8000-000000000001";
const claimId = "30000000-0000-4000-8000-000000000001";
const leaseToken = "a".repeat(64);
const leaseArgs = (args: { hostId: Id<"agentHosts">; hostToken: string; executionId: Id<"modelHostExecutions">; leaseToken: string }) => ({ hostId: args.hostId, hostToken: args.hostToken, executionId: args.executionId, leaseToken: args.leaseToken });

async function fixture() {
  const t = convexTest(schema, modules);
  const people = await t.run(async ctx => {
    const out = [];
    for (const name of ["Owner", "Sender", "Viewer", "Outsider"]) {
      const email = `${name.toLowerCase()}@example.test`, now = Date.now();
      const id = await ctx.db.insert("users", { email, name, passwordHash: "synthetic", salt: "synthetic", iterations: 1, role: "user", status: "active", createdAt: now, updatedAt: now });
      out.push({ id, email, token: await createSession(ctx, id) });
    }
    return { owner: out[0], sender: out[1], viewer: out[2], outsider: out[3] };
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: people.owner.token, name: "Hosted synthetic team" });
  await t.run(async ctx => {
    for (const [person, role] of [[people.sender, "member"], [people.viewer, "viewer"]] as const) await ctx.db.insert("teamMembers", { teamId, userId: person.id, email: person.email, name: role, role, status: "active", createdAt: Date.now(), updatedAt: Date.now() });
  });
  const projectId = await t.mutation(api.projects.create, { sessionToken: people.owner.token, teamId, name: "Synthetic app", repoUrl: "https://github.com/example/synthetic" });
  for (const person of [people.sender, people.viewer]) await t.mutation(api.members.addWorkspaceMember, { sessionToken: people.owner.token, projectId, email: person.email, role: "member" });
  await t.mutation(api.agents.setSharedAgents, { sessionToken: people.owner.token, teamId, enabled: true });
  const [agent] = await t.mutation(api.agents.publishProjectTeam, { sessionToken: people.owner.token, teamId, projectId, agents: [{ roleKey: "chief", kind: "chief", name: "Project Chief", soul: "Synthetic instructions" }] });
  const thread = async (priv = false) => t.mutation(api.agentThreads.create, { sessionToken: people.sender.token, agentId: agent.agentId, title: "Synthetic request", private: priv });
  const host = await t.mutation(api.modelHosts.register, { sessionToken: people.owner.token, teamId, deviceId: device, name: "Same computer name", capacity: 1 });
  expect(host.hostToken).toBeTypeOf("string");
  const hostAuth = { hostId: host.hostId, hostToken: host.hostToken! };
  const sourceInput = { sessionToken: people.owner.token, hostId: host.hostId, sourceKey, provider: "claudeAgent", label: "Synthetic subscription", billing: "subscription" as const, models: ["synthetic-model"], enabled: true, projectIds: [projectId], workspaceHead: false, capacity: 1 };
  const sourceId = await t.mutation(api.modelHosts.setSource, sourceInput);
  const heartbeat = async (online = true) => t.mutation(api.modelHosts.heartbeat, { ...hostAuth, online, sources: [{ sourceId, available: true, models: ["synthetic-model"] }] });
  await heartbeat();
  const begin = async (threadId: Awaited<ReturnType<typeof thread>>, clientId = "send:synthetic") => t.mutation(api.modelHosts.begin, { sessionToken: people.sender.token, threadId, clientId, text: "Canonical full synthetic request", sourceId, model: "synthetic-model" });
  return { t, ...people, teamId, projectId, agentId: agent.agentId, hostAuth, sourceId, sourceInput, thread, heartbeat, begin };
}

afterEach(() => vi.useRealTimers());

describe("explicit model source sharing", () => {
  test("uses persistent device identity, not hostname, and stores only credential hashes", async () => {
    const f = await fixture();
    const other = await f.t.mutation(api.modelHosts.register, { sessionToken: f.owner.token, teamId: f.teamId, deviceId: "10000000-0000-4000-8000-000000000002", name: "Same computer name", capacity: 1 });
    expect(other.hostId).not.toBe(f.hostAuth.hostId);
    const again = await f.t.mutation(api.modelHosts.register, { sessionToken: f.owner.token, teamId: f.teamId, deviceId: device, name: "Renamed computer", capacity: 1 });
    expect(again).toEqual({ hostId: f.hostAuth.hostId, hostToken: null, created: false });
    const stored = await f.t.run(ctx => ctx.db.get(f.hostAuth.hostId));
    expect(stored?.credentialHash).toHaveLength(64); expect(stored?.credentialHash).not.toBe(f.hostAuth.hostToken);
    expect(JSON.stringify(stored)).not.toContain(f.hostAuth.hostToken);
    await expect(f.t.query(api.workspaces.list, { sessionToken: f.hostAuth.hostToken })).rejects.toThrow();
  });

  test("requires source-owner consent and current project membership without publishing credentials", async () => {
    const f = await fixture();
    const catalog = await f.t.query(api.modelHosts.catalog, { sessionToken: f.sender.token, teamId: f.teamId, projectId: f.projectId, now: Date.now() });
    expect(catalog).toHaveLength(1); expect(catalog[0]).toMatchObject({ hostId: f.hostAuth.hostId, sourceId: f.sourceId, ownerUserId: f.owner.id, models: ["synthetic-model"] });
    expect(JSON.stringify(catalog)).not.toContain(f.hostAuth.hostToken); expect(JSON.stringify(catalog)).not.toContain(sourceKey);
    await expect(f.t.mutation(api.modelHosts.setSource, { ...f.sourceInput, sessionToken: f.sender.token })).rejects.toThrow(/Host not found/);
    await f.t.mutation(api.modelHosts.setSource, { ...f.sourceInput, enabled: false });
    await f.heartbeat();
    expect(await f.t.query(api.modelHosts.catalog, { sessionToken: f.sender.token, teamId: f.teamId, projectId: f.projectId, now: Date.now() })).toEqual([]);
    await expect(f.begin(await f.thread())).rejects.toThrow(/unavailable/);
  });

  test("legacy sender advertisements cannot turn a stable device back online or widen its capacity", async () => {
    const f = await fixture(); await f.heartbeat(false);
    const legacy = await f.t.mutation(api.agents.publishHost, { sessionToken: f.owner.token, teamId: f.teamId, name: "Same computer name", engines: ["claudeAgent"], models: ["synthetic-model"], computers: [] });
    expect(legacy).not.toBe(f.hostAuth.hostId);
    expect(await f.t.run(ctx => ctx.db.get(f.hostAuth.hostId))).toMatchObject({ online: false, deviceId: device });
    expect(await f.t.query(api.modelHosts.catalog, { sessionToken: f.sender.token, teamId: f.teamId, projectId: f.projectId, now: Date.now() })).toEqual([]);
  });

  test("denies readonly people and outsiders, and heartbeat cannot widen owner grants", async () => {
    const f = await fixture();
    await expect(f.t.mutation(api.modelHosts.register, { sessionToken: f.viewer.token, teamId: f.teamId, deviceId: device, name: "Viewer device", capacity: 1 })).rejects.toThrow(/Read-only/);
    expect(await f.t.query(api.modelHosts.catalog, { sessionToken: f.viewer.token, teamId: f.teamId, projectId: f.projectId, now: Date.now() })).toEqual([]);
    await expect(f.t.query(api.modelHosts.catalog, { sessionToken: f.outsider.token, teamId: f.teamId, projectId: f.projectId, now: Date.now() })).rejects.toThrow();
    await expect(f.t.mutation(api.modelHosts.heartbeat, { ...f.hostAuth, online: true, sources: [{ sourceId: f.sourceId, available: true, models: ["ungranted-model"] }] })).rejects.toThrow(/cannot add or widen/);
    await expect(f.t.mutation(api.modelHosts.heartbeat, { ...f.hostAuth, hostToken: "b".repeat(64), online: true, sources: [] })).rejects.toThrow(/authentication/);
  });

  test("does not expose private history to another source owner or bypass project grants", async () => {
    const f = await fixture();
    await expect(f.begin(await f.thread(true))).rejects.toThrow(/Both people/);
    await f.t.mutation(api.modelHosts.setSource, { ...f.sourceInput, projectIds: [] }); await f.heartbeat();
    await expect(f.begin(await f.thread())).rejects.toThrow(/not shared with this project/);
  });

  test("skips stale computers and requires a fresh heartbeat before admission", async () => {
    vi.useFakeTimers(); const f = await fixture(); vi.setSystemTime(Date.now() + 60_001);
    expect(await f.t.query(api.modelHosts.catalog, { sessionToken: f.sender.token, teamId: f.teamId, projectId: f.projectId, now: Date.now() })).toEqual([]);
    await expect(f.begin(await f.thread())).rejects.toThrow(/unavailable/);
    await f.heartbeat(); await expect(f.begin(await f.thread(), "fresh-send")).resolves.toMatchObject({ status: "running" });
  });

  test("requires metered permission and rechecks it when source billing changes before claim", async () => {
    const f = await fixture(), threadId = await f.thread(), pending = await f.begin(threadId);
    await f.t.mutation(api.modelHosts.setSource, { ...f.sourceInput, billing: "metered" }); await f.heartbeat();
    await expect(f.t.mutation(api.modelHosts.claim, { ...f.hostAuth, executionId: pending.executionId, claimId, leaseToken })).rejects.toThrow(/explicit permission/);
    const paidThread = await f.thread();
    await expect(f.t.mutation(api.modelHosts.begin, { sessionToken: f.sender.token, threadId: paidThread, clientId: "paid", text: "Synthetic paid request", sourceId: f.sourceId, model: "synthetic-model" })).rejects.toThrow(/explicit permission/);
    await expect(f.t.mutation(api.modelHosts.begin, { sessionToken: f.sender.token, threadId: paidThread, clientId: "paid", text: "Synthetic paid request", sourceId: f.sourceId, model: "synthetic-model", allowMetered: true })).resolves.toMatchObject({ status: "running" });
  });

  test("owner controls can inspect exact grants, while other members cannot read owner source keys", async () => {
    const f = await fixture();
    const own = await f.t.query(api.modelHosts.ownedSources, { sessionToken: f.owner.token, hostId: f.hostAuth.hostId });
    expect(own).toEqual([expect.objectContaining({ sourceId: f.sourceId, sourceKey, projectIds: [f.projectId], enabled: true })]);
    await expect(f.t.query(api.modelHosts.ownedSources, { sessionToken: f.sender.token, hostId: f.hostAuth.hostId })).rejects.toThrow(/Host not found/);
    expect(await f.t.query(api.modelHosts.ownedHosts, { sessionToken: f.sender.token, teamId: f.teamId })).toEqual([]);
    await expect(f.t.mutation(api.modelHosts.setSource, { ...f.sourceInput, provider: "different-provider" })).rejects.toThrow(/new source identity/);
  });
});

describe("fenced executor admission and transcript ownership", () => {
  test("monthly agent and project budgets also refuse hosted requests before creating work", async () => {
    for (const target of ["agent", "project"] as const) {
      const f = await fixture(), threadId = await f.thread();
      await f.t.mutation(api.budgets.set, { sessionToken: f.owner.token, teamId: f.teamId, ...(target === "agent" ? { agentId: f.agentId } : { projectId: f.projectId }), monthlyUsd: 1 });
      await f.t.run(async ctx => { await ctx.db.insert("budgetSpend", { teamId: f.teamId, ...(target === "agent" ? { agentId: f.agentId } : { projectId: f.projectId }), month: new Date().toISOString().slice(0, 7), costUsd: 1, runs: 1, updatedAt: Date.now() }); });
      await expect(f.begin(threadId)).rejects.toThrow(/Budget reached/);
      expect(await f.t.run(ctx => ctx.db.query("modelHostExecutions").collect())).toEqual([]);
      expect(await f.t.run(ctx => ctx.db.query("workspaceAgentRuns").collect())).toEqual([]);
    }
  });

  test("hosted dispatch rechecks a cap changed after admission", async () => {
    const f = await fixture(), threadId = await f.thread(), begun = await f.begin(threadId);
    await f.t.mutation(api.budgets.set, { sessionToken: f.owner.token, teamId: f.teamId, agentId: f.agentId, monthlyUsd: 1 });
    const spendId = await f.t.run(ctx => ctx.db.insert("budgetSpend", { teamId: f.teamId, agentId: f.agentId, month: new Date().toISOString().slice(0, 7), costUsd: 1, runs: 1, updatedAt: Date.now() }));
    const claim = { ...f.hostAuth, executionId: begun.executionId, claimId, leaseToken };
    await expect(f.t.mutation(api.modelHosts.claim, claim)).rejects.toThrow(/Budget reached/);
    await f.t.run(ctx => ctx.db.delete(spendId));
    await f.t.mutation(api.modelHosts.claim, claim);
    const changed = await f.t.run(ctx => ctx.db.insert("budgetSpend", { teamId: f.teamId, agentId: f.agentId, month: new Date().toISOString().slice(0, 7), costUsd: 1, runs: 1, updatedAt: Date.now() }));
    await expect(f.t.mutation(api.modelHosts.started, leaseArgs(claim))).rejects.toThrow(/Budget reached/);
    await f.t.run(ctx => ctx.db.delete(changed));
    await f.t.mutation(api.modelHosts.started, leaseArgs(claim));
  });

  test.each(["succeeded", "failed"] as const)("a %s hosted receipt books monthly spend exactly once", async outcome => {
    const f = await fixture(), begun = await f.begin(await f.thread());
    const claim = { ...f.hostAuth, executionId: begun.executionId, claimId, leaseToken };
    await f.t.mutation(api.modelHosts.claim, claim);
    await f.t.mutation(api.modelHosts.started, leaseArgs(claim));
    const finish = { ...leaseArgs(claim), outcome, usage: { input: 1, output: 1, costUsd: 0.75 } };
    await f.t.mutation(api.modelHosts.finish, finish);
    await expect(f.t.mutation(api.modelHosts.finish, finish)).rejects.toThrow(/expired|replaced/);
    await expect(f.t.mutation(api.agentRuns.finish, { sessionToken: f.sender.token, runId: begun.runId, status: "succeeded", usage: finish.usage })).rejects.toThrow(/executor lease/);
    const rows = await f.t.run(ctx => ctx.db.query("budgetSpend").collect());
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ costUsd: 0.75, runs: 1 });
  });

  test("reconciles one canonical request only for its requester and reports sender transfer without new work", async () => {
    const f = await fixture(), threadId = await f.thread();
    const lookup = { sessionToken: f.sender.token, threadId, clientId: "send:synthetic" };
    expect(await f.t.query(api.modelHosts.requestStatus, lookup)).toBeNull();
    const begun = await f.begin(threadId);
    expect(await f.t.query(api.modelHosts.requestStatus, lookup)).toMatchObject({ runId: begun.runId, runStatus: "running", route: "host", currentExecutionId: begun.executionId, sourceId: f.sourceId, model: "synthetic-model", requestKey: "send:synthetic", safeToRetry: false });
    await expect(f.t.query(api.modelHosts.requestStatus, { ...lookup, sessionToken: f.owner.token })).rejects.toThrow(/Request not found/);
    await expect(f.t.query(api.modelHosts.requestStatus, { ...lookup, sessionToken: f.outsider.token })).rejects.toThrow();
    await f.t.mutation(api.modelHosts.decline, { ...f.hostAuth, executionId: begun.executionId, reason: "configuration" });
    const route = { sessionToken: f.sender.token, runId: begun.runId, previousExecutionId: begun.executionId, requestKey: "lost-sender-response", target: { kind: "sender" as const, provider: "grok", model: "local-other" } };
    expect(await f.t.mutation(api.modelHosts.advance, route)).toEqual({ executionId: null, route: "sender" });
    expect(await f.t.mutation(api.modelHosts.advance, route)).toEqual({ executionId: null, route: "sender" });
    expect(await f.t.query(api.modelHosts.requestStatus, lookup)).toMatchObject({ runId: begun.runId, runStatus: "running", route: "sender", currentExecutionId: null, previousExecutionId: begun.executionId, provider: "grok", model: "local-other", safeToRetry: false });
    await expect(f.t.mutation(api.modelHosts.advance, { ...route, target: { ...route.target, model: "different-local" } })).rejects.toThrow();
    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.sender.token, runId: begun.runId, status: "succeeded" });
    const next = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.sender.token, threadId, clientId: "next-work", text: "Separate next work" });
    expect(await f.t.query(api.modelHosts.requestStatus, lookup)).toMatchObject({ runId: begun.runId, runStatus: "succeeded", route: "none", currentExecutionId: null, previousExecutionId: begun.executionId });
    expect(await f.t.mutation(api.modelHosts.advance, route)).toEqual({ executionId: null, route: "sender" });
    expect(await f.t.run(ctx => ctx.db.get(threadId))).toMatchObject({ activeRunId: next.runId });
    expect(await f.t.run(ctx => ctx.db.query("modelHostExecutions").withIndex("by_runId", q => q.eq("runId", begun.runId)).take(17))).toHaveLength(1);
  });

  test("reconciles a stopped exhausted chain after its response is lost without touching the next run", async () => {
    const f = await fixture(), threadId = await f.thread(), begun = await f.begin(threadId);
    await f.t.mutation(api.modelHosts.decline, { ...f.hostAuth, executionId: begun.executionId, reason: "configuration" });
    const route = { sessionToken: f.sender.token, runId: begun.runId, previousExecutionId: begun.executionId, requestKey: "lost-stop-response", target: null };
    expect(await f.t.mutation(api.modelHosts.advance, route)).toEqual({ executionId: null, route: "stopped" });
    const next = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.sender.token, threadId, clientId: "next-work", text: "Separate next work" });
    expect(await f.t.mutation(api.modelHosts.advance, route)).toEqual({ executionId: null, route: "stopped" });
    expect(await f.t.query(api.modelHosts.requestStatus, { sessionToken: f.sender.token, threadId, clientId: "send:synthetic" })).toMatchObject({ runStatus: "failed", route: "none", currentExecutionId: begun.executionId, executionStatus: "superseded", safeToRetry: false });
    expect(await f.t.run(ctx => ctx.db.get(threadId))).toMatchObject({ activeRunId: next.runId });
  });

  test("authoritatively reports retryable unclaimed timeout but never accepted work, output, or expired conversation leases", async () => {
    vi.useFakeTimers(); const f = await fixture(), begun = await f.begin(await f.thread());
    const args = { sessionToken: f.sender.token, executionId: begun.executionId };
    expect(await f.t.query(api.modelHosts.executionStatus, { ...args, now: Date.now() + 60_000 })).toMatchObject({ safeToRetry: false });
    vi.setSystemTime(Date.now() + 10_001);
    expect(await f.t.query(api.modelHosts.executionStatus, { ...args, now: Date.now() })).toMatchObject({ safeToRetry: true });
    await f.t.mutation(api.modelHosts.claim, { ...f.hostAuth, executionId: begun.executionId, claimId, leaseToken });
    expect(await f.t.query(api.modelHosts.executionStatus, { ...args, now: Date.now() + 60_000 })).toMatchObject({ safeToRetry: false });
    vi.setSystemTime(Date.now() + 60_001);
    expect(await f.t.query(api.modelHosts.executionStatus, { ...args, now: Date.now() })).toMatchObject({ safeToRetry: false });
    await f.heartbeat();
    const refused = await f.begin(await f.thread(), "refused-output");
    await f.t.mutation(api.modelHosts.decline, { ...f.hostAuth, executionId: refused.executionId, reason: "configuration" });
    await f.t.run(async ctx => { const run = await ctx.db.get(refused.runId); await ctx.db.insert("agentThreadMessages", { teamId: f.teamId, threadId: run!.threadId!, runId: refused.runId, clientId: "unexpected-output", role: "bot", kind: "activity", text: "Already did work", seq: 2, updSeq: 2, status: "final", createdAt: Date.now(), updatedAt: Date.now() }); });
    expect(await f.t.query(api.modelHosts.executionStatus, { sessionToken: f.sender.token, executionId: refused.executionId, now: Date.now() })).toMatchObject({ safeToRetry: false });
    const expired = await f.begin(await f.thread(), "expired-pending"), createdAt = Date.now();
    vi.setSystemTime(createdAt + 60_001);
    expect(await f.t.query(api.modelHosts.executionStatus, { sessionToken: f.sender.token, executionId: expired.executionId, now: createdAt + 10_001 })).toMatchObject({ safeToRetry: false });
  });

  test("reconciles the same offered execution after its work finished and the next message started", async () => {
    const f = await fixture(), threadId = await f.thread();
    const begun = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.sender.token, threadId, clientId: "lost-offer-response", text: "Execute this request once" });
    const request = { sessionToken: f.sender.token, runId: begun.runId, sourceId: f.sourceId, model: "synthetic-model", requestKey: "lost-offer", safeInitialRefusal: true, quiesced: true } as const;
    const executionId = await f.t.mutation(api.modelHosts.offerExisting, request);
    const args = { ...f.hostAuth, executionId, claimId, leaseToken };
    await f.t.mutation(api.modelHosts.claim, args); await f.t.mutation(api.modelHosts.started, leaseArgs(args));
    await f.t.mutation(api.modelHosts.appendReply, { ...leaseArgs(args), clientId: "single-result", kind: "text", text: "Already finished once", status: "final" });
    await f.t.mutation(api.modelHosts.finish, { ...leaseArgs(args), outcome: "succeeded" });
    const next = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.sender.token, threadId, clientId: "next-request", text: "A separate request" });
    expect(await f.t.mutation(api.modelHosts.offerExisting, request)).toBe(executionId);
    expect(await f.t.run(async ctx => ({ executions: await ctx.db.query("modelHostExecutions").withIndex("by_runId", q => q.eq("runId", begun.runId)).take(17), thread: await ctx.db.get(threadId) })))
      .toMatchObject({ executions: [{ _id: executionId, status: "succeeded" }], thread: { activeRunId: next.runId } });
    await expect(f.t.mutation(api.modelHosts.offerExisting, { ...request, requestKey: "different-key" })).rejects.toThrow();
    await expect(f.t.mutation(api.modelHosts.offerExisting, { ...request, model: "different-model" })).rejects.toThrow();
    await expect(f.t.mutation(api.modelHosts.offerExisting, { ...request, sessionToken: f.owner.token })).rejects.toThrow(/Run not found/);
  });

  test("exposes the queried attempt identity for unknown advance reconciliation without widening thread access", async () => {
    const f = await fixture(), begun = await f.begin(await f.thread());
    const statusArgs = { sessionToken: f.sender.token, executionId: begun.executionId };
    expect(await f.t.query(api.modelHosts.executionStatus, statusArgs)).toMatchObject({ sourceId: f.sourceId, model: "synthetic-model", requestKey: "send:synthetic", currentExecutionId: begun.executionId });
    await f.t.mutation(api.modelHosts.decline, { ...f.hostAuth, executionId: begun.executionId, reason: "configuration" });
    const secondSource = await f.t.mutation(api.modelHosts.setSource, { ...f.sourceInput, sourceKey: "20000000-0000-4000-8000-000000000002", label: "Second source" });
    await f.t.mutation(api.modelHosts.heartbeat, { ...f.hostAuth, online: true, sources: [f.sourceId, secondSource].map(sourceId => ({ sourceId, available: true, models: ["synthetic-model"] })) });
    const advanced = await f.t.mutation(api.modelHosts.advance, { sessionToken: f.sender.token, runId: begun.runId, previousExecutionId: begun.executionId, requestKey: "lost-advance-response", target: { sourceId: secondSource, model: "synthetic-model" } });
    expect(await f.t.query(api.modelHosts.executionStatus, statusArgs)).toMatchObject({ sourceId: f.sourceId, requestKey: "send:synthetic", currentExecutionId: advanced.executionId });
    expect(await f.t.query(api.modelHosts.executionStatus, { ...statusArgs, executionId: advanced.executionId! })).toMatchObject({ sourceId: secondSource, model: "synthetic-model", requestKey: "lost-advance-response", currentExecutionId: advanced.executionId });
    await expect(f.t.query(api.modelHosts.executionStatus, { ...statusArgs, sessionToken: f.outsider.token })).rejects.toThrow(/Thread not found/);
    await expect(f.t.query(api.modelHosts.executionStatus, { ...statusArgs, sessionToken: f.hostAuth.hostToken })).rejects.toThrow();
  });

  test("is idempotent for one canonical user message and one claim, and preserves sender identity", async () => {
    const f = await fixture(), threadId = await f.thread(), begun = await f.begin(threadId);
    expect(await f.begin(threadId)).toEqual(begun);
    const pending = await f.t.query(api.modelHosts.pending, { ...f.hostAuth, now: Date.now() });
    expect(pending).toEqual([expect.objectContaining({ executionId: begun.executionId, requesterUserId: f.sender.id, requestClientId: "send:synthetic", text: "Canonical full synthetic request", definitionVersion: 1, definitionHash: expect.any(String) })]);
    const args = { ...f.hostAuth, executionId: begun.executionId, claimId, leaseToken };
    expect(await f.t.mutation(api.modelHosts.claim, args)).toEqual(await f.t.mutation(api.modelHosts.claim, args));
    await expect(f.t.mutation(api.modelHosts.claim, { ...args, claimId: "30000000-0000-4000-8000-000000000002", leaseToken: "b".repeat(64) })).rejects.toThrow(/already accepted/);
    await f.t.mutation(api.modelHosts.started, leaseArgs(args));
    await f.t.mutation(api.modelHosts.appendReply, { ...leaseArgs(args), clientId: "reply:one", kind: "text", text: "Synthetic owner execution", status: "final" });
    await f.t.mutation(api.modelHosts.finish, { ...leaseArgs(args), outcome: "succeeded" });
    const transcript = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.sender.token, threadId, afterSeq: 0 });
    expect(transcript.messages.filter(message => message.role === "user")).toHaveLength(1);
    expect(transcript.messages.find(message => message.role === "bot")).toMatchObject({ text: "Synthetic owner execution", runByUserId: f.sender.id, executedByUserId: f.owner.id, executedByName: "Owner", hostId: f.hostAuth.hostId, sourceId: f.sourceId });
  });

  test("atomically admits only one execution into the last host/account capacity slot", async () => {
    const f = await fixture(), first = await f.begin(await f.thread(), "first"), second = await f.begin(await f.thread(), "second");
    const results = await Promise.allSettled([first, second].map((run, index) => f.t.mutation(api.modelHosts.claim, { ...f.hostAuth, executionId: run.executionId, claimId: `30000000-0000-4000-8000-00000000000${index + 1}`, leaseToken: String(index + 1).repeat(64) })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });

  test("blocks legacy sender heartbeat/replies/finish while an executor owns the run", async () => {
    const f = await fixture(), begun = await f.begin(await f.thread());
    await expect(f.t.mutation(api.agentRuns.heartbeat, { sessionToken: f.sender.token, runId: begun.runId })).rejects.toThrow(/executor lease/);
    await expect(f.t.mutation(api.agentRuns.finish, { sessionToken: f.sender.token, runId: begun.runId, status: "succeeded" })).rejects.toThrow(/executor lease/);
    const run = await f.t.run(ctx => ctx.db.get(begun.runId));
    await expect(f.t.mutation(api.agentRuns.appendMessage, { sessionToken: f.sender.token, threadId: run!.threadId!, runId: begun.runId, clientId: "forged", role: "bot", kind: "text", text: "not executor" })).rejects.toThrow();
  });

  test("rechecks revocation and both memberships on every executor mutation", async () => {
    const f = await fixture(), begun = await f.begin(await f.thread()), args = { ...f.hostAuth, executionId: begun.executionId, claimId, leaseToken };
    await f.t.mutation(api.modelHosts.claim, args);
    await f.t.run(async ctx => { const member = await ctx.db.query("members").withIndex("by_project_email", q => q.eq("projectId", f.projectId).eq("email", f.sender.email)).unique(); await ctx.db.delete(member!._id); });
    await expect(f.t.mutation(api.modelHosts.heartbeatExecution, leaseArgs(args))).rejects.toThrow(/Both people/);
    await expect(f.t.mutation(api.modelHosts.appendReply, { ...leaseArgs(args), clientId: "late", kind: "text", text: "must not leak", status: "final" })).rejects.toThrow();
    await f.t.mutation(api.modelHosts.revoke, { sessionToken: f.owner.token, hostId: f.hostAuth.hostId });
    await expect(f.t.mutation(api.modelHosts.heartbeat, { ...f.hostAuth, online: true, sources: [] })).rejects.toThrow(/authentication/);
  });

  test("never replays an expired accepted attempt or treats observed work as safe quota fallback", async () => {
    vi.useFakeTimers(); const f = await fixture(), begun = await f.begin(await f.thread()), args = { ...f.hostAuth, executionId: begun.executionId, claimId, leaseToken };
    await f.t.mutation(api.modelHosts.claim, args); await f.t.mutation(api.modelHosts.started, leaseArgs(args)); await f.t.mutation(api.modelHosts.activity, leaseArgs(args));
    const result = await f.t.mutation(api.modelHosts.finish, { ...leaseArgs(args), outcome: "quota_exhausted", safeInitialRefusal: true, quiesced: true });
    expect(result.safeToRetry).toBe(false);
    await expect(f.t.mutation(api.modelHosts.advance, { sessionToken: f.sender.token, runId: begun.runId, previousExecutionId: begun.executionId, requestKey: "next", target: { kind: "sender", provider: "claudeAgent", model: "other" } })).rejects.toThrow();
    const another = await f.begin(await f.thread(), "uncertain"), next = { ...f.hostAuth, executionId: another.executionId, claimId, leaseToken };
    await f.t.mutation(api.modelHosts.claim, next); vi.setSystemTime(Date.now() + 60_001);
    await expect(f.t.mutation(api.modelHosts.claim, next)).rejects.toThrow();
    await expect(f.t.mutation(api.modelHosts.advance, { sessionToken: f.sender.token, runId: another.runId, previousExecutionId: another.executionId, requestKey: "unknown-next", target: { kind: "sender", provider: "claudeAgent", model: "other" } })).rejects.toThrow();
  });

  test("transfers only a quiesced initial refusal and returns the same message safely to sender routing", async () => {
    const f = await fixture(), threadId = await f.thread();
    const begun = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.sender.token, threadId, clientId: "initial-local", text: "One logical request" });
    const executionId = await f.t.mutation(api.modelHosts.offerExisting, { sessionToken: f.sender.token, runId: begun.runId, sourceId: f.sourceId, model: "synthetic-model", requestKey: "offer-one", safeInitialRefusal: true, quiesced: true });
    const args = { ...f.hostAuth, executionId, claimId, leaseToken };
    await f.t.mutation(api.modelHosts.claim, args); await f.t.mutation(api.modelHosts.started, leaseArgs(args));
    expect(await f.t.mutation(api.modelHosts.finish, { ...leaseArgs(args), outcome: "quota_exhausted", safeInitialRefusal: true, quiesced: true })).toEqual({ safeToRetry: true });
    expect(await f.t.mutation(api.modelHosts.advance, { sessionToken: f.sender.token, runId: begun.runId, previousExecutionId: executionId, requestKey: "return-sender", target: { kind: "sender", provider: "grok", model: "synthetic-other" } })).toEqual({ executionId: null, route: "sender" });
    expect(await f.t.mutation(api.agentRuns.begin, { sessionToken: f.sender.token, threadId, clientId: "initial-local", text: "One logical request" })).toEqual(begun);
    await expect(f.t.mutation(api.agentRuns.heartbeat, { sessionToken: f.sender.token, runId: begun.runId })).resolves.toEqual({ status: "running" });
    await expect(f.t.mutation(api.modelHosts.heartbeatExecution, leaseArgs(args))).rejects.toThrow();
    const messages = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.sender.token, threadId, afterSeq: 0 }); expect(messages.messages).toHaveLength(1);
  });

  test("refuses sender transfer once any tool/output row was already mirrored", async () => {
    const f = await fixture(), threadId = await f.thread();
    const begun = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.sender.token, threadId, clientId: "already-worked", text: "Synthetic request" });
    await f.t.mutation(api.agentRuns.appendMessage, { sessionToken: f.sender.token, threadId, runId: begun.runId, clientId: "actual-tool", role: "bot", kind: "activity", tool: { name: "synthetic action", ok: true } });
    await expect(f.t.mutation(api.modelHosts.offerExisting, { sessionToken: f.sender.token, runId: begun.runId, sourceId: f.sourceId, model: "synthetic-model", requestKey: "must-not-repeat", safeInitialRefusal: true, quiesced: true })).rejects.toThrow(/already produced output/);
  });

  test("can advance a safely declined remote source once without duplicating the message or cycling", async () => {
    const f = await fixture(), threadId = await f.thread(), begun = await f.begin(threadId);
    const secondSource = await f.t.mutation(api.modelHosts.setSource, { ...f.sourceInput, sourceKey: "20000000-0000-4000-8000-000000000002", label: "Second subscription" });
    await f.t.mutation(api.modelHosts.heartbeat, { ...f.hostAuth, online: true, sources: [f.sourceId, secondSource].map(sourceId => ({ sourceId, available: true, models: ["synthetic-model"] })) });
    await f.t.mutation(api.modelHosts.decline, { ...f.hostAuth, executionId: begun.executionId, reason: "configuration" });
    const route = { sessionToken: f.sender.token, runId: begun.runId, previousExecutionId: begun.executionId, requestKey: "next-remote", target: { sourceId: secondSource, model: "synthetic-model" } };
    const advanced = await f.t.mutation(api.modelHosts.advance, route); expect(advanced.route).toBe("host"); expect(await f.t.mutation(api.modelHosts.advance, route)).toEqual(advanced);
    await expect(f.t.mutation(api.modelHosts.claim, { ...f.hostAuth, executionId: begun.executionId, claimId, leaseToken })).rejects.toThrow();
    await f.t.mutation(api.modelHosts.decline, { ...f.hostAuth, executionId: advanced.executionId!, reason: "configuration" });
    await expect(f.t.mutation(api.modelHosts.advance, { sessionToken: f.sender.token, runId: begun.runId, previousExecutionId: advanced.executionId!, requestKey: "cycle", target: { sourceId: f.sourceId, model: "synthetic-model" } })).rejects.toThrow(/already attempted/);
    const messages = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.sender.token, threadId, afterSeq: 0 }); expect(messages.messages).toHaveLength(1);
  });

  test("allows an unclaimed offline target to be skipped, and cancellation fences its former executor", async () => {
    const f = await fixture(), begun = await f.begin(await f.thread()); await f.heartbeat(false);
    expect(await f.t.mutation(api.modelHosts.advance, { sessionToken: f.sender.token, runId: begun.runId, previousExecutionId: begun.executionId, requestKey: "skip-offline", target: { kind: "sender", provider: "grok", model: "synthetic-local" } })).toEqual({ executionId: null, route: "sender" });
    await f.heartbeat(); const next = await f.begin(await f.thread(), "cancel-me"), args = { ...f.hostAuth, executionId: next.executionId, claimId, leaseToken };
    await f.t.mutation(api.modelHosts.claim, args); await f.t.mutation(api.agentRuns.cancel, { sessionToken: f.sender.token, runId: next.runId });
    await expect(f.t.mutation(api.modelHosts.heartbeatExecution, leaseArgs(args))).rejects.toThrow(/conversation lease/);
  });

  test("fenced context includes only earlier canonical rows and strips interactive card payloads", async () => {
    const f = await fixture(), threadId = await f.thread();
    const previous = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.sender.token, threadId, clientId: "previous", text: "Earlier canonical context" });
    await f.t.mutation(api.agentRuns.appendMessage, { sessionToken: f.sender.token, threadId, runId: previous.runId, clientId: "previous-card", role: "bot", kind: "options", text: "Earlier approval placeholder", payload: JSON.stringify({ privateLocalCard: "must not cross executor context" }) });
    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.sender.token, runId: previous.runId, status: "succeeded" });
    const current = await f.begin(threadId, "current-context");
    await f.t.mutation(api.agentRuns.appendMessage, { sessionToken: f.sender.token, threadId, clientId: "future-message", role: "user", kind: "text", text: "Future queued content" });
    const args = { ...f.hostAuth, executionId: current.executionId, claimId, leaseToken }; await f.t.mutation(api.modelHosts.claim, args);
    const first = await f.t.mutation(api.modelHosts.context, { ...leaseArgs(args), afterSeq: 0, limit: 1 });
    expect(first.messages).toEqual([expect.objectContaining({ text: "Earlier canonical context", authorUserId: f.sender.id, authorName: "Sender" })]); expect(first.more).toBe(true);
    const rest = await f.t.mutation(api.modelHosts.context, { ...leaseArgs(args), afterSeq: first.nextSeq, limit: 50 });
    expect(rest.messages).toEqual([expect.objectContaining({ text: "Earlier approval placeholder", runBy: "Sender" })]);
    expect(JSON.stringify([first, rest])).not.toContain("privateLocalCard"); expect(JSON.stringify([first, rest])).not.toContain("Future queued content");
    expect(rest.messages.every(message => message.seq < rest.requestSeq)).toBe(true); expect(rest.more).toBe(false);
    await expect(f.t.mutation(api.modelHosts.context, { ...leaseArgs(args), leaseToken: "b".repeat(64), afterSeq: 0 })).rejects.toThrow(/authentication/);
  });
});
