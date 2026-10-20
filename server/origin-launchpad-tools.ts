import { milestonePercent } from "../shared/origin-milestones.ts";
import { originIssueKey } from "../shared/origin-issues.ts";
import type { OriginCloudClient, OriginToolResult } from "./origin-cloud.ts";

type Args = Record<string, unknown>;

/** The project an agent's Milestone tool works in, resolved by the Origin tools' own project picking. */
export interface LaunchpadToolScope {
  client: OriginCloudClient;
  sessionToken: string;
  projectId: string;
  projectName: string;
  caller: { id: string; name: string };
}

type LaunchpadTool<C> = (args: Args, ctx: C) => Promise<OriginToolResult>;

const record = (value: unknown): Args => (value && typeof value === "object" && !Array.isArray(value) ? value as Args : {});
const list = (value: unknown): Args[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const trimmed = (value: unknown): string => text(value).trim();
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(trimmed).filter(Boolean) : []);
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);
const fail = (message: string): OriginToolResult => ({ text: message, isError: true });

async function milestones(scope: LaunchpadToolScope): Promise<Args[]> {
  return list(record(await scope.client.query("projectMilestones:list", { sessionToken: scope.sessionToken, projectId: scope.projectId })).milestones);
}

async function boardTasks(scope: LaunchpadToolScope): Promise<Args[]> {
  return list(record(await scope.client.query("tasks:board", { sessionToken: scope.sessionToken, projectId: scope.projectId })).tasks);
}

function findMilestone(all: readonly Args[], wanted: string): Args | undefined {
  const key = wanted.toLowerCase();
  return all.find((row) => row._id === wanted) ?? all.find((row) => text(row.title).toLowerCase() === key);
}

/** Issue ids from ids or ORI keys; an unknown one is reported rather than guessed. */
function issueIds(tasks: readonly Args[], wanted: readonly string[]): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const item of wanted) {
    const task = tasks.find((row) => row._id === item) ?? tasks.find((row) => originIssueKey(text(row._id)) === item.toUpperCase());
    if (task) ids.push(text(task._id));
    else unknown.push(item);
  }
  return { ids, unknown };
}

function milestoneLine(row: Args): string {
  const total = Number(row.total) || 0;
  const done = Number(row.done) || 0;
  return `- ${text(row._id)} "${text(row.title)}" [${text(row.status)}]${text(row.targetDate) ? ` target ${text(row.targetDate)}` : ""} · ${done}/${total} issues done (${milestonePercent({ done, total })}%)`;
}

/** The Milestone tools; `scope` picks the project the same way the other Origin tools do. */
export function launchpadTools<C>(scope: (args: Args, ctx: C) => Promise<LaunchpadToolScope>): Record<string, LaunchpadTool<C>> {
  const base = (target: LaunchpadToolScope) => ({ sessionToken: target.sessionToken, projectId: target.projectId });

  return {
    async origin_milestone_list(args, ctx) {
      const target = await scope(args, ctx);
      const [rows, tasks] = await Promise.all([milestones(target), boardTasks(target)]);
      if (!rows.length) return { text: `${target.projectName} has no milestones yet; create them with origin_milestone_set.` };
      const blocks = rows.map((row) => {
        const issues = tasks.filter((task) => task.milestoneId === row._id)
          .map((task) => `  - ${text(task._id)} (${originIssueKey(text(task._id))}) [${task.done ? "done" : "open"}] ${clip(text(task.title), 120)}`);
        return [milestoneLine(row), text(row.description) && `  ${clip(text(row.description), 400)}`, ...issues].filter(Boolean).join("\n");
      });
      const loose = tasks.filter((task) => !task.milestoneId && !task.done).length;
      return { text: `${target.projectName}'s milestones:\n${blocks.join("\n")}${loose ? `\n${loose} open issue(s) are in no milestone.` : ""}` };
    },

    async origin_milestone_set(args, ctx) {
      const target = await scope(args, ctx);
      const wanted = trimmed(args.milestone);
      if (!wanted) return fail("Pass milestone: its id or name, or a new name to create it.");
      if (args.status !== undefined && !["planned", "active", "completed"].includes(text(args.status))) return fail("status must be planned, active or completed.");
      const rows = await milestones(target);
      const found = findMilestone(rows, wanted);
      if (args.delete === true) {
        if (!found) return fail(`No milestone "${clip(wanted, 80)}" in ${target.projectName}.`);
        await target.client.mutation("projectMilestones:remove", { ...base(target), milestoneId: text(found._id) });
        return { text: `Deleted milestone "${text(found.title)}"; its issues stay on the board.` };
      }
      const fields = {
        ...(trimmed(args.name) ? { title: trimmed(args.name) } : !found ? { title: wanted } : {}),
        ...(typeof args.target_date === "string" ? { targetDate: args.target_date.trim() } : {}),
        ...(typeof args.description === "string" ? { description: args.description } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
      };
      const milestoneId = text(await target.client.mutation("projectMilestones:save", { ...base(target), ...(found ? { milestoneId: text(found._id) } : {}), ...fields }));
      const adding = strings(args.issues);
      const removing = strings(args.remove_issues);
      const notes: string[] = [];
      if (adding.length || removing.length) {
        const tasks = await boardTasks(target);
        const add = issueIds(tasks, adding);
        const remove = issueIds(tasks, removing);
        const leaving = remove.ids.filter((id) => tasks.find((task) => task._id === id)?.milestoneId === milestoneId);
        if (add.ids.length) await target.client.mutation("projectMilestones:assign", { ...base(target), milestoneId, taskIds: add.ids });
        if (leaving.length) await target.client.mutation("projectMilestones:assign", { ...base(target), milestoneId: null, taskIds: leaving });
        if (add.ids.length) notes.push(`put ${add.ids.length} issue(s) in it`);
        if (leaving.length) notes.push(`took ${leaving.length} out`);
        const unknown = [...add.unknown, ...remove.unknown];
        if (unknown.length) notes.push(`no issue ${unknown.slice(0, 10).join(", ")} in ${target.projectName}; copy ids from origin_list_issues`);
      }
      const row = (await milestones(target)).find((item) => item._id === milestoneId);
      return { text: `${found ? "Updated" : "Created"} milestone ${row ? milestoneLine(row).slice(2) : milestoneId} in ${target.projectName}${notes.length ? `; ${notes.join("; ")}` : ""}.` };
    },
  };
}
