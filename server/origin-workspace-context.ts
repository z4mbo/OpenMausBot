import { isRoutineProblemRun, type RoutineRunStatus } from "../shared/routines.ts";
import { STANDALONE_SECTION, isWorkspaceSection } from "../shared/origin-workspaces.ts";
import { UNTITLED_THREAD, sectionKey } from "./store.ts";

/** What the person's own computer knows about a workspace, beyond its Origin projects. */
export interface WorkspaceActivity {
  routines: readonly { name: string; botId: string; groupId?: string; enabled: boolean; nextRunAt: number | null }[];
  runs: readonly { routineName: string; botId: string; status: RoutineRunStatus; scheduledFor: number; seenAt?: number }[];
  calls: readonly { name: string; botIds: readonly string[]; nextRunAt: number | null; durationMinutes: number }[];
}

export interface WorkspaceBot {
  id: string;
  name: string;
  section?: string;
  hidden?: boolean;
  chiefOfStaff?: boolean;
  managedSections?: readonly string[];
  installedPackage?: unknown;
  tasks?: readonly { title: string; updatedAt?: number; createdAt?: number; routineRunId?: string; archivedAt?: number }[];
}

const ROUTINES_SHOWN = 8;
const CALLS_SHOWN = 5;
const PROBLEMS_SHOWN = 3;
const THREADS_SHOWN = 6;
const CALENDAR_DAYS = 7;
const DAY_MS = 86_400_000;

const oneLine = (value: string, max: number) => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const quoted = (value: string, max: number) => JSON.stringify(oneLine(value, max));
const when = (at: number) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const isHead = (bot: WorkspaceBot) => Boolean(bot.chiefOfStaff && isWorkspaceSection(bot.section));

/** The head whose workspace a bot belongs to: its own, the one managing its team, or for standalone agents the open one. */
export function workspaceHeadOf<T extends WorkspaceBot>(bots: readonly T[], botId: string, openHeadId?: string | null): T | undefined {
  const bot = bots.find((candidate) => candidate.id === botId);
  if (!bot || bot.hidden) return undefined;
  const heads = bots.filter((candidate) => isHead(candidate) && !candidate.hidden).reverse();
  if (isHead(bot)) return bot;
  const team = sectionKey(bot.section);
  if (!team) return undefined;
  const managing = heads.find((head) => head.managedSections?.some((section) => sectionKey(section) === team));
  if (managing) return managing;
  if (team !== sectionKey(STANDALONE_SECTION)) return undefined;
  return heads.find((head) => head.id === openHeadId) ?? heads[0];
}

/** A bot outside the workspace's projects: a standalone agent or a member of a team added from a template. */
export function isWorkspaceAgent(bots: readonly WorkspaceBot[], bot: WorkspaceBot): boolean {
  const team = sectionKey(bot.section);
  if (!team || bot.chiefOfStaff && isWorkspaceSection(bot.section)) return false;
  return team === sectionKey(STANDALONE_SECTION) || bots.some((other) => sectionKey(other.section) === team && Boolean(other.installedPackage));
}

/** Bots a head's workspace spans: itself, its projects' teams and the standalone agents. */
export function workspaceMembers<T extends WorkspaceBot>(bots: readonly T[], head: WorkspaceBot): T[] {
  const teams = new Set([head.section, ...(head.managedSections ?? []), STANDALONE_SECTION].map((section) => sectionKey(section)).filter(Boolean));
  return bots.filter((bot) => !bot.hidden && teams.has(sectionKey(bot.section)));
}

/** Routines, upcoming calls and recent conversations of one workspace, as lines for a turn's context. */
export function workspaceActivityLines(members: readonly WorkspaceBot[], activity: WorkspaceActivity, now: number): string[] {
  const names = new Map(members.map((bot) => [bot.id, bot.name]));
  const own = (botId: string) => names.has(botId);
  const routines = activity.routines.filter((routine) => own(routine.botId))
    .sort((a, b) => (a.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (b.nextRunAt ?? Number.MAX_SAFE_INTEGER));
  const routineLine = routines.length
    ? `- Routines (${routines.length}): ${routines.slice(0, ROUTINES_SHOWN).map((routine) =>
      `${quoted(routine.name, 60)} by ${names.get(routine.botId)}${!routine.enabled ? " (paused)" : routine.nextRunAt ? ` next ${when(routine.nextRunAt)}` : " (no next run)"}`).join("; ")}${routines.length > ROUTINES_SHOWN ? "; …" : ""}`
    : "- Routines: none";
  const problems = activity.runs.filter((run) => own(run.botId) && !run.seenAt && isRoutineProblemRun(run))
    .sort((a, b) => b.scheduledFor - a.scheduledFor);
  const problemLine = problems.length
    ? `- Routine runs that need the person: ${problems.slice(0, PROBLEMS_SHOWN).map((run) => `${quoted(run.routineName, 60)} ${run.status} (${when(run.scheduledFor)})`).join("; ")}`
    : "";
  const horizon = now + CALENDAR_DAYS * DAY_MS;
  const calls = activity.calls.filter((call) => call.nextRunAt !== null && call.nextRunAt >= now && call.nextRunAt <= horizon && call.botIds.some(own))
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0));
  const callLine = calls.length
    ? `- Calendar, next ${CALENDAR_DAYS} days: ${calls.slice(0, CALLS_SHOWN).map((call) =>
      `${quoted(call.name, 60)} ${when(call.nextRunAt!)}, ${call.durationMinutes} min with ${call.botIds.map((id) => names.get(id)).filter(Boolean).join(", ")}`).join("; ")}`
    : `- Calendar, next ${CALENDAR_DAYS} days: nothing scheduled`;
  const threads = members.flatMap((bot) => (bot.tasks ?? [])
    .filter((task) => !task.routineRunId && !task.archivedAt && task.title !== UNTITLED_THREAD)
    .map((task) => ({ bot: bot.name, title: task.title, at: task.updatedAt ?? task.createdAt ?? 0 })))
    .sort((a, b) => b.at - a.at).slice(0, THREADS_SHOWN);
  const threadLine = threads.length
    ? `- Recent conversations: ${threads.map((thread) => `${oneLine(thread.bot, 40)} ${quoted(thread.title, 70)} (${when(thread.at)})`).join("; ")}`
    : "";
  return [routineLine, problemLine, callLine, threadLine].filter(Boolean);
}
