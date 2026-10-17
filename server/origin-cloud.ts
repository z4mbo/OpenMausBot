import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { DATA_DIR } from "./config.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import { sectionKey, type BotRecord, type Store } from "./store.ts";

export interface OriginCloudState {
  url?: string;
  /** Security: a bearer for the person's Origin account. Never returned by a route or shown to a bot. */
  sessionToken?: string;
  projects: Record<string, string>;
}

type Args = Record<string, unknown>;

export interface OriginCloudClient {
  query(name: string, args: Args): Promise<unknown>;
  mutation(name: string, args: Args): Promise<unknown>;
}

export interface OriginToolResult {
  text: string;
  isError?: boolean;
}

type ProjectBot = Pick<BotRecord, "id" | "section" | "chiefOfStaff" | "managedSections">;

export const defaultOriginCloudFile = () => join(DATA_DIR, "origin-cloud.json");

export function readOriginCloud(file: string): OriginCloudState {
  try {
    if (!existsSync(file)) return { projects: {} };
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<OriginCloudState>;
    const projects = raw.projects && typeof raw.projects === "object" ? Object.fromEntries(
      Object.entries(raw.projects).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ) : {};
    return {
      ...(typeof raw.url === "string" ? { url: raw.url } : {}),
      ...(typeof raw.sessionToken === "string" ? { sessionToken: raw.sessionToken } : {}),
      projects,
    };
  } catch {
    return { projects: {} };
  }
}

export function writeOriginCloud(file: string, state: OriginCloudState): void {
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync(partial, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(partial, file);
}

export function convexOriginClient(url: string): OriginCloudClient {
  const client = new ConvexHttpClient(url, { logger: false });
  return {
    query: (name, args) => client.query(makeFunctionReference<"query">(name), args),
    mutation: (name, args) => client.mutation(makeFunctionReference<"mutation">(name), args),
  };
}

export function cloudProjectFor(bots: readonly ProjectBot[], links: Record<string, string>, botId: string): string | null {
  if (links[botId]) return links[botId];
  const bot = bots.find((candidate) => candidate.id === botId);
  if (!bot) return null;
  const section = sectionKey(bot.section);
  const chiefs = bots.filter((candidate) => candidate.chiefOfStaff && links[candidate.id]);
  const leader = chiefs.find((chief) => sectionKey(chief.section) === section)
    ?? chiefs.find((chief) => chief.managedSections?.some((managed) => sectionKey(managed) === section));
  return leader ? links[leader.id] : null;
}

const record = (value: unknown): Args => (value && typeof value === "object" && !Array.isArray(value) ? value as Args : {});
const list = (value: unknown): Args[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);
const normalizedTitle = (title: string) => title.trim().toLowerCase().replace(/[\s_-]+/g, "");
const isDoneColumn = (column: Args) => typeof column.isDone === "boolean" ? column.isDone : text(column.title).trim().toLowerCase() === "done";
const PRIORITIES = new Set(["low", "medium", "high"]);
const ISSUE_LIST_MAX = 100;
const PR_STATUS_TASKS_MAX = 25;
const DEFAULT_DUE_DAYS = 7;

function issueLine(task: Args, columns: Args[]): string {
  const column = columns.find((candidate) => candidate._id === task.columnId);
  const parts = [
    `${text(task._id)} [${column ? text(column.title) : "?"}${task.done ? ", done" : ""}] ${text(task.title)}`,
    text(task.priority) && `priority ${text(task.priority)}`,
    text(task.assignedToEmail) && `assignee ${text(task.assignedToName) || text(task.assignedToEmail)} <${text(task.assignedToEmail)}>`,
    text(task.dueDate) && `due ${text(task.dueDate)}`,
    Array.isArray(task.labels) && task.labels.length ? `labels ${task.labels.join(", ")}` : "",
  ];
  return `- ${parts.filter(Boolean).join(" · ")}`;
}

function findColumn(columns: Args[], wanted: string): Args | undefined {
  const key = normalizedTitle(wanted);
  return columns.find((column) => column._id === wanted) ?? columns.find((column) => normalizedTitle(text(column.title)) === key);
}

function columnNames(columns: Args[]): string {
  return columns.map((column) => `"${text(column.title)}"`).join(", ");
}

function dueDateAfter(days: number, now = new Date()): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function convexMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const invalid = /ArgumentValidationError[^\n]*\nPath: \.(\w+)\nValue: ([^\n]+)/.exec(message);
  if (invalid) return `${invalid[1]} ${clip(invalid[2], 80)} is not a valid id or value; copy ids exactly from the list tools`;
  const uncaught = /Uncaught Error: ([^\n]+)/.exec(message);
  return clip((uncaught?.[1] ?? message).trim(), 500);
}

interface ToolScope {
  client: OriginCloudClient;
  sessionToken: string;
  projectId: string;
}

async function board(scope: ToolScope) {
  const result = record(await scope.client.query("tasks:board", { projectId: scope.projectId, sessionToken: scope.sessionToken }));
  return { columns: list(result.columns), tasks: list(result.tasks) };
}

function issueId(args: Args): string | null {
  const id = typeof args.issue_id === "string" ? args.issue_id.trim() : "";
  return id || null;
}

async function setLabels(scope: ToolScope, taskId: string, labels: unknown): Promise<void> {
  if (!Array.isArray(labels)) return;
  await scope.client.mutation("issueRelations:labels", { sessionToken: scope.sessionToken, taskId, labels: labels.map(String) });
}

const TOOLS: Record<string, (args: Args, scope: ToolScope) => Promise<OriginToolResult>> = {
  async origin_list_issues(args, scope) {
    const status = args.status === "done" || args.status === "all" ? args.status : "open";
    const { columns, tasks } = await board(scope);
    const shown = tasks.filter((task) => status === "all" || (status === "done") === Boolean(task.done));
    if (!shown.length) return { text: `No ${status === "all" ? "" : `${status} `}issues in this Origin project. Columns: ${columnNames(columns)}.` };
    const lines = shown.slice(0, ISSUE_LIST_MAX).map((task) => issueLine(task, columns));
    const more = shown.length > ISSUE_LIST_MAX ? `\n(${shown.length - ISSUE_LIST_MAX} more not shown.)` : "";
    return { text: `${shown.length} ${status} issue(s). Columns: ${columnNames(columns)}.\n${lines.join("\n")}${more}` };
  },

  async origin_get_issue(args, scope) {
    const taskId = issueId(args);
    if (!taskId) return { text: "origin_get_issue needs issue_id, copied from origin_list_issues.", isError: true };
    const details = record(await scope.client.query("tasks:details", { projectId: scope.projectId, sessionToken: scope.sessionToken, taskId }));
    const [relations, pulls] = await Promise.all([
      scope.client.query("issueRelations:list", { sessionToken: scope.sessionToken, taskId }).catch(() => ({})),
      scope.client.query("taskPRs:list", { sessionToken: scope.sessionToken, taskId }).catch(() => []),
    ]);
    const task: Args = { ...record(details.task), labels: record(relations).labels ?? record(details.task).labels };
    const lines = [issueLine(task, list(details.columns)).slice(2)];
    const description = text(task.description);
    lines.push("", description ? `Description:\n${clip(description, 4_000)}` : "No description.");
    const linkedPulls = list(pulls);
    if (linkedPulls.length) {
      lines.push("", "Pull requests:", ...linkedPulls.map((pr) => `- #${String(pr.number)} ${text(pr.state)} ${text(pr.url)} · checks ${text(pr.checks) || "?"} · review ${text(pr.review) || "?"}`));
    }
    const related = list(record(relations).relations);
    if (related.length) {
      lines.push("", "Related issues:", ...related.map((relation) => `- ${relation.outgoing ? "" : "is "}${text(relation.kind)}${relation.outgoing ? "" : " of"} ${text(relation.taskId)} ${text(relation.title)}${relation.done ? " (done)" : ""}`));
    }
    const comments = list(details.comments).slice(-20);
    lines.push("", comments.length ? "Comments (oldest first):" : "No comments.");
    for (const comment of comments) lines.push(`- ${text(comment.authorName) || text(comment.authorEmail)}: ${clip(text(comment.body), 1_000)}`);
    const assets = list(details.assets);
    if (assets.length) lines.push("", "Attachments:", ...assets.map((asset) => `- ${text(asset.name)} (${text(asset.type)})${text(asset.url) ? ` ${text(asset.url)}` : ""}`));
    return { text: lines.join("\n") };
  },

  async origin_create_issue(args, scope) {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title) return { text: "origin_create_issue needs a title.", isError: true };
    const priority = typeof args.priority === "string" ? args.priority : "medium";
    if (!PRIORITIES.has(priority)) return { text: 'priority must be "low", "medium" or "high".', isError: true };
    const { columns } = await board(scope);
    const open = columns.filter((column) => !isDoneColumn(column));
    const column = typeof args.column === "string" && args.column.trim()
      ? findColumn(columns, args.column)
      : open.find((candidate) => normalizedTitle(text(candidate.title)) === "todo") ?? open[0];
    if (!column) return { text: `No such column. Columns: ${columnNames(columns)}.`, isError: true };
    let assignee = typeof args.assignee === "string" ? args.assignee.trim() : "";
    if (!assignee) assignee = text(record(await scope.client.query("auth:me", { sessionToken: scope.sessionToken })).email);
    const taskId = text(await scope.client.mutation("tasks:createTask", {
      projectId: scope.projectId,
      sessionToken: scope.sessionToken,
      columnId: column._id,
      title,
      ...(typeof args.description === "string" && args.description.trim() ? { description: args.description } : {}),
      priority,
      ...(assignee ? { assignedToEmail: assignee } : {}),
      dueDate: typeof args.due_date === "string" && args.due_date ? args.due_date : dueDateAfter(DEFAULT_DUE_DAYS),
    }));
    await setLabels(scope, taskId, args.labels);
    return { text: `Created issue ${taskId} "${title}" in column "${text(column.title)}".` };
  },

  async origin_update_issue(args, scope) {
    const taskId = issueId(args);
    if (!taskId) return { text: "origin_update_issue needs issue_id, copied from origin_list_issues.", isError: true };
    if (args.priority !== undefined && !PRIORITIES.has(String(args.priority))) return { text: 'priority must be "low", "medium" or "high".', isError: true };
    const changed: string[] = [];
    let done = typeof args.done === "boolean" ? args.done : undefined;
    if (typeof args.column === "string" && args.column.trim()) {
      const { columns, tasks } = await board(scope);
      const column = findColumn(columns, args.column);
      if (!column) return { text: `No such column. Columns: ${columnNames(columns)}.`, isError: true };
      if (!tasks.some((task) => task._id === taskId)) return { text: `No issue ${taskId} in this Origin project.`, isError: true };
      await scope.client.mutation("tasks:moveTask", { projectId: scope.projectId, sessionToken: scope.sessionToken, taskId, columnId: column._id });
      done ??= isDoneColumn(column);
      changed.push(`column "${text(column.title)}"`);
    }
    const fields: Args = {
      ...(typeof args.title === "string" ? { title: args.title } : {}),
      ...(typeof args.description === "string" ? { description: args.description } : {}),
      ...(typeof args.priority === "string" ? { priority: args.priority } : {}),
      ...(typeof args.assignee === "string" && args.assignee.trim() ? { assignedToEmail: args.assignee.trim() } : {}),
      ...(done !== undefined ? { done } : {}),
    };
    if (Object.keys(fields).length) {
      await scope.client.mutation("tasks:updateTask", { projectId: scope.projectId, sessionToken: scope.sessionToken, taskId, ...fields });
      changed.push(...Object.keys(fields).map((key) => key === "assignedToEmail" ? "assignee" : key === "done" ? `done ${String(done)}` : key));
    }
    if (Array.isArray(args.labels)) {
      await setLabels(scope, taskId, args.labels);
      changed.push("labels");
    }
    if (!changed.length) return { text: "origin_update_issue changed nothing: pass at least one of title, description, priority, done, column, assignee or labels.", isError: true };
    return { text: `Updated issue ${taskId}: ${changed.join(", ")}.` };
  },

  async origin_comment_issue(args, scope) {
    const taskId = issueId(args);
    const body = typeof args.text === "string" ? args.text.trim() : "";
    if (!taskId || !body) return { text: "origin_comment_issue needs issue_id and text.", isError: true };
    await scope.client.mutation("tasks:addComment", { projectId: scope.projectId, sessionToken: scope.sessionToken, taskId, body });
    return { text: `Commented on issue ${taskId}.` };
  },

  async origin_list_assets(_args, scope) {
    const result = record(await scope.client.query("design:list", { projectId: scope.projectId, sessionToken: scope.sessionToken }));
    const assets = list(result.assets);
    const tokens = list(result.tokens);
    if (!assets.length && !tokens.length) return { text: "This Origin project has no design assets or tokens." };
    const lines = [
      `Assets (${assets.length}):`,
      ...assets.map((asset) => `- ${text(asset.name)} (${text(asset.type)})${text(asset.fileUrl) || text(asset.url) ? ` ${text(asset.fileUrl) || text(asset.url)}` : ""}${text(asset.notes) ? ` · ${clip(text(asset.notes), 300)}` : ""}`),
      `Design tokens (${tokens.length}):`,
      ...tokens.map((token) => `- ${text(token.type)} ${text(token.name)}: ${text(token.value)}`),
    ];
    return { text: lines.join("\n") };
  },

  async origin_vault_list(_args, scope) {
    const rows = list(await scope.client.query("credentials:list", { projectId: scope.projectId, sessionToken: scope.sessionToken }));
    if (!rows.length) return { text: "This Origin project's vault is empty." };
    const lines = rows.map((row) => {
      const parts = [text(row.title), text(row.kind) || "secret", text(row.username) && `username ${text(row.username)}`, text(row.url)];
      return `- ${parts.filter(Boolean).join(" · ")}`;
    });
    return { text: `Vault entries (metadata only; values are encrypted and not readable here; ask the person to hand you one with request_credential if needed):\n${lines.join("\n")}` };
  },

  async origin_repo_status(_args, scope) {
    const base = { projectId: scope.projectId, sessionToken: scope.sessionToken };
    const [project, pulls, commits, { tasks }] = await Promise.all([
      scope.client.query("projects:get", base).then(record),
      scope.client.query("github:listPullRequests", base).then(list),
      scope.client.query("commits:list", base).then(list),
      board(scope),
    ]);
    const openTasks = tasks.filter((task) => !task.done)
      .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
      .slice(0, PR_STATUS_TASKS_MAX);
    const linked = (await Promise.all(openTasks.map((task) =>
      scope.client.query("taskPRs:list", { sessionToken: scope.sessionToken, taskId: task._id }).then((rows) => list(rows).map((row): Args => ({ ...row, issueId: task._id }))).catch(() => [])))).flat();
    const byUrl = new Map(linked.map((row) => [text(row.url), row]));
    const open = pulls.filter((pr) => pr.state === "open");
    const lines = [`Repository: ${text(project.repoUrl) || "none linked to this Origin project"}`];
    lines.push(open.length ? `Open pull requests (${open.length}):` : "No open pull requests.");
    for (const pr of open) {
      const task = byUrl.get(text(pr.url));
      const status = task ? ` · checks ${text(task.checks) || "?"} · review ${text(task.review) || "?"} · issue ${text(task.issueId)}` : "";
      lines.push(`- #${String(pr.number)} ${text(pr.title)} (${text(pr.branch) || "?"}, by ${text(pr.author) || "?"}) ${text(pr.url)}${status}`);
    }
    for (const row of linked) {
      if (row.state === "draft" && !open.some((pr) => pr.url === row.url)) lines.push(`- draft #${String(row.number)} ${text(row.url)} · checks ${text(row.checks) || "?"} · issue ${text(row.issueId)}`);
    }
    const recent = commits.slice(0, 10);
    lines.push(recent.length ? "Recent commits:" : "No commits recorded.");
    for (const commit of recent) {
      lines.push(`- ${text(commit.sha).slice(0, 7)} ${clip(text(commit.message).split("\n")[0] ?? "", 120)} (${text(commit.author)}, ${new Date(Number(commit.committedAt)).toISOString().slice(0, 10)})`);
    }
    return { text: lines.join("\n") };
  },
};

export const ORIGIN_SERVER_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(TOOLS));

export interface OriginToolDeps {
  bots: readonly ProjectBot[];
  state: OriginCloudState;
  connect(url: string): OriginCloudClient;
}

export async function runOriginTool(name: string, args: Args, botId: string, deps: OriginToolDeps): Promise<OriginToolResult> {
  const tool = TOOLS[name];
  if (!tool) return { text: `Unknown Origin tool: ${name}`, isError: true };
  const { url, sessionToken } = deps.state;
  if (!url || !sessionToken) {
    return { text: "Origin is not connected. Ask the person to sign in to Origin in OpenMausBot first; do not retry until they have.", isError: true };
  }
  const projectId = cloudProjectFor(deps.bots, deps.state.projects, botId);
  if (!projectId) {
    return { text: "This bot has no linked Origin project, and neither does its team's Chief. Ask the person to link this bot or its Chief to an Origin project.", isError: true };
  }
  try {
    return await tool(args, { client: deps.connect(url), sessionToken, projectId });
  } catch (error) {
    const message = convexMessage(error);
    const hint = message === "Login required" ? " The Origin sign-in has expired; ask the person to sign in to Origin again." : "";
    return { text: `Origin refused ${name}: ${message}.${hint}`, isError: true };
  }
}

const PROJECT_ID = /^[a-z0-9]{1,64}$/;
const TOKEN_MAX = 1_024;

function deploymentUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export interface OriginCloudRouteDeps {
  store: Pick<Store, "bot" | "bots">;
  /** The bot an agents-kind internal turn capability in this Authorization header belongs to, or null. */
  agentBotId(authorization: string | string[] | undefined): string | null;
  file?: string;
  connect?: (url: string) => OriginCloudClient;
}

export function createOriginCloudRoutes(deps: OriginCloudRouteDeps): RouteHandler {
  const { store, agentBotId } = deps;
  const file = () => deps.file ?? defaultOriginCloudFile();
  const connect = deps.connect ?? convexOriginClient;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "POST" && path === "/api/internal/origin/tool") {
      const botId = agentBotId(req.headers.authorization);
      if (!botId || !store.bot(botId)) return json(res, 401, { error: "unauthorized" });
      const body = record(await readBody(req));
      const name = text(body.name);
      if (!ORIGIN_SERVER_TOOL_NAMES.has(name)) return json(res, 400, { error: `Unknown Origin tool: ${name}` });
      return json(res, 200, await runOriginTool(name, record(body.arguments), botId, { bots: store.bots, state: readOriginCloud(file()), connect }));
    }
    if (path === "/api/origin/cloud-session" && method === "GET") {
      const { url, sessionToken } = readOriginCloud(file());
      return json(res, 200, { url: url ?? null, connected: Boolean(url && sessionToken) });
    }
    if (path === "/api/origin/cloud-projects" && method === "GET") {
      const { projects } = readOriginCloud(file());
      return json(res, 200, { projects: Object.fromEntries(Object.entries(projects).filter(([id]) => store.bot(id))) });
    }
    const projectRoute = method === "PUT" ? /^\/api\/bots\/([^/]+)\/cloud-project$/.exec(path) : null;
    const sessionRoute = path === "/api/origin/cloud-session" && (method === "PUT" || method === "DELETE");
    if (!projectRoute && !sessionRoute) return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Changing the Origin connection needs the admin scope" });
    const state = readOriginCloud(file());
    if (projectRoute) {
      const id = decodeURIComponent(projectRoute[1]);
      if (!store.bot(id)) return json(res, 404, { error: "No such bot" });
      const cloudProjectId = record(await readBody(req)).cloudProjectId;
      if (cloudProjectId === null || cloudProjectId === "") {
        delete state.projects[id];
      } else if (typeof cloudProjectId === "string" && PROJECT_ID.test(cloudProjectId)) {
        state.projects[id] = cloudProjectId;
      } else {
        return json(res, 400, { error: "cloudProjectId must be an Origin project id or null" });
      }
      writeOriginCloud(file(), state);
      return json(res, 200, { cloudProjectId: state.projects[id] ?? null });
    }
    if (method === "DELETE") {
      writeOriginCloud(file(), { projects: state.projects });
      return json(res, 200, { url: null, connected: false });
    }
    const body = record(await readBody(req));
    const url = deploymentUrl(body.url);
    const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken.trim() : "";
    if (!url) return json(res, 400, { error: "url must be an http(s) Convex deployment address" });
    if (!sessionToken || sessionToken.length > TOKEN_MAX) return json(res, 400, { error: "sessionToken is required" });
    let user: Args;
    try {
      user = record(await connect(url).query("auth:me", { sessionToken }));
    } catch (error) {
      return json(res, 502, { error: `Origin did not answer: ${convexMessage(error)}` });
    }
    if (!text(user.email)) return json(res, 400, { error: "Origin did not accept this session token" });
    writeOriginCloud(file(), { url, sessionToken, projects: state.projects });
    return json(res, 200, { url, connected: true });
  };
}
