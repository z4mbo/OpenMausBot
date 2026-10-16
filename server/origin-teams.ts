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

const CHIEF_TITLE = "Chief of Staff";

const sectionOf = (bot: BotRecord) => bot.section?.trim() || "";

function uniqueTeamName(store: Store, wanted: string): string {
  const base = wanted.trim().slice(0, 60) || "Team";
  const taken = new Set([...store.sections, ...store.bots.map(sectionOf)]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 56)} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A new top-level bot becomes the Chief of its own team, staffed with the default roles. */
export function createDefaultTeam(store: Store, chief: BotRecord, selection: ModelSelection): BotRecord[] {
  const team = uniqueTeamName(store, chief.name);
  store.patchBot(chief.id, { section: team, title: chief.title || CHIEF_TITLE });
  store.setChiefOfStaff(chief.id);
  // The store lists newest first, so the last role created shows at the top of the team.
  return [...DEFAULT_TEAM_ROLES].reverse().map(role => store.createBot({
    name: role.name, title: role.name, soul: role.soul, section: team, modelSelection: selection,
  })).reverse();
}

export function createDefaultTeamRoutes(deps: { store: Store; maxWorkspaceBots: number; wireBot(bot: BotRecord): WireBot }): RouteHandler {
  const { store, maxWorkspaceBots, wireBot } = deps;
  return async ({ res, path, method, auth, json }) => {
    const match = method === "POST" ? /^\/api\/bots\/([^/]+)\/default-team$/.exec(path) : null;
    if (!match) return PASS;
    if (auth.kind === "session" && !auth.scopes.includes("admin")) return json(res, 403, { error: "Creating a team needs the admin scope" });
    const chief = store.bot(decodeURIComponent(match[1]));
    if (!chief) return json(res, 404, { error: "No such bot" });
    if (sectionOf(chief)) return json(res, 409, { error: "This bot already belongs to a team" });
    if (store.bots.length + DEFAULT_TEAM_ROLES.length > maxWorkspaceBots) {
      return json(res, 409, { error: `this workspace is limited to ${maxWorkspaceBots} bots` });
    }
    const members = createDefaultTeam(store, chief, chief.modelSelection);
    return json(res, 201, { chief: wireBot(store.bot(chief.id)!), members: members.map(wireBot) });
  };
}

/** Every named team is led by a Chief bot; a team without one gets a Chief named after it. */
export function ensureTeamChiefs(store: Store, selection: ModelSelection): BotRecord[] {
  const teams = new Set([...store.sections, ...store.bots.map(sectionOf)].filter(Boolean));
  const created: BotRecord[] = [];
  for (const team of teams) {
    if (store.bots.some(bot => sectionOf(bot) === team && bot.chiefOfStaff)) continue;
    const chief = store.createBot({ name: team, title: CHIEF_TITLE, section: team, modelSelection: selection });
    store.setChiefOfStaff(chief.id);
    created.push(chief);
  }
  return created;
}
