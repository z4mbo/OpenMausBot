import { useSyncExternalStore } from "react";

/** The milestone each project's Issues board is narrowed to; null shows every issue. */
const chosen = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

export function setMilestoneFilter(projectId: string, milestoneId: string | null): void {
  if ((chosen.get(projectId) ?? null) === milestoneId) return;
  if (milestoneId) chosen.set(projectId, milestoneId);
  else chosen.delete(projectId);
  version += 1;
  for (const listener of listeners) listener();
}

export function useMilestoneFilter(projectId: string): [string | null, (milestoneId: string | null) => void] {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version, () => version);
  return [chosen.get(projectId) ?? null, (milestoneId) => setMilestoneFilter(projectId, milestoneId)];
}
