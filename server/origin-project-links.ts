import { isWorkspaceSection } from "../shared/origin-workspaces.ts";
import { sectionKey, type BotRecord } from "./store.ts";

export type OriginProjectBot = Pick<BotRecord, "id" | "name" | "section" | "chiefOfStaff" | "managedSections"> & Partial<Pick<BotRecord, "title" | "hidden">>;
type ProjectBot = OriginProjectBot;

export function cloudProjectFor(bots: readonly ProjectBot[], links: Record<string, string>, botId: string): string | null {
  const bot = bots.find((candidate) => candidate.id === botId);
  if (!bot || bot.hidden || isWorkspaceSection(bot.section)) return null;
  if (links[botId]) return links[botId];
  const section = sectionKey(bot.section);
  const chiefs = bots.filter((candidate) => !candidate.hidden && candidate.chiefOfStaff && !isWorkspaceSection(candidate.section) && links[candidate.id]);
  const leader = chiefs.find((chief) => sectionKey(chief.section) === section)
    ?? chiefs.find((chief) => chief.managedSections?.some((managed) => sectionKey(managed) === section));
  return leader ? links[leader.id] : null;
}

export interface ReachableProject {
  projectId: string;
  /** The team (sidebar section) that works on it. */
  section: string;
  /** Linked to the bot itself or its own team, rather than reached through a section it manages. */
  own: boolean;
}

/** Project agents reach one project; workspace heads reach the projects in their managed teams. */
export function reachableCloudProjects(bots: readonly ProjectBot[], links: Record<string, string>, botId: string): ReachableProject[] {
  const bot = bots.find((candidate) => candidate.id === botId);
  if (!bot || bot.hidden) return [];
  const found = new Map<string, ReachableProject>();
  const own = cloudProjectFor(bots, links, botId);
  if (own) found.set(own, { projectId: own, section: sectionKey(bot.section), own: true });
  if (bot.chiefOfStaff && isWorkspaceSection(bot.section)) {
    const managed = new Set((bot.managedSections ?? []).map((section) => sectionKey(section)).filter(Boolean));
    for (const candidate of bots) {
      const projectId = links[candidate.id];
      if (!projectId || candidate.hidden || !candidate.chiefOfStaff || isWorkspaceSection(candidate.section) || found.has(projectId) || !managed.has(sectionKey(candidate.section))) continue;
      found.set(projectId, { projectId, section: sectionKey(candidate.section), own: false });
    }
  }
  return [...found.values()];
}

export function projectPeerTeams(bots: readonly ProjectBot[], links: Record<string, string>, botId: string): { projectId: string; teams: string[] } | null {
  const projectId = cloudProjectFor(bots, links, botId);
  if (!projectId) return null;
  return { projectId, teams: [...new Set(bots.filter((bot) => !bot.hidden && cloudProjectFor(bots, links, bot.id) === projectId).map((bot) => sectionKey(bot.section)))] };
}
