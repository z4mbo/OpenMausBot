import { z } from "zod";
import type { IncomingMessage } from "node:http";
import { isWorkspaceSection, STANDALONE_SECTION, WORKSPACE_PREFIX } from "../shared/origin-workspaces.ts";
import type { WireBot } from "../shared/wire.ts";
import { parseBotProfilePatch } from "./bot-profile.ts";
import type { ModelSelection } from "./contracts.ts";
import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, writeOriginCloud, type OriginCloudClient } from "./origin-cloud.ts";
import { CLOUD_ID, defaultCloudLinksFile, readWorkspaceLinks, writeWorkspaceLinks } from "./origin-cloud-sync.ts";
import { DEFAULT_TEAM_ROLES, uniqueTeamName } from "./origin-teams.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { BotRecord, Store } from "./store.ts";

const cloudId = z.string().regex(CLOUD_ID);
const workspaceRequest = z.object({ cloudTeamId: cloudId }).strict().transform((input) => ({ ...input, kind: "workspace" as const }));
const projectRequest = z.object({
  cloudProjectId: cloudId, cloudTeamId: cloudId, workspaceId: z.string().min(1).max(128),
  title: z.string(), description: z.string(), soul: z.string(),
}).strict().transform((input) => ({ ...input, kind: "project" as const }));
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isHead = (bot: BotRecord | null | undefined) => bot?.chiefOfStaff && !bot.hidden && isWorkspaceSection(bot.section);

export interface OriginImportRouteDeps {
  store: Store;
  maxWorkspaceBots: number;
  wireBot(bot: BotRecord): WireBot;
  defaultSelection(): Promise<ModelSelection>;
  authorized(req: IncomingMessage, auth: RequestAuth): boolean;
  selectionError?(selection: ModelSelection): string | null;
  cloudFile?: string;
  linksFile?: string;
  connect?(url: string): OriginCloudClient;
  changed?(): void;
}

export function createOriginImportRoutes(deps: OriginImportRouteDeps): RouteHandler {
  const { store, maxWorkspaceBots, wireBot } = deps;
  const cloudFile = () => deps.cloudFile ?? defaultOriginCloudFile();
  const linksFile = () => deps.linksFile ?? defaultCloudLinksFile();
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const kind = path === "/api/origin/import/workspaces" ? "workspace" : path === "/api/origin/import/projects" ? "project" : null;
    if (method !== "POST" || !kind) return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Importing Origin projects needs the admin scope" });
    const body = await readBody(req).catch(() => null);
    const parsed = kind === "workspace" ? workspaceRequest.safeParse(body) : projectRequest.safeParse(body);
    if (!parsed.success) return json(res, 400, { error: "Invalid Origin import request" });
    const authorized = () => deps.authorized(req, auth);
    if (!authorized()) return json(res, 403, { error: "The local admin session is no longer available" });
    const input = parsed.data;
    const project = input.kind === "project" ? input : null;
    const id = project?.cloudProjectId ?? input.cloudTeamId;
    const initial = readOriginCloud(cloudFile());
    if (!initial.url || !initial.sessionToken) return json(res, 409, { error: "Sign in to Origin before importing" });
    const deployment = new URL(initial.url).origin;
    const current = () => {
      const state = readOriginCloud(cloudFile());
      return state.url === initial.url && state.sessionToken === initial.sessionToken;
    };
    let doc: Record<string, unknown>;
    try {
      const client = (deps.connect ?? convexOriginClient)(initial.url);
      if (project) {
        doc = record(await client.query("projects:get", { projectId: id, sessionToken: initial.sessionToken }));
        if (doc._id !== id || doc.teamId !== input.cloudTeamId) return json(res, 403, { error: "This project does not belong to the selected Origin workspace" });
      } else {
        const workspaces = await client.query("workspaces:list", { sessionToken: initial.sessionToken });
        doc = Array.isArray(workspaces) ? record(workspaces.find((workspace) => record(workspace)._id === id)) : {};
        if (doc._id !== id) return json(res, 403, { error: "This Origin workspace is not available to the signed-in account" });
      }
    } catch {
      return json(res, 403, { error: "Origin could not verify access to this import. Check your sign-in and try again." });
    }
    if (!authorized()) return json(res, 403, { error: "The local admin session is no longer available" });
    if (!current()) return json(res, 409, { error: "The Origin account changed during import. Try again." });
    const profile = parseBotProfilePatch({ name: typeof doc.name === "string" ? doc.name.trim() : "", ...(project ? { title: project.title, description: project.description, soul: project.soul } : {}) }, true);
    if (!profile.ok) return json(res, 400, { error: profile.error });
    const findExisting = (): BotRecord | null => {
      const imported = store.bots.find((bot) => bot.originImport?.deployment === deployment && bot.originImport.kind === kind && bot.originImport.cloudId === id);
      if (imported) return imported;
      const links = kind === "workspace" ? readWorkspaceLinks(linksFile()) : readOriginCloud(cloudFile()).projects;
      return store.bots.find((bot) => links[bot.id] === id && (!bot.originImport || bot.originImport.deployment === deployment)) ?? null;
    };
    let bot = findExisting();
    let selection: ModelSelection | undefined;
    if (!bot) {
      selection = await deps.defaultSelection();
      if (!authorized()) return json(res, 403, { error: "The local admin session is no longer available" });
      if (!current()) return json(res, 409, { error: "The Origin account changed during import. Try again." });
      bot = findExisting();
      const selectionError = deps.selectionError?.(selection);
      if (!bot && selectionError) return json(res, 400, { error: selectionError });
    }
    const head = project ? store.bot(project.workspaceId) : null;
    if (project && (!isHead(head) || readWorkspaceLinks(linksFile())[project.workspaceId] !== input.cloudTeamId ||
      (head?.originImport && head.originImport.deployment !== deployment))) {
      return json(res, 409, { error: "Import this Origin workspace before importing its projects" });
    }
    const replayed = Boolean(bot);
    let members: BotRecord[];
    if (bot) {
      if (kind === "workspace" ? !isHead(bot) : !bot.chiefOfStaff || bot.hidden || !bot.section || isWorkspaceSection(bot.section) ||
        !head?.managedSections?.includes(bot.section) || (bot.originImport?.workspaceId && bot.originImport.workspaceId !== head.id)) {
        return json(res, 409, { error: "The imported team has changed locally. Review its workspace and Chief before retrying." });
      }
      members = bot.originImport ? bot.originImport.memberIds.flatMap((memberId) => {
        const member = store.bot(memberId);
        return member && member.section === bot!.section ? [member] : [];
      }).reverse() : store.bots.filter((member) => member.id !== bot!.id && member.section === bot!.section);
    } else {
      const count = project ? DEFAULT_TEAM_ROLES.length + 1 : 1;
      if (store.bots.length + count > maxWorkspaceBots) return json(res, 409, { error: `this workspace is limited to ${maxWorkspaceBots} bots` });
      if (head && (head.managedSections?.length ?? 0) >= 100) return json(res, 409, { error: "A workspace can manage at most 100 project teams" });
      const name = profile.patch.name!;
      const projectTeam = isWorkspaceSection(name) || name === STANDALONE_SECTION ? `Project: ${name}` : name;
      const section = uniqueTeamName(store, project ? projectTeam : WORKSPACE_PREFIX + name.slice(0, 40));
      const created = store.createOriginImport({ deployment, kind, cloudId: id, ...(head ? { workspaceId: head.id } : {}) },
        { ...profile.patch, name: project ? profile.patch.name : profile.patch.name!.slice(0, 40), title: project ? project.title : "Workspace", section, modelSelection: selection },
        project ? DEFAULT_TEAM_ROLES.map((role) => ({ name: role.name, title: role.name, soul: role.soul, section, modelSelection: selection })) : []);
      bot = created.bot;
      members = created.members;
    }
    try {
      if (kind === "workspace") {
        const links = readWorkspaceLinks(linksFile());
        if (links[bot.id] !== id) writeWorkspaceLinks(linksFile(), { ...Object.fromEntries(Object.entries(links).filter(([, cloudTeamId]) => cloudTeamId !== id)), [bot.id]: id });
      } else {
        const state = readOriginCloud(cloudFile());
        if (state.projects[bot.id] !== id) {
          writeOriginCloud(cloudFile(), { ...state, projects: { ...state.projects, [bot.id]: id } });
          deps.changed?.();
        }
      }
    } catch {
      return json(res, 503, { error: "The local team was saved, but its Origin link could not be saved. Retry to reconnect it." });
    }
    return json(res, replayed ? 200 : 201, { bot: wireBot(bot), members: members.map(wireBot), replayed });
  };
}
