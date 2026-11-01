import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("expire project presence", { minutes: 5 }, internal.projectPresence.cleanup, {});
crons.interval("expire storage upload intents", { minutes: 5 }, internal.storage.expireUploads, {});
crons.interval("sync GitHub issues and task PRs", { minutes: 2 }, internal.integrations.kick, {});
// The signed integration tick reconciles bounded pages of draft/open/closed PRs too.
crons.interval("expire GitHub deliveries", { hours: 24 }, internal.taskPRs.cleanup, {});
crons.interval("backfill PR repository index", { minutes: 2 }, internal.taskPRs.backfillRepositories, {});
crons.interval("resume interrupted workspace deletions", { minutes: 15 }, internal.workspaceDeletion.resume, {});
crons.daily("expire deleted-workspace notices", { hourUTC: 3, minuteUTC: 30 }, internal.workspaceDeletion.expireNotices, {});
export default crons;
