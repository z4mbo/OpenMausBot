import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("expire project presence", { minutes: 5 }, internal.projectPresence.cleanup, {});
crons.interval("sync GitHub issues and task PRs", { minutes: 2 }, internal.integrations.kick, {});
// The signed integration tick reconciles bounded pages of draft/open/closed PRs too.
crons.interval("expire GitHub deliveries", { hours: 24 }, internal.taskPRs.cleanup, {});
crons.interval("backfill PR repository index", { minutes: 2 }, internal.taskPRs.backfillRepositories, {});
crons.interval("interrupt agent runs whose runner went quiet", { minutes: 1 }, internal.agentRuns.expireStale, {});
export default crons;
