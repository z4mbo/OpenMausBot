import { useSyncExternalStore } from "react";

/** Workspace pages shown in place of a chat while open. */
export type OriginPage = "inbox" | "chat" | "call";

let current: OriginPage | null = null;
const listeners = new Set<() => void>();

export function openOriginPage(page: OriginPage | null) {
  current = page;
  for (const listener of listeners) listener();
}

export const currentOriginPage = (): OriginPage | null => current;

export function useOriginPage(): OriginPage | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => current, () => null);
}
