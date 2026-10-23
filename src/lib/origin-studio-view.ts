import { useSyncExternalStore } from "react";

/** Which mode each project's Studio shows. */
export type StudioView = "create" | "workflows" | "presets" | "library";

const chosen = new Map<string, StudioView>();
const listeners = new Set<() => void>();
let version = 0;

export const studioViewOf = (botId: string): StudioView => chosen.get(botId) ?? "create";

export function setStudioViewOf(botId: string, view: StudioView): void {
  if (studioViewOf(botId) === view) return;
  chosen.set(botId, view);
  version += 1;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useStudioView(botId: string): [StudioView, (view: StudioView) => void] {
  useSyncExternalStore(subscribe, () => version, () => version);
  return [studioViewOf(botId), (view) => setStudioViewOf(botId, view)];
}
