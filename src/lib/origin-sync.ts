import { isWorkspaceSection, WORKSPACE_PREFIX } from "../../shared/origin-workspaces";
import { invertLinks, planImport, runImport, type CloudLinks, type ImportResult } from "./origin-import";
import type { CloudProject, CloudWorkspace } from "./origin-cloud/types";

interface LocalBot { id: string; name: string; section?: string; chiefOfStaff?: boolean; managedSections?: string[] }

const sameName = (a: string | undefined, b: string) => a?.trim().toLowerCase() === b.trim().toLowerCase();

/** Links local workspaces and projects that already carry an Origin workspace or project's name, so syncing adopts them instead of duplicating them. */
export function adoptByName(
  cloud: { workspaces: readonly CloudWorkspace[]; projects: readonly CloudProject[] },
  bots: readonly LocalBot[],
  links: CloudLinks,
): Partial<CloudLinks> {
  const adopted: CloudLinks = { workspaces: {}, projects: {} };
  const linkedHeads = new Set(Object.keys(links.workspaces));
  const linkedTeams = invertLinks(links.workspaces);
  const heads = bots.filter((bot) => bot.chiefOfStaff && isWorkspaceSection(bot.section) && !linkedHeads.has(bot.id));
  const headFor = new Map(linkedTeams);
  for (const workspace of cloud.workspaces) {
    if (headFor.has(workspace._id)) continue;
    const head = heads.find((bot) => sameName(bot.section?.slice(WORKSPACE_PREFIX.length), workspace.name) || sameName(bot.name, workspace.name));
    if (!head) continue;
    adopted.workspaces[head.id] = workspace._id;
    headFor.set(workspace._id, head.id);
    heads.splice(heads.indexOf(head), 1);
  }
  const linkedChiefs = new Set(Object.keys(links.projects));
  const linkedProjects = new Set(Object.values(links.projects));
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  for (const project of cloud.projects) {
    if (linkedProjects.has(project._id)) continue;
    const head = byId.get(headFor.get(project.teamId) ?? "");
    if (!head) continue;
    const chief = bots.find((bot) => bot.chiefOfStaff && !linkedChiefs.has(bot.id) && !isWorkspaceSection(bot.section)
      && head.managedSections?.some((section) => section.trim() === bot.section?.trim()) && sameName(bot.name, project.name));
    if (!chief) continue;
    adopted.projects[chief.id] = project._id;
    linkedChiefs.add(chief.id);
  }
  return {
    ...(Object.keys(adopted.workspaces).length ? { workspaces: adopted.workspaces } : {}),
    ...(Object.keys(adopted.projects).length ? { projects: adopted.projects } : {}),
  };
}

type Call = <T>(path: string, init?: { method?: string; body?: string }) => Promise<T>;

/** Brings every Origin workspace and project the signed-in person can see into the app, adopting same-named local ones. Never writes to Origin. */
export async function syncFromOrigin(deps: {
  cloud: { workspaces: readonly CloudWorkspace[]; projects: readonly CloudProject[] };
  bots: readonly LocalBot[];
  links: CloudLinks;
  call: Call;
  lead: { title: string; description: string; soul: string };
}): Promise<{ links: CloudLinks; result: ImportResult }> {
  const { cloud, bots, call, lead } = deps;
  let links = deps.links;
  const adopted = adoptByName(cloud, bots, links);
  if (adopted.workspaces || adopted.projects) {
    links = await call<CloudLinks>("/api/origin/cloud-links", { method: "PUT", body: JSON.stringify(adopted) });
  }
  const plan = planImport(cloud, { bots, links }, { workspaces: cloud.workspaces.map((workspace) => workspace._id), projects: cloud.projects.map((project) => project._id) });
  const result = await runImport(plan, { call, lead });
  return { links, result };
}
