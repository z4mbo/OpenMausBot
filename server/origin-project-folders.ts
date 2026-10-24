import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DATA_DIR } from "./config.ts";
import type { OriginCloudClient, OriginCloudState, OriginProjectFolder } from "./origin-cloud.ts";
import { cloudProjectFor, type OriginProjectBot } from "./origin-project-links.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

/** GET returns the projects root; PUT `{ root: string | null }` (admin scope) sets it, null going back to the default. */
export const ORIGIN_PROJECTS_ROOT_ROUTE = "/api/origin/projects-root";

/** The answer of GET and PUT on ORIGIN_PROJECTS_ROOT_ROUTE. */
export interface ProjectsRootAnswer {
  /** The folder holding one folder per Origin project. */
  root: string;
  /** False while the person has not picked one and the default applies. */
  chosen: boolean;
  suggestions: { label: string; path: string }[];
  /** Origin project id -> its folder on this computer. */
  folders: Record<string, string>;
}

export type ProjectFolderState = OriginProjectFolder["state"];

interface FolderState {
  folders: Record<string, string>;
  /** Bot id -> the working folder this module gave it; a different cwd is the person's choice and is kept. */
  bound: Record<string, string>;
}

const NAME_MAX = 80;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export const defaultFolderStateFile = () => join(DATA_DIR, "origin-project-folders.json");

export function defaultProjectsRoot(home = homedir()): string {
  return join(home, "Documents", "Origin Projects");
}

export function projectsRootSuggestions(home = homedir()): { label: string; path: string }[] {
  return [
    { label: "Documents", path: defaultProjectsRoot(home) },
    { label: "Desktop", path: join(home, "Desktop", "Origin Projects") },
  ];
}

/** A folder name every OS accepts, from an Origin project name. */
export function projectFolderName(name: string): string {
  const cleaned = [...name.normalize("NFC")]
    .map((char) => (char < " " || '<>:"/\\|?*'.includes(char) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, NAME_MAX)
    .trim();
  if (!cleaned || /^\.+$/.test(cleaned)) return "Project";
  return WINDOWS_RESERVED.test(cleaned) ? `${cleaned} project` : cleaned;
}

export function validProjectsRoot(input: unknown): { ok: true; root: string | null } | { ok: false; error: string } {
  if (input === null || input === "") return { ok: true, root: null };
  if (typeof input !== "string" || input.length > 500) return { ok: false, error: "root must be a folder path" };
  const trimmed = input.trim();
  const expanded = trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\") ? homedir() + trimmed.slice(1) : trimmed;
  if (!isAbsolute(expanded)) return { ok: false, error: "root must be an absolute path" };
  return { ok: true, root: resolve(expanded) };
}

export function readFolderState(file: string): FolderState {
  try {
    if (!existsSync(file)) return { folders: {}, bound: {} };
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<FolderState>;
    const strings = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
    return { folders: strings(raw.folders), bound: strings(raw.bound) };
  } catch {
    return { folders: {}, bound: {} };
  }
}

function writeFolderState(file: string, state: FolderState): void {
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync(partial, JSON.stringify(state, null, 2));
  renameSync(partial, file);
}

/** What is in a project folder, without running git: a checkout's branch comes from .git/HEAD. */
export function projectFolderState(path: string): ProjectFolderState {
  let entries: string[];
  try {
    if (!statSync(path).isDirectory()) return { kind: "missing" };
    entries = readdirSync(path);
  } catch {
    return { kind: "missing" };
  }
  if (!entries.length) return { kind: "empty" };
  if (!entries.includes(".git")) return { kind: "files" };
  try {
    const head = readFileSync(join(path, ".git", "HEAD"), "utf8").trim();
    return { kind: "checkout", branch: /^ref: refs\/heads\/(.+)$/.exec(head)?.[1] ?? null };
  } catch {
    return { kind: "checkout", branch: null };
  }
}

export interface FolderReconcileInput {
  root: string;
  projects: readonly { projectId: string; name: string }[];
  bots: readonly OriginProjectBot[];
  links: Record<string, string>;
  /** The working folder each bot has now. */
  cwdOf(botId: string): string | undefined;
  setCwd(botId: string, cwd: string): void;
  stateFile: string;
}

/** Gives each linked project a folder under the root and makes it the working folder of the project's bots that have none of their own. */
export function reconcileProjectFolders(input: FolderReconcileInput): Record<string, string> {
  const before = readFolderState(input.stateFile);
  const state: FolderState = { folders: {}, bound: { ...before.bound } };
  const taken = new Set<string>();
  for (const { projectId } of input.projects) {
    const kept = before.folders[projectId];
    if (kept && dirname(kept) === input.root) {
      state.folders[projectId] = kept;
      taken.add(kept.toLowerCase());
    }
  }
  for (const { projectId, name } of input.projects) {
    if (state.folders[projectId]) continue;
    const base = projectFolderName(name);
    let path = join(input.root, base);
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = join(input.root, `${base} ${n}`);
    state.folders[projectId] = path;
    taken.add(path.toLowerCase());
  }
  for (const path of Object.values(state.folders)) mkdirSync(path, { recursive: true });
  for (const bot of input.bots) {
    if (bot.hidden) continue;
    const projectId = cloudProjectFor(input.bots, input.links, bot.id);
    const folder = projectId ? state.folders[projectId] : undefined;
    if (!folder) continue;
    const cwd = input.cwdOf(bot.id);
    if (cwd !== folder && (!cwd || cwd === before.bound[bot.id])) input.setCwd(bot.id, folder);
    if (!cwd || cwd === folder || cwd === before.bound[bot.id]) state.bound[bot.id] = folder;
    else delete state.bound[bot.id];
  }
  for (const botId of Object.keys(state.bound)) if (!input.bots.some((bot) => bot.id === botId)) delete state.bound[botId];
  if (JSON.stringify(state) !== JSON.stringify(before)) writeFolderState(input.stateFile, state);
  return state.folders;
}

export interface ProjectFoldersDeps {
  bots(): readonly OriginProjectBot[];
  cloud(): OriginCloudState;
  connect(url: string): OriginCloudClient;
  /** The root the person picked, if any. */
  chosenRoot(): string | undefined;
  saveRoot(root: string | null): void;
  cwdOf(botId: string): string | undefined;
  setCwd(botId: string, cwd: string): void;
  stateFile?: string;
  home?: string;
  /** False where bots do not run on the person's own computer. */
  enabled?: boolean;
}

export function createProjectFolders(deps: ProjectFoldersDeps) {
  const stateFile = () => deps.stateFile ?? defaultFolderStateFile();
  const root = () => deps.chosenRoot() ?? defaultProjectsRoot(deps.home);
  const names = new Map<string, string>();
  let running: Promise<Record<string, string>> | null = null;

  const projectNames = async (): Promise<{ projectId: string; name: string }[]> => {
    const { url, sessionToken, projects } = deps.cloud();
    const ids = [...new Set(Object.values(projects))];
    if (url && sessionToken) {
      const client = deps.connect(url);
      await Promise.all(ids.map(async (projectId) => {
        const doc = await client.query("projects:get", { projectId, sessionToken }).catch(() => null) as { name?: unknown } | null;
        if (typeof doc?.name === "string" && doc.name.trim()) names.set(projectId, doc.name);
      }));
    }
    return ids.flatMap((projectId) => {
      const name = names.get(projectId) ?? readFolderState(stateFile()).folders[projectId]?.split(/[\\/]/).pop();
      return name ? [{ projectId, name }] : [];
    });
  };

  const reconcile = (): Promise<Record<string, string>> => {
    if (deps.enabled === false) return Promise.resolve({});
    running ??= projectNames().then((projects) => reconcileProjectFolders({
      root: root(), projects, bots: deps.bots(), links: deps.cloud().projects, cwdOf: deps.cwdOf, setCwd: deps.setCwd, stateFile: stateFile(),
    })).finally(() => { running = null; });
    return running;
  };

  const folderOf = (projectId: string): OriginProjectFolder | null => {
    if (deps.enabled === false) return null;
    const path = readFolderState(stateFile()).folders[projectId];
    return path ? { path, state: projectFolderState(path) } : null;
  };

  const answer = (): ProjectsRootAnswer => ({
    root: root(), chosen: Boolean(deps.chosenRoot()), suggestions: projectsRootSuggestions(deps.home), folders: readFolderState(stateFile()).folders,
  });

  const routes: RouteHandler = async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== ORIGIN_PROJECTS_ROOT_ROUTE) return PASS;
    if (method === "GET") return json(res, 200, answer());
    if (method !== "PUT") return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Choosing the projects folder needs the admin scope" });
    if (deps.enabled === false) return json(res, 409, { error: "Project folders live on the person's own computer" });
    const body = await readBody(req).catch(() => null) as { root?: unknown } | null;
    const checked = validProjectsRoot(body?.root ?? null);
    if (!checked.ok) return json(res, 400, { error: checked.error });
    const next = checked.root ?? defaultProjectsRoot(deps.home);
    try {
      mkdirSync(next, { recursive: true });
      if (!statSync(next).isDirectory()) return json(res, 400, { error: `that path is not a folder: ${next}` });
    } catch (error) {
      return json(res, 400, { error: `Could not create ${next}: ${error instanceof Error ? error.message : String(error)}` });
    }
    deps.saveRoot(checked.root);
    await running?.catch(() => undefined);
    await reconcile().catch((error: unknown) => console.warn("origin project folders:", error instanceof Error ? error.message : error));
    return json(res, 200, answer());
  };

  return { reconcile, folderOf, routes, root };
}
