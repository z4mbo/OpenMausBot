import { api } from "@/state/store";

export const CREATES_FOLDERS_AND_GROUPS = false;
export const SIDEBAR_SHOWS_LOOSE_BOTS = false;
export const SIDEBAR_HAS_SEARCH = false;

/** The head bot sits above every project's Chief: the oldest bot that belongs to no project (bots arrive newest first). */
export function headBot<T>(looseBots: readonly T[]): T | undefined {
  return looseBots.at(-1);
}

export function createDefaultTeam(botId: string) {
  return api(`/api/bots/${encodeURIComponent(botId)}/default-team`, { method: "POST" });
}
