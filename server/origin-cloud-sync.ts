import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isWorkspaceSection } from "../shared/origin-workspaces.ts";
import { DATA_DIR } from "./config.ts";
import { defaultOriginCloudFile, readOriginCloud, writeOriginCloud } from "./origin-cloud.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { BotRecord, Store } from "./store.ts";

/** Which local bots stand for which Origin cloud records. Keys are local bot ids, values are cloud ids. */
export interface CloudLinks {
  /** Workspace head bot id -> cloud workspace (team) id. */
  workspaces: Record<string, string>;
  /** Project Chief bot id -> cloud project id. */
  projects: Record<string, string>;
}

type LinkBot = Pick<BotRecord, "id" | "section" | "chiefOfStaff">;

export const CLOUD_ID = /^[a-z0-9]{1,64}$/;

export const defaultCloudLinksFile = () => join(DATA_DIR, "origin-cloud-links.json");

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function readWorkspaceLinks(file: string): Record<string, string> {
  try {
    return existsSync(file) ? stringMap((JSON.parse(readFileSync(file, "utf8")) as { workspaces?: unknown }).workspaces) : {};
  } catch {
    return {};
  }
}

export function writeWorkspaceLinks(file: string, workspaces: Record<string, string>): void {
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync(partial, JSON.stringify({ workspaces }, null, 2));
  renameSync(partial, file);
}

const isHead = (bot: LinkBot | undefined) => Boolean(bot?.chiefOfStaff && isWorkspaceSection(bot.section));

/** Drops links whose bot is gone, and workspace links whose bot no longer heads a workspace. */
export function liveLinks(bots: readonly LinkBot[], links: CloudLinks): CloudLinks {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  return {
    workspaces: Object.fromEntries(Object.entries(links.workspaces).filter(([id]) => isHead(byId.get(id)))),
    projects: Object.fromEntries(Object.entries(links.projects).filter(([id]) => byId.has(id))),
  };
}

export type LinkPatch = { workspaces?: Record<string, string | null>; projects?: Record<string, string | null> };

/** Applies a patch (null unlinks); a cloud workspace stays linked to one head at most. Returns an error message for a bad patch. */
export function applyLinkPatch(bots: readonly LinkBot[], links: CloudLinks, patch: LinkPatch): CloudLinks | string {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const next: CloudLinks = { workspaces: { ...links.workspaces }, projects: { ...links.projects } };
  for (const kind of ["workspaces", "projects"] as const) {
    const entries = patch[kind];
    if (entries === undefined) continue;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) return `${kind} must be an object`;
    for (const [botId, cloudId] of Object.entries(entries)) {
      const bot = byId.get(botId);
      if (!bot) return `No such bot: ${botId}`;
      if (kind === "workspaces" && !isHead(bot)) return `${botId} is not a workspace head`;
      if (cloudId === null || cloudId === "") {
        delete next[kind][botId];
        continue;
      }
      if (typeof cloudId !== "string" || !CLOUD_ID.test(cloudId)) return `${kind}.${botId} must be an Origin id or null`;
      if (kind === "workspaces") {
        for (const [other, linked] of Object.entries(next.workspaces)) if (linked === cloudId) delete next.workspaces[other];
      }
      next[kind][botId] = cloudId;
    }
  }
  return next;
}

export interface CloudLinkRouteDeps {
  store: Pick<Store, "bots">;
  linksFile?: string;
  cloudFile?: string;
}

/** Workspace links live in their own file; project links share the bots' Origin connection file so their tools see them. */
export function createCloudLinkRoutes(deps: CloudLinkRouteDeps): RouteHandler {
  const linksFile = () => deps.linksFile ?? defaultCloudLinksFile();
  const cloudFile = () => deps.cloudFile ?? defaultOriginCloudFile();
  const persist = (before: CloudLinks, after: CloudLinks) => {
    if (JSON.stringify(before.workspaces) !== JSON.stringify(after.workspaces)) {
      writeWorkspaceLinks(linksFile(), after.workspaces);
    }
    if (JSON.stringify(before.projects) !== JSON.stringify(after.projects)) {
      writeOriginCloud(cloudFile(), { ...readOriginCloud(cloudFile()), projects: after.projects });
    }
  };
  const load = (): CloudLinks => {
    const stored = { workspaces: readWorkspaceLinks(linksFile()), projects: readOriginCloud(cloudFile()).projects };
    const live = liveLinks(deps.store.bots, stored);
    persist(stored, live);
    return live;
  };
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/origin/cloud-links") return PASS;
    if (method === "GET") return json(res, 200, load());
    if (method !== "PUT") return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Linking Origin projects needs the admin scope" });
    const body = await readBody(req).catch(() => null) as LinkPatch | null;
    if (!body || typeof body !== "object") return json(res, 400, { error: "body must be a JSON object" });
    const current = load();
    const next = applyLinkPatch(deps.store.bots, current, body);
    if (typeof next === "string") return json(res, 400, { error: next });
    persist(current, next);
    return json(res, 200, next);
  };
}
