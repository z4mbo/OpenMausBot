import { useSyncExternalStore } from "react";
import type { CanvasKind } from "../../shared/origin-design";

const chosen = new Map<string, CanvasKind>();
const listeners = new Set<() => void>();
let version = 0;

/** Which of Design, Board and Presentations each project's Design page shows. */
export const designViewOf = (botId: string): CanvasKind => chosen.get(botId) ?? "design";

export function setDesignViewOf(botId: string, kind: CanvasKind): void {
  if (designViewOf(botId) === kind) return;
  chosen.set(botId, kind);
  version += 1;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useDesignView(botId: string): [CanvasKind, (kind: CanvasKind) => void] {
  useSyncExternalStore(subscribe, () => version, () => version);
  return [designViewOf(botId), (kind) => setDesignViewOf(botId, kind)];
}
