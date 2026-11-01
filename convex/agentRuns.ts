// UPGRADE STUB - remove in the release after the web app has replaced the desktop backend in production.
// The desktop-only module this replaces was removed, but production may still hold scheduled jobs (or an in-flight
// cron run) for these functions when the web backend is deployed. These no-ops keep the same names, arguments and
// return types as production (desktop-archive), so pending jobs finish quietly instead of failing with
// "function not found". They read and write nothing.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Scheduled by agent threads when a run finished. No-op stub. */
export const promoteQueued = internalMutation({
  args: { threadId: v.id("agentThreads"), previousRunId: v.id("workspaceAgentRuns") },
  returns: v.null(),
  handler: async () => null,
});

/** Was the 1-minute "interrupt agent runs whose runner went quiet" cron. No-op stub. */
export const expireStale = internalMutation({
  args: {},
  returns: v.number(),
  handler: async () => 0,
});
