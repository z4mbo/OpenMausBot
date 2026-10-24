import { definitionHash, definitionOf, needsReview, roleKeyFor, type SharedDefinition } from "../../shared/origin-shared-agents";
import { DEFAULT_MASCOT_BODY } from "../../shared/mascot-bodies";
import { isWorkspaceSection } from "../../shared/origin-workspaces";
import type { CloudLinks } from "./origin-import";

export interface LocalBot {
  id: string;
  name: string;
  title?: string;
  description?: string;
  soul?: string;
  color?: string;
  mascotExpression?: string | null;
  mascotBody?: string | null;
  section?: string;
  chiefOfStaff?: boolean;
  hidden?: boolean;
  modelSelection?: { instanceId: string; model: string; effort?: string };
  shared?: { canEdit: boolean };
}

export interface CloudAgent {
  _id: string;
  teamId: string;
  projectId?: string;
  kind: "head" | "chief" | "agent";
  roleKey?: string;
  name: string;
  title: string;
  description: string;
  soul: string;
  soulVersion: number;
  color: string;
  mascotExpression?: string;
  mascotBody?: string;
  look?: SharedDefinition["look"];
  modelIntent?: { provider: string; model: string; effort?: string };
  updatedBy?: string;
  canEdit: boolean;
}

export interface BotMeta { agentId: string; teamId: string; version: number; hash: string; boundAt: number }

type Call = <T>(path: string, init?: { method?: string; body?: string }) => Promise<T>;

export interface SharedSyncDeps {
  cloud: {
    query<T>(name: string, args: Record<string, unknown>): Promise<T>;
    mutation<T>(name: string, args: Record<string, unknown>): Promise<T>;
  };
  call: Call;
  bots: readonly LocalBot[];
  links: CloudLinks;
  looks: Readonly<Record<string, SharedDefinition["look"]>>;
  /** The engine kind behind a bot's model, so other members can pick the same provider. */
  driverKindOf(instanceId: string): string | undefined;
}

export interface SharedSyncResult {
  published: number; adopted: number; created: number; pulled: number; pushed: number; reviews: number; unbound: number;
  /** Teams whose step failed this round; the others still synced. */
  failures: { teamId: string; projectId?: string; error: string }[];
}

const cloudDefinition = (agent: CloudAgent): SharedDefinition => definitionOf({
  name: agent.name, title: agent.title, description: agent.description, soul: agent.soul, color: agent.color,
  mascotExpression: agent.mascotExpression, mascotBody: agent.mascotBody,
}, agent.look);

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Role keys unique within one published team: a repeated title gets a numbered suffix. */
export function roleKeys(team: readonly LocalBot[], head = false): Map<string, string> {
  const used = new Set<string>();
  const keys = new Map<string, string>();
  for (const bot of team) {
    const base = roleKeyFor(bot, head);
    let key = base;
    for (let index = 2; used.has(key); index += 1) key = `${base}-${index}`.slice(0, 64);
    used.add(key);
    keys.set(bot.id, key);
  }
  return keys;
}

/** Pairs unbound local bots with unclaimed cloud agents of the same team: the same role first, then the same name. */
export function adoptionPairs(local: readonly LocalBot[], cloud: readonly CloudAgent[], keys: ReadonlyMap<string, string>): Array<[LocalBot, CloudAgent]> {
  const free = [...cloud];
  const pairs: Array<[LocalBot, CloudAgent]> = [];
  const take = (match: (agent: CloudAgent) => boolean) => {
    const index = free.findIndex(match);
    return index === -1 ? undefined : free.splice(index, 1)[0];
  };
  const waiting: LocalBot[] = [];
  for (const bot of local) {
    const agent = take((candidate) => candidate.roleKey !== undefined && candidate.roleKey === keys.get(bot.id));
    if (agent) pairs.push([bot, agent]);
    else waiting.push(bot);
  }
  for (const bot of waiting) {
    const agent = take((candidate) => sameName(candidate.name, bot.name));
    if (agent) pairs.push([bot, agent]);
  }
  return pairs;
}

export type Reconcile =
  | { action: "none" }
  | { action: "pull"; review: boolean }
  | { action: "push" };

/** Three-way: the cloud version and local hash recorded at the last sync are the base. */
export function reconcile(meta: Pick<BotMeta, "version" | "hash">, local: SharedDefinition, agent: CloudAgent, me: string): Reconcile {
  const localChanged = definitionHash(local) !== meta.hash;
  if (agent.soulVersion > meta.version) {
    return { action: "pull", review: agent.updatedBy !== undefined && agent.updatedBy !== me && needsReview(local, cloudDefinition(agent)) };
  }
  if (localChanged && agent.canEdit) return { action: "push" };
  return { action: "none" };
}

function teamsOf(bots: readonly LocalBot[], links: CloudLinks, projectTeam: ReadonlyMap<string, string>) {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const groups: Array<{ teamId: string; projectId?: string; local: LocalBot[]; section?: string }> = [];
  for (const [headId, teamId] of Object.entries(links.workspaces)) {
    const head = byId.get(headId);
    if (head) groups.push({ teamId, local: [head] });
  }
  for (const [chiefId, projectId] of Object.entries(links.projects)) {
    const chief = byId.get(chiefId);
    const teamId = projectTeam.get(projectId);
    if (!chief || !teamId || isWorkspaceSection(chief.section)) continue;
    const section = chief.section?.trim();
    const members = bots.filter((bot) => bot.id !== chief.id && !bot.hidden && !bot.chiefOfStaff && section && bot.section?.trim() === section);
    groups.push({ teamId, projectId, local: [chief, ...members], ...(section ? { section } : {}) });
  }
  return groups;
}

const intentOf = (bot: LocalBot, driverKindOf: SharedSyncDeps["driverKindOf"]) => {
  const provider = bot.modelSelection?.instanceId ? driverKindOf(bot.modelSelection.instanceId) : undefined;
  return provider && bot.modelSelection?.model
    ? { provider, model: bot.modelSelection.model, ...(bot.modelSelection.effort ? { effort: bot.modelSelection.effort } : {}) }
    : undefined;
};

/** One sync round for workspaces that share their agents: publish a project's team once, adopt the published copies,
 * create the missing ones, then pull or push definition changes. Never deletes a cloud agent. With `teams`, links to
 * other teams are left alone. */
export async function syncSharedAgents(deps: SharedSyncDeps, projects: readonly { _id: string; teamId: string }[], teams?: readonly string[]): Promise<SharedSyncResult> {
  const { cloud, call } = deps;
  const looks = { ...deps.looks };
  const result: SharedSyncResult = { published: 0, adopted: 0, created: 0, pulled: 0, pushed: 0, reviews: 0, unbound: 0, failures: [] };
  const projectTeam = new Map(projects.map((project) => [project._id, project.teamId]));
  const groups = teamsOf(deps.bots, deps.links, projectTeam).filter((group) => !teams || teams.includes(group.teamId));
  let state = (await call<{ bots: Record<string, BotMeta> }>("/api/origin/shared-agents")).bots;
  const bound = new Map(Object.entries(deps.links.agents ?? {}));
  const byId = new Map(deps.bots.map((bot) => [bot.id, bot]));
  let snapshotted = false;

  const bind = async (bot: LocalBot, agent: CloudAgent, hash: string, adoptModel = false) => {
    await call("/api/origin/shared-agents/bind", {
      method: "PUT",
      body: JSON.stringify({ botId: bot.id, agentId: agent._id, teamId: agent.teamId, canEdit: agent.canEdit, version: agent.soulVersion, hash, intent: agent.modelIntent, adoptModel }),
    });
    bound.set(bot.id, agent._id);
  };
  /** Returns the local definition as it stands after the write, so the recorded base hash matches what this machine holds. */
  /** The local bot stays; only its link to the cloud agent goes. */
  const unbind = async (bot: LocalBot) => {
    await call("/api/origin/shared-agents/bind", { method: "PUT", body: JSON.stringify({ botId: bot.id, agentId: null }) });
    bound.delete(bot.id);
    result.unbound += 1;
  };
  const apply = async (bot: LocalBot, definition: SharedDefinition, withSoul: boolean): Promise<SharedDefinition> => {
    const patch = {
      name: definition.name, title: definition.title, description: definition.description, color: definition.color,
      ...(withSoul ? { soul: definition.soul } : {}),
      mascotExpression: definition.mascotExpression ?? null,
      mascotBody: definition.mascotBody ?? DEFAULT_MASCOT_BODY,
    };
    const patched = await call<{ bot?: LocalBot }>(`/api/bots/${encodeURIComponent(bot.id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    const look = definition.look ?? {};
    const current = looks[bot.id] ?? {};
    if (JSON.stringify(look) !== JSON.stringify(current)) {
      await call(`/api/bots/${encodeURIComponent(bot.id)}/avatar-look`, {
        method: "PUT", body: JSON.stringify({ look: look.look ?? "mascot", color: look.color ?? null, face: look.face ?? null }),
      });
    }
    const applied = { ...bot, ...patch, ...patched?.bot };
    byId.set(bot.id, applied);
    looks[bot.id] = definition.look;
    return definitionOf(applied, definition.look);
  };

  const settings = new Map<string, { sharedAgents: boolean; userId: string }>();
  const agentsByTeam = new Map<string, CloudAgent[]>();
  const names = new Map<string, string>();
  const syncGroup = async (group: (typeof groups)[number]) => {
    if (!settings.has(group.teamId)) {
      settings.set(group.teamId, await cloud.query("agents:teamSettings", { teamId: group.teamId }));
    }
    const setting = settings.get(group.teamId)!;
    if (!setting.sharedAgents) {
      for (const bot of group.local) if (bound.has(bot.id)) await unbind(bot);
      return;
    }
    if (!agentsByTeam.has(group.teamId)) {
      agentsByTeam.set(group.teamId, await cloud.query<CloudAgent[]>("agents:listForTeam", { teamId: group.teamId }));
      for (const member of await cloud.query<{ userId?: string; name: string }[]>("workspaces:members", { teamId: group.teamId }).catch(() => [])) {
        if (member.userId) names.set(member.userId, member.name);
      }
    }
    const live = new Set(agentsByTeam.get(group.teamId)!.map((agent) => agent._id));
    for (const bot of group.local) if (bound.has(bot.id) && !live.has(bound.get(bot.id)!)) await unbind(bot);
    const head = !group.projectId;
    let cloudGroup = agentsByTeam.get(group.teamId)!.filter((agent) => (head ? agent.kind === "head" : agent.projectId === group.projectId));
    const keys = roleKeys(group.local, head);
    if (!cloudGroup.length) {
      const published = await cloud.mutation<{ roleKey: string; agentId: string; created: boolean }[]>("agents:publishProjectTeam", {
        teamId: group.teamId, ...(group.projectId ? { projectId: group.projectId } : {}),
        agents: group.local.map((bot) => {
          const definition = definitionOf(bot, looks[bot.id]);
          const intent = intentOf(bot, deps.driverKindOf);
          return {
            roleKey: keys.get(bot.id)!, kind: head ? "head" : bot.chiefOfStaff ? "chief" : "agent",
            name: definition.name, title: definition.title, description: definition.description, soul: definition.soul, color: definition.color,
            ...(definition.mascotExpression ? { mascotExpression: definition.mascotExpression } : {}),
            ...(definition.mascotBody ? { mascotBody: definition.mascotBody } : {}),
            ...(definition.look ? { look: definition.look } : {}), ...(intent ? { modelIntent: intent } : {}),
          };
        }),
      });
      result.published += published.filter((row) => row.created).length;
      cloudGroup = await cloud.query<CloudAgent[]>("agents:listForTeam", { teamId: group.teamId })
        .then((rows) => { agentsByTeam.set(group.teamId, rows); return rows.filter((agent) => (head ? agent.kind === "head" : agent.projectId === group.projectId)); });
      for (const row of published) {
        const bot = group.local.find((candidate) => keys.get(candidate.id) === row.roleKey);
        const agent = cloudGroup.find((candidate) => candidate._id === row.agentId);
        if (bot && agent && !bound.has(bot.id)) await bind(bot, agent, definitionHash(definitionOf(bot, looks[bot.id])));
      }
      state = (await call<{ bots: Record<string, BotMeta> }>("/api/origin/shared-agents")).bots;
      return;
    }
    const claimed = new Set(bound.values());
    const unboundLocal = group.local.filter((bot) => !bound.has(bot.id));
    const freeCloud = cloudGroup.filter((agent) => !claimed.has(agent._id));
    if (unboundLocal.length && !snapshotted) {
      await call("/api/origin/shared-agents/snapshot", { method: "POST", body: "{}" });
      snapshotted = true;
    }
    for (const [bot, agent] of adoptionPairs(unboundLocal, freeCloud, keys)) {
      await bind(bot, agent, definitionHash(await apply(bot, cloudDefinition(agent), true)));
      claimed.add(agent._id);
      result.adopted += 1;
    }
    for (const agent of freeCloud.filter((candidate) => !claimed.has(candidate._id) && candidate.kind === "agent")) {
      const definition = cloudDefinition(agent);
      const { bot } = await call<{ bot: LocalBot }>("/api/bots", {
        method: "POST",
        body: JSON.stringify({ name: definition.name, title: definition.title, description: definition.description, soul: definition.soul, ...(group.section ? { section: group.section } : {}) }),
      });
      await bind(bot, agent, definitionHash(await apply(bot, definition, false)), true);
      claimed.add(agent._id);
      result.created += 1;
    }
    state = (await call<{ bots: Record<string, BotMeta> }>("/api/origin/shared-agents")).bots;
    for (const agent of cloudGroup) {
      const botId = [...bound].find(([, agentId]) => agentId === agent._id)?.[0];
      const bot = botId ? byId.get(botId) : undefined;
      const meta = botId ? state[botId] : undefined;
      if (!bot || !meta) continue;
      const local = definitionOf(bot, looks[bot.id]);
      const step = reconcile(meta, local, agent, setting.userId);
      if (step.action === "pull") {
        const definition = cloudDefinition(agent);
        const applied = await apply(bot, definition, !step.review);
        if (step.review) {
          await call("/api/origin/shared-agents/review", {
            method: "PUT", body: JSON.stringify({ botId: bot.id, version: agent.soulVersion, by: names.get(agent.updatedBy ?? "") ?? "Someone", soul: definition.soul }),
          });
          result.reviews += 1;
        } else {
          await call("/api/origin/shared-agents/meta", { method: "PUT", body: JSON.stringify({ botId: bot.id, version: agent.soulVersion, hash: definitionHash(applied), canEdit: agent.canEdit, intent: agent.modelIntent }) });
          result.pulled += 1;
        }
      } else if (step.action === "push") {
        const pushed = await cloud.mutation<{ soulVersion: number }>("agents:update", {
          agentId: agent._id, baseVersion: meta.version,
          patch: {
            name: local.name, title: local.title, description: local.description, soul: local.soul, color: local.color,
            mascotExpression: local.mascotExpression ?? "", mascotBody: local.mascotBody ?? DEFAULT_MASCOT_BODY,
            look: local.look ?? { look: "mascot" },
          },
        }).catch(() => null);
        if (pushed) {
          await call("/api/origin/shared-agents/meta", { method: "PUT", body: JSON.stringify({ botId: bot.id, version: pushed.soulVersion, hash: definitionHash(local) }) });
          result.pushed += 1;
        }
      } else if (bot.shared && bot.shared.canEdit !== agent.canEdit) {
        await call("/api/origin/shared-agents/meta", { method: "PUT", body: JSON.stringify({ botId: bot.id, canEdit: agent.canEdit }) });
      }
    }
  };
  for (const group of groups) {
    try {
      await syncGroup(group);
    } catch (error) {
      result.failures.push({ teamId: group.teamId, ...(group.projectId ? { projectId: group.projectId } : {}), error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** Publishes one private bot of a linked project team so every member gets it. */
export async function shareBotToWorkspace(deps: Pick<SharedSyncDeps, "cloud" | "call" | "looks" | "driverKindOf">, bot: LocalBot, target: { teamId: string; projectId: string }, team: readonly LocalBot[]) {
  const keys = roleKeys(team);
  const definition = definitionOf(bot, deps.looks[bot.id]);
  const intent = intentOf(bot, deps.driverKindOf);
  const [row] = await deps.cloud.mutation<{ roleKey: string; agentId: string }[]>("agents:publishProjectTeam", {
    teamId: target.teamId, projectId: target.projectId,
    agents: [{
      roleKey: keys.get(bot.id) ?? roleKeyFor(bot), kind: bot.chiefOfStaff ? "chief" : "agent", name: definition.name, title: definition.title,
      description: definition.description, soul: definition.soul, color: definition.color, ...(definition.look ? { look: definition.look } : {}),
      ...(intent ? { modelIntent: intent } : {}),
    }],
  });
  const agent = await deps.cloud.query<CloudAgent>("agents:get", { agentId: row.agentId });
  await deps.call("/api/origin/shared-agents/bind", {
    method: "PUT",
    body: JSON.stringify({ botId: bot.id, agentId: agent._id, teamId: agent.teamId, canEdit: agent.canEdit, version: agent.soulVersion, hash: definitionHash(definition), intent: agent.modelIntent }),
  });
  return agent;
}

/** The live round the Origin sync runs after its own: real Origin calls, the local API and the current avatar looks. */
export async function sharedAgentsRound(input: {
  call: Call;
  cloud?: SharedSyncDeps["cloud"];
  bots: readonly LocalBot[];
  instances: readonly { instanceId: string; driverKind: string }[];
  projects: readonly { _id: string; teamId: string }[];
  /** The signed-in account's workspaces; links to any other team are skipped. */
  teams?: readonly string[];
}): Promise<SharedSyncResult> {
  const { cloudMutation, cloudQueryOnce } = await import("./origin-cloud/client");
  const links = await input.call<CloudLinks>("/api/origin/cloud-links");
  const { looks } = await input.call<{ looks: Record<string, SharedDefinition["look"]> }>("/api/origin/avatar-looks");
  return syncSharedAgents({
    cloud: input.cloud ?? { query: (name, args) => cloudQueryOnce(name, args), mutation: (name, args) => cloudMutation(name, args) },
    call: input.call, bots: input.bots, links, looks,
    driverKindOf: (instanceId) => input.instances.find((instance) => instance.instanceId === instanceId)?.driverKind,
  }, input.projects, input.teams);
}
