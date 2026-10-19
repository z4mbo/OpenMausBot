import { rmSync } from "node:fs";
import { join } from "node:path";
import { isWorkspaceSection } from "../shared/origin-workspaces.ts";
import type { TeamSetupRequest } from "../shared/team-setup.ts";
import { removeBotFolder } from "./bot-folder.ts";
import { DATA_DIR } from "./config.ts";
import { forgetBotMemoryJournal, journalFile } from "./memory-journal.ts";
import { deleteBotMemoryFiles } from "./message-db.ts";
import { changeEmptySection } from "./section-context.ts";
import type { BotRecord, GroupRecord } from "./store.ts";
import { workspaceDir } from "./workspace.ts";

interface WorkspaceSections {
  bots: BotRecord[];
  groups: GroupRecord[];
  sections: string[];
  sectionHasComputer(section: string): boolean;
}

function emptyWorkspaceSection(section: string, deps: WorkspaceSections): boolean {
  return isWorkspaceSection(section) && deps.sections.includes(section)
    && ![...deps.bots, ...deps.groups].some(record => record.section?.trim() === section)
    && !deps.sectionHasComputer(section);
}

export function retireEmptyWorkspaceSections(deps: WorkspaceSections & {
  changeEmptySection(name: string, nextName: null): string | undefined;
}): string[] {
  const retired: string[] = [];
  for (const section of deps.sections) {
    if (!emptyWorkspaceSection(section, deps)) continue;
    const error = deps.changeEmptySection(section, null);
    if (error) throw new Error(error);
    retired.push(section);
  }
  return retired;
}

export function persistBotDeletion(bot: BotRecord, deps: WorkspaceSections & {
  saveBots(bots: BotRecord[], registerSections?: boolean): void;
}, setupRequest?: TeamSetupRequest): { bots: BotRecord[]; revoked: BotRecord[]; retiredSection: string | null } {
  let nextBots = deps.bots.filter(candidate => candidate.id !== bot.id);
  if (setupRequest) {
    const chief = deps.bots.find(candidate => candidate.id === setupRequest.botId);
    if (!chief || chief.id === bot.id || setupRequest.deletion?.botId !== bot.id) throw new Error("The reviewed deletion no longer has a valid owner");
    const lastTeamSetupReceipt: NonNullable<BotRecord["lastTeamSetupReceipt"]> = { requestId: setupRequest.requestId, result: { state: "applied", newTeams: [], bots: [
      { id: bot.id, name: bot.name, action: "deleted" },
    ] } };
    nextBots = nextBots.map(candidate => candidate.id === chief.id ? { ...candidate, lastTeamSetupReceipt } : candidate);
  }
  const section = bot.section?.trim() || "";
  const retiredSection = bot.chiefOfStaff && emptyWorkspaceSection(section, { ...deps, bots: nextBots }) ? section : null;
  const revoked = retiredSection ? deps.bots.filter(candidate => candidate.id !== bot.id
    && candidate.managedSections?.some(name => name.trim() === retiredSection)) : [];
  const grants = new Map(revoked.map(candidate => [candidate.id, candidate.managedSections!.filter(name => name.trim() !== retiredSection)]));
  nextBots = nextBots.map(candidate => grants.has(candidate.id) ? { ...candidate, managedSections: grants.get(candidate.id)! } : candidate);
  // Persist grant revocation before freeing a workspace name, so name reuse cannot restore access.
  deps.saveBots(nextBots, !retiredSection);
  if (retiredSection) {
    try {
      changeEmptySection(retiredSection, null);
    } catch (error) {
      deps.saveBots(deps.bots, false);
      throw error;
    }
  }
  const liveReferences = new Map(revoked.map(candidate => [candidate.id, candidate]));
  nextBots = nextBots.map(candidate => {
    const existing = liveReferences.get(candidate.id);
    return existing ? Object.assign(existing, candidate) : candidate;
  });
  return { bots: nextBots, revoked, retiredSection };
}

export function deleteBotData(bot: BotRecord, deleteThread: (threadId: string) => void): void {
  for (const threadId of new Set([bot.threadId, ...(bot.tasks ?? []).map(task => task.threadId)])) deleteThread(threadId);
  try {
    rmSync(workspaceDir(bot.id), { recursive: true, force: true });
  } catch {}
  try {
    rmSync(journalFile(bot.id), { force: true });
  } catch {}
  deleteBotMemoryFiles(bot.id);
  forgetBotMemoryJournal(bot.id);
  try {
    rmSync(join(DATA_DIR, "skill-state", bot.id), { recursive: true, force: true });
  } catch {}
  removeBotFolder(bot.id);
}
