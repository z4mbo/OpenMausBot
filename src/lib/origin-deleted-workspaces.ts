import { isWorkspaceSection } from "../../shared/origin-workspaces";
import { deleteLocalWorkspace, localWorkspaceContents, type DeletionCall, type LocalBot, type LocalGroup, type LocalWorkspaceContents } from "./origin-workspace-deletion";

/** A workspace the signed-in person was in when an owner or admin deleted it, as `workspaces:deleted` reports it. */
export interface DeletedWorkspace { teamId: string; name: string; deletedBy: string; byYou: boolean; deletedAt: number }

const isHead = (bot: LocalBot | undefined) => Boolean(bot?.chiefOfStaff && isWorkspaceSection(bot.section));

/** This computer's copy of a deleted workspace: everything under its linked head, or the agents shared through it when no head is here. */
export function localCopyOf(teamId: string, workspaceLinks: Readonly<Record<string, string>>, bots: readonly LocalBot[], groups: readonly LocalGroup[]): LocalWorkspaceContents | null {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const headId = Object.entries(workspaceLinks).find(([id, team]) => team === teamId && isHead(byId.get(id)))?.[0];
  if (headId) return localWorkspaceContents(headId, bots, groups, teamId);
  const shared = bots.filter((bot) => bot.shared?.teamId === teamId);
  return shared.length ? { headId: null, bots: shared, groups: [], teams: [] } : null;
}

export interface DeletedWorkspaceCleanup {
  /** Deleted workspaces whose copy was on this computer when the round began. */
  found: DeletedWorkspace[];
  removedBotIds: Set<string>;
  failures: { workspace: DeletedWorkspace; error: string }[];
}

/**
 * Removes this computer's copy of each workspace Origin reports deleted, through the same deletion a workspace's owner
 * runs, head last. A workspace the account still lists is never touched. Rerunning finishes an interrupted removal.
 */
export async function removeDeletedWorkspaces(deps: {
  deleted: readonly DeletedWorkspace[];
  listed: ReadonlySet<string>;
  workspaceLinks: Readonly<Record<string, string>>;
  bots: readonly LocalBot[];
  groups: readonly LocalGroup[];
  call: DeletionCall;
}): Promise<DeletedWorkspaceCleanup> {
  const outcome: DeletedWorkspaceCleanup = { found: [], removedBotIds: new Set(), failures: [] };
  for (const workspace of deps.deleted) {
    if (deps.listed.has(workspace.teamId)) continue;
    const copy = localCopyOf(workspace.teamId, deps.workspaceLinks, deps.bots, deps.groups);
    if (!copy) continue;
    outcome.found.push(workspace);
    try {
      await deleteLocalWorkspace(copy, deps.call);
      for (const id of [...copy.bots.map((bot) => bot.id), ...(copy.headId ? [copy.headId] : [])]) outcome.removedBotIds.add(id);
    } catch (cause) {
      outcome.failures.push({ workspace, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return outcome;
}

const NOTICED_KEY = "origin-deleted-workspaces-noticed";

function noticed(): Set<string> {
  try { return new Set(JSON.parse(globalThis.localStorage?.getItem(NOTICED_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

/** The found workspaces this computer has not told its person about yet; each is reported once. Forgets workspaces Origin no longer reports. */
export function takeUnnoticed(found: readonly DeletedWorkspace[], reported: readonly DeletedWorkspace[]): DeletedWorkspace[] {
  const seen = noticed();
  const fresh = found.filter((workspace) => !seen.has(workspace.teamId));
  const still = new Set(reported.map((workspace) => workspace.teamId));
  const next = [...seen, ...fresh.map((workspace) => workspace.teamId)].filter((teamId) => still.has(teamId));
  try { globalThis.localStorage?.setItem(NOTICED_KEY, JSON.stringify(next)); } catch { return fresh; }
  return fresh;
}

export function deletedNoticeText(workspace: DeletedWorkspace, removed: boolean): string {
  const by = workspace.byYou ? "you" : workspace.deletedBy;
  return removed
    ? `${workspace.name} was deleted by ${by}. Its agents, chats and teams on this computer were removed too.`
    : `${workspace.name} was deleted by ${by}. Some of its agents on this computer could not be removed yet; Origin will try again.`;
}
