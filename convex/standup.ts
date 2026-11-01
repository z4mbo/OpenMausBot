// UPGRADE STUB - remove in the release after the web app has replaced the desktop backend in production.
// The desktop-only module this replaces was removed, but production may still hold scheduled jobs (or an in-flight
// cron run) for these functions when the web backend is deployed. These no-ops keep the same names, arguments and
// return types as production (desktop-archive), so pending jobs finish quietly instead of failing with
// "function not found". They read and write nothing.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Was the daily 07:00 UTC standup cron; it scheduled runProject per project and itself for the next page. No-op stub. */
export const runAll = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), now: v.optional(v.number()) },
  returns: v.null(),
  handler: async () => null,
});

/** Scheduled by runAll for each active project. No-op stub. */
export const runProject = internalMutation({
  args: { projectId: v.id("projects"), now: v.number() },
  returns: v.null(),
  handler: async () => null,
});
