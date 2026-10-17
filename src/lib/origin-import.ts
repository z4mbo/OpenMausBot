import type { CloudProject, CloudWorkspace } from "./origin-cloud/types";

export interface CloudLinks {
  workspaces: Record<string, string>;
  projects: Record<string, string>;
  agents?: Record<string, string>;
  threads?: Record<string, string>;
}

interface LocalBot { id: string; name: string; section?: string; chiefOfStaff?: boolean }

export interface ImportSelection { workspaces: readonly string[]; projects: readonly string[] }

export interface WorkspaceStep {
  cloudTeamId: string;
  name: string;
  /** The linked local head; absent means the import creates one. */
  headId?: string;
  headName?: string;
}

export interface ProjectStep { cloudProjectId: string; cloudTeamId: string; name: string }

export interface ImportPlan {
  workspaces: WorkspaceStep[];
  projects: ProjectStep[];
  /** Chosen projects that already have a local Chief, by cloud project id -> local bot name. */
  alreadyLinked: { cloudProjectId: string; name: string; localName: string }[];
}

export function invertLinks(links: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(links).map(([botId, cloudId]) => [cloudId, botId]));
}

/** What an import of the chosen cloud workspaces and projects would create locally. A chosen project brings its workspace. */
export function planImport(
  cloud: { workspaces: readonly CloudWorkspace[]; projects: readonly CloudProject[] },
  local: { bots: readonly LocalBot[]; links: CloudLinks },
  selection: ImportSelection,
): ImportPlan {
  const botById = new Map(local.bots.map((bot) => [bot.id, bot]));
  const headFor = invertLinks(local.links.workspaces);
  const chiefFor = invertLinks(local.links.projects);
  const chosenProjects = cloud.projects.filter((project) => selection.projects.includes(project._id));
  const teamIds = new Set([...selection.workspaces, ...chosenProjects.map((project) => project.teamId)]);
  const workspaces = cloud.workspaces.filter((workspace) => teamIds.has(workspace._id)).map((workspace): WorkspaceStep => {
    const headId = headFor.get(workspace._id);
    return { cloudTeamId: workspace._id, name: workspace.name, ...(headId ? { headId, headName: botById.get(headId)?.name ?? workspace.name } : {}) };
  });
  const known = new Set(workspaces.map((step) => step.cloudTeamId));
  const plan: ImportPlan = { workspaces, projects: [], alreadyLinked: [] };
  for (const project of chosenProjects) {
    if (!known.has(project.teamId)) continue;
    const chiefId = chiefFor.get(project._id);
    if (chiefId) plan.alreadyLinked.push({ cloudProjectId: project._id, name: project.name, localName: botById.get(chiefId)?.name ?? project.name });
    else plan.projects.push({ cloudProjectId: project._id, cloudTeamId: project.teamId, name: project.name });
  }
  return plan;
}

export const planIsEmpty = (plan: ImportPlan) => !plan.projects.length && plan.workspaces.every((step) => step.headId);

type Call = <T>(path: string, init?: { method?: string; body?: string }) => Promise<T>;

export interface ImportResult {
  createdWorkspaces: { name: string; botId: string }[];
  createdProjects: { name: string; botId: string; agents: number; workspace: string }[];
  failures: { name: string; error: string }[];
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Creates the plan's local workspaces and projects through the local API and links each to its cloud record. Never writes to the cloud. */
export async function runImport(
  plan: ImportPlan,
  deps: { call: Call; lead: { title: string; description: string; soul: string } },
): Promise<ImportResult> {
  const { call, lead } = deps;
  const put = (body: Partial<CloudLinks>) => call("/api/origin/cloud-links", { method: "PUT", body: JSON.stringify(body) });
  const result: ImportResult = { createdWorkspaces: [], createdProjects: [], failures: [] };
  const heads = new Map<string, { id: string; name: string }>();
  for (const step of plan.workspaces) {
    if (step.headId) {
      heads.set(step.cloudTeamId, { id: step.headId, name: step.headName ?? step.name });
      continue;
    }
    try {
      const { bot } = await call<{ bot: { id: string; name: string } }>("/api/workspaces", { method: "POST", body: JSON.stringify({ name: step.name }) });
      await put({ workspaces: { [bot.id]: step.cloudTeamId } });
      heads.set(step.cloudTeamId, { id: bot.id, name: bot.name });
      result.createdWorkspaces.push({ name: bot.name, botId: bot.id });
    } catch (cause) {
      result.failures.push({ name: step.name, error: message(cause) });
    }
  }
  for (const step of plan.projects) {
    const head = heads.get(step.cloudTeamId);
    if (!head) {
      result.failures.push({ name: step.name, error: "its workspace could not be created" });
      continue;
    }
    try {
      const { bot } = await call<{ bot: { id: string; name: string } }>("/api/bots", { method: "POST", body: JSON.stringify({ name: step.name, ...lead }) });
      const team = await call<{ members: unknown[] }>(`/api/bots/${encodeURIComponent(bot.id)}/default-team`, {
        method: "POST", body: JSON.stringify({ workspaceId: head.id }),
      });
      await put({ projects: { [bot.id]: step.cloudProjectId } });
      result.createdProjects.push({ name: bot.name, botId: bot.id, agents: team.members.length, workspace: head.name });
    } catch (cause) {
      result.failures.push({ name: step.name, error: message(cause) });
    }
  }
  return result;
}
