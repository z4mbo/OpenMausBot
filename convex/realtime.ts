// UPGRADE STUB - remove in the release after the web app has replaced the desktop backend in production.
// The desktop-only module this replaces was removed, but production may still hold scheduled jobs (or an in-flight
// cron run) for these functions when the web backend is deployed. These no-ops keep the same names, arguments and
// return types as production (desktop-archive), so pending jobs finish quietly instead of failing with
// "function not found". They read and write nothing.
import { internalMutation } from "./_generated/server";

/** Was the 5-minute "expire team call presence and signals" cron (calls now live in the Next server). No-op stub. */
export const cleanup = internalMutation({
  args: {},
  handler: async () => {},
});
