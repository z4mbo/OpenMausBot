import { STANDALONE_SECTION, isWorkspaceSection } from "../../shared/origin-workspaces";

interface LocalBot { id: string; name: string; section?: string; chiefOfStaff?: boolean; managedSections?: string[]; shared?: { teamId: string } }
interface LocalGroup { id: string; name: string; section?: string }

export interface LocalWorkspaceContents {
  headId: string;
  /** Agents first, then project Chiefs, so a failure never leaves a team without its lead while its agents remain. */
  bots: LocalBot[];
  groups: LocalGroup[];
  /** The project and template teams the workspace's head manages. */
  teams: string[];
}

const teamOf = (item: { section?: string }) => item.section?.trim() ?? "";
const isHead = (bot: LocalBot) => Boolean(bot.chiefOfStaff && isWorkspaceSection(bot.section));

/** What deleting a workspace removes from this computer: its head, its teams' bots and group chats, and standalone agents shared through its Origin workspace. */
export function localWorkspaceContents(headId: string, bots: readonly LocalBot[], groups: readonly LocalGroup[], cloudTeamId?: string | null): LocalWorkspaceContents {
  const head = bots.find((bot) => bot.id === headId);
  if (!head) return { headId, bots: [], groups: [], teams: [] };
  const otherHeads = bots.filter((bot) => bot.id !== headId && isHead(bot));
  const elsewhere = new Set(otherHeads.flatMap((other) => [teamOf(other), ...(other.managedSections ?? []).map((team) => team.trim())]));
  const own = teamOf(head);
  const teams = [...new Set((head.managedSections ?? []).map((team) => team.trim()))]
    .filter((team) => team && team !== own && team !== STANDALONE_SECTION && !elsewhere.has(team));
  const inWorkspace = new Set([own, ...teams]);
  const members = bots.filter((bot) => bot.id !== headId && !isHead(bot)
    && (inWorkspace.has(teamOf(bot)) || Boolean(cloudTeamId && bot.shared?.teamId === cloudTeamId)));
  return {
    headId,
    bots: [...members.filter((bot) => !bot.chiefOfStaff), ...members.filter((bot) => bot.chiefOfStaff)],
    groups: groups.filter((group) => inWorkspace.has(teamOf(group))),
    teams,
  };
}

type Call = (path: string, init: { method: string }) => Promise<unknown>;

const alreadyGone = (cause: unknown) => (cause as { status?: number } | null)?.status === 404;

/**
 * Deletes the workspace's group chats and bots through the same routes a single deletion uses, then its emptied teams,
 * runs `beforeHead`, then deletes the head. Safe to retry: whatever is already gone is skipped, and the head stays until
 * everything else went.
 */
export async function deleteLocalWorkspace(contents: LocalWorkspaceContents, call: Call, beforeHead?: () => Promise<void>): Promise<void> {
  const failures: string[] = [];
  const remove = async (name: string, path: string) => {
    try { await call(path, { method: "DELETE" }); }
    catch (cause) { if (!alreadyGone(cause)) failures.push(`${name}: ${cause instanceof Error ? cause.message : String(cause)}`); }
  };
  for (const group of contents.groups) await remove(group.name, `/api/groups/${encodeURIComponent(group.id)}`);
  for (const bot of contents.bots) await remove(bot.name, `/api/bots/${encodeURIComponent(bot.id)}`);
  if (!failures.length) for (const team of contents.teams) await remove(team, `/api/sidebar-sections?section=${encodeURIComponent(team)}`);
  if (failures.length) throw new Error(`Some of this workspace could not be deleted on this computer. ${failures.join("; ")}`);
  await beforeHead?.();
  await remove("The workspace", `/api/bots/${encodeURIComponent(contents.headId)}`);
  if (failures.length) throw new Error(failures[0]);
}
