import { STANDALONE_SECTION, WORKSPACE_PREFIX, isWorkspaceSection } from "../shared/origin-workspaces.ts";
import type { WireBot } from "../shared/wire.ts";
import type { ModelSelection } from "./contracts.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { BotRecord, Store } from "./store.ts";

export const DEFAULT_TEAM_ROLES = [
  { name: "Researcher", soul: "You research the project's market, users and competitors, and report findings with sources." },
  { name: "Product Manager", soul: "You turn goals into a prioritized plan: problems, requirements, scope and acceptance criteria." },
  { name: "Designer", soul: "You design the product's flows, screens and visual identity, and explain the reasoning behind them." },
  { name: "Developer", soul: "You build and fix the product's code, test what you change, and report what shipped." },
  { name: "Marketer", soul: "You plan how the product reaches its audience: positioning, channels, launches and metrics." },
  { name: "Copywriter", soul: "You write the product's words: landing pages, emails, posts and in-product copy, in its voice." },
] as const;

const CHIEF_TITLE = "";
const OLD_CHIEF_TITLE = "Chief of Staff";
const WORKSPACE_TITLE = "Workspace";

const sectionOf = (bot: BotRecord) => bot.section?.trim() || "";

export function uniqueTeamName(store: Store, wanted: string): string {
  const base = wanted.trim().slice(0, 60) || "Team";
  const taken = new Set([...store.sections, ...store.bots.map(sectionOf)]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 56)} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Workspace heads, oldest first. */
export function workspaceHeads(store: Store): BotRecord[] {
  return store.bots.filter(bot => bot.chiefOfStaff && isWorkspaceSection(bot.section)).reverse();
}

function makeWorkspaceHead(store: Store, bot: BotRecord): BotRecord {
  store.patchBot(bot.id, { section: uniqueTeamName(store, WORKSPACE_PREFIX + bot.name), title: bot.title || WORKSPACE_TITLE });
  store.setChiefOfStaff(bot.id);
  return store.bot(bot.id)!;
}

/** The head manages the project's team, which is the only way it reaches that project's bots. */
function fileUnderWorkspace(store: Store, head: BotRecord, team: string) {
  for (const other of workspaceHeads(store)) {
    if (other.id !== head.id && other.managedSections?.includes(team)) {
      store.patchBot(other.id, { managedSections: other.managedSections.filter(name => name !== team) });
    }
  }
  const current = store.bot(head.id)?.managedSections ?? [];
  if (!current.includes(team)) store.patchBot(head.id, { managedSections: [...current, team] });
}

/** A new top-level bot becomes the Chief of its own team, staffed with the default roles, inside one workspace. */
export function createDefaultTeam(store: Store, chief: BotRecord, selection: ModelSelection, head?: BotRecord): BotRecord[] {
  const team = uniqueTeamName(store, chief.name);
  store.patchBot(chief.id, { section: team, title: chief.title || CHIEF_TITLE });
  store.setChiefOfStaff(chief.id);
  const owner = head ?? workspaceHeads(store)[0];
  if (owner) fileUnderWorkspace(store, owner, team);
  // The store lists newest first, so the last role created shows at the top of the team.
  return [...DEFAULT_TEAM_ROLES].reverse().map(role => store.createBot({
    name: role.name, title: role.name, soul: role.soul, section: team, modelSelection: selection,
  })).reverse();
}

export function createDefaultTeamRoutes(deps: { store: Store; maxWorkspaceBots: number; wireBot(bot: BotRecord): WireBot }): RouteHandler {
  const { store, maxWorkspaceBots, wireBot } = deps;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = method === "POST" ? /^\/api\/bots\/([^/]+)\/default-team$/.exec(path) : null;
    const newWorkspace = method === "POST" && path === "/api/workspaces";
    if (method === "PUT" && path === "/api/workspaces/active") {
      const body = await readBody(req).catch(() => null) as { id?: unknown } | null;
      activeHeadId = typeof body?.id === "string" && workspaceHeads(store).some(head => head.id === body.id) ? body.id : null;
      return json(res, 200, { active: activeHeadId });
    }
    if (!match && !newWorkspace) return PASS;
    if (auth.kind === "session" && !auth.scopes.includes("admin")) return json(res, 403, { error: "Creating a project or workspace needs the admin scope" });
    const body = await readBody(req).catch(() => null) as { workspaceId?: unknown; name?: unknown } | null;
    if (newWorkspace) {
      if (store.bots.length >= maxWorkspaceBots) return json(res, 409, { error: `this workspace is limited to ${maxWorkspaceBots} bots` });
      const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 40) : "New workspace";
      const head = makeWorkspaceHead(store, store.createBot({ name }));
      ensureWorkspaces(store);
      return json(res, 201, { bot: wireBot(head) });
    }
    const chief = store.bot(decodeURIComponent(match![1]));
    if (!chief) return json(res, 404, { error: "No such bot" });
    if (sectionOf(chief)) return json(res, 409, { error: "This bot already belongs to a team" });
    const head = typeof body?.workspaceId === "string" ? workspaceHeads(store).find(bot => bot.id === body.workspaceId) : undefined;
    if (store.bots.length + DEFAULT_TEAM_ROLES.length > maxWorkspaceBots) {
      return json(res, 409, { error: `this workspace is limited to ${maxWorkspaceBots} bots` });
    }
    const members = createDefaultTeam(store, chief, chief.modelSelection, head);
    return json(res, 201, { chief: wireBot(store.bot(chief.id)!), members: members.map(wireBot) });
  };
}

let activeHeadId: string | null = null;

/** Template teams join the workspace the person has open, so its head can reach and manage them. */
export function watchTemplateTeams(store: Store): () => void {
  return store.onChange(change => {
    if (change.type !== "bot") return;
    const bot = store.bot(change.botId);
    const heads = workspaceHeads(store);
    if (!bot?.installedPackage || !heads.length) return;
    if (!sectionOf(bot) && !bot.hidden) {
      store.patchBot(bot.id, { section: STANDALONE_SECTION });
      return;
    }
    const team = sectionOf(bot);
    if (!team || isWorkspaceSection(team) || team === STANDALONE_SECTION) return;
    if (heads.some(head => head.managedSections?.includes(team))) return;
    const owner = heads.find(head => head.id === activeHeadId) ?? heads[0];
    if (owner) fileUnderWorkspace(store, owner, team);
  });
}

/** Once a workspace exists, bots outside every team join the standalone agents, and every project belongs to exactly one head (the oldest by default). A setup without workspaces keeps its sections as they are. */
export function ensureWorkspaces(store: Store): void {
  const [first] = workspaceHeads(store);
  if (!first) return;
  for (const bot of store.bots) if (bot.chiefOfStaff && bot.title === OLD_CHIEF_TITLE) store.patchBot(bot.id, { title: "" });
  for (const bot of store.bots) if (!sectionOf(bot) && !bot.hidden) store.patchBot(bot.id, { section: STANDALONE_SECTION });
  const projects = new Set(store.bots.filter(bot => bot.chiefOfStaff && sectionOf(bot) && !isWorkspaceSection(bot.section)).map(sectionOf));
  for (const bot of store.bots) if (bot.installedPackage && sectionOf(bot)) projects.add(sectionOf(bot));
  for (const team of projects) {
    if (!workspaceHeads(store).some(head => head.managedSections?.includes(team))) fileUnderWorkspace(store, first, team);
  }
}

/** Once a workspace exists, every named team is led by a Chief bot; a team without one gets a Chief named after it. */
export function ensureTeamChiefs(store: Store, selection: ModelSelection): BotRecord[] {
  store.retireEmptyWorkspaceSections();
  if (!workspaceHeads(store).length) return [];
  const teams = new Set([...store.sections, ...store.bots.map(sectionOf)].filter(team => team && team !== STANDALONE_SECTION));
  const created: BotRecord[] = [];
  for (const team of teams) {
    if (store.bots.some(bot => sectionOf(bot) === team && bot.chiefOfStaff)) continue;
    const chief = store.createBot({ name: team, title: CHIEF_TITLE, section: team, modelSelection: selection });
    store.setChiefOfStaff(chief.id);
    created.push(chief);
  }
  return created;
}

export async function initializeWorkspaceTeams(store: Store, selection: () => Promise<ModelSelection>): Promise<void> {
  try {
    const chiefs = ensureTeamChiefs(store, await selection());
    if (chiefs.length) console.log(`[teams] gave ${chiefs.length} team(s) a Chief of Staff bot`);
    ensureWorkspaces(store);
    watchTemplateTeams(store);
  } catch (error) {
    console.warn(`[teams] could not give every team a Chief: ${(error as Error).message}`);
  }
}
