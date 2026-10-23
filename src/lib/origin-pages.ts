import { useSyncExternalStore } from "react";
import { setChiefSectionOf } from "./origin-chief-section";

/** Workspace pages shown in place of a chat while open. */
export type OriginPage = "inbox" | "chat" | "call";

let current: OriginPage | null = null;
const listeners = new Set<() => void>();

export function openOriginPage(page: OriginPage | null) {
  current = page;
  for (const listener of listeners) listener();
}

/** Puts a conversation on screen: closes any workspace page and turns a project lead to its chat. */
export function revealConversation(owner: { id: string; chiefOfStaff?: boolean } | undefined) {
  openOriginPage(null);
  if (owner?.chiefOfStaff) setChiefSectionOf(owner.id, "chat");
}

export const currentOriginPage = (): OriginPage | null => current;

export function useOriginPage(): OriginPage | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => current, () => null);
}
