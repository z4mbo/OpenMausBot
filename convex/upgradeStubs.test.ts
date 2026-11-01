/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => { vi.useRealTimers(); });

// Production (desktop-archive) may still hold scheduled jobs for these removed functions when the web backend is
// deployed. They must exist with production's arguments, succeed and touch nothing.
test("jobs production may still have scheduled for removed desktop modules run as no-ops", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const projectId = await t.run(async ctx => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { email: "stub@example.test", name: "Stub", passwordHash: "x", salt: "x", iterations: 1, role: "user", status: "active", createdAt: now, updatedAt: now });
    const teamId = await ctx.db.insert("teams", { name: "Stub", ownerUserId: owner, createdAt: now, updatedAt: now });
    return ctx.db.insert("projects", { teamId, name: "Stub", status: "active", accent: "#5e6ad2", ownerEmail: "stub@example.test", createdAt: now, updatedAt: now });
  });
  const jobs: [string, Record<string, unknown>][] = [
    ["agentRuns:promoteQueued", { threadId: "10001agentThreads", previousRunId: "10002workspaceAgentRuns" }],
    ["agentRuns:expireStale", {}],
    ["standup:runAll", { cursor: null }],
    ["standup:runAll", { cursor: "page-2", now: 1 }],
    ["standup:runProject", { projectId, now: 1 }],
    ["realtime:cleanup", {}],
  ];
  const before = await t.run(async ctx => ({ projects: (await ctx.db.query("projects").collect()).length, teams: (await ctx.db.query("teams").collect()).length }));
  await t.run(async ctx => { for (const [name, args] of jobs) await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">(name), args); });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled).toHaveLength(jobs.length);
  expect(scheduled.map(job => job.state.kind)).toEqual(jobs.map(() => "success"));
  expect(await t.run(async ctx => ({ projects: (await ctx.db.query("projects").collect()).length, teams: (await ctx.db.query("teams").collect()).length }))).toEqual(before);
  expect(await t.mutation(makeFunctionReference<"mutation">("agentRuns:expireStale"), {})).toBe(0);
});
