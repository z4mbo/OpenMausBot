import { useCallback, useSyncExternalStore } from "react";
import { setChiefSectionOf } from "./origin-chief-section";

/** What a project's Publish page shows: its posts, its campaigns, or its sales (contacts, inbox, deals). */
export type PublishMode = "posts" | "campaigns" | "sales";

const modes = new Map<string, PublishMode>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const publishModeOf = (botId: string): PublishMode => modes.get(botId) ?? "posts";

export function setPublishMode(botId: string, mode: PublishMode): void {
  if (publishModeOf(botId) === mode) return;
  modes.set(botId, mode);
  for (const listener of listeners) listener();
}

export function usePublishMode(botId: string): [PublishMode, (mode: PublishMode) => void] {
  const mode = useSyncExternalStore(subscribe, () => publishModeOf(botId), () => "posts" as const);
  return [mode, useCallback((next: PublishMode) => setPublishMode(botId, next), [botId])];
}

export function openSales(botId: string): void {
  setPublishMode(botId, "sales");
  setChiefSectionOf(botId, "broadcast");
}
