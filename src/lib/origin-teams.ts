import { api } from "@/state/store";

export const CREATES_FOLDERS_AND_GROUPS = false;
export const SIDEBAR_SHOWS_LOOSE_BOTS = false;
export const SIDEBAR_HAS_SEARCH = false;
export const SIDEBAR_ROW_EXTRAS = false;
export const SIDEBAR_THREAD_TREE = true;
export const SIDEBAR_ACTIONS_IN_FOOTER = true;
export const SHOWS_CHIEF_LABEL = false;

export function createDefaultTeam(botId: string, workspaceId?: string) {
  return api(`/api/bots/${encodeURIComponent(botId)}/default-team`, { method: "POST", body: JSON.stringify(workspaceId ? { workspaceId } : {}) });
}
