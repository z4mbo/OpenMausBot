import { useSyncExternalStore } from "react";

let archived: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((item) => b.has(item));

export function setArchivedSections(next: ReadonlySet<string>) {
  if (sameSet(archived, next)) return;
  archived = next;
  for (const listener of listeners) listener();
}

/** Archived Origin projects keep working but stay out of unread counts and notifications. */
export function inArchivedProject(bot: { section?: string } | undefined): boolean {
  const section = bot?.section?.trim();
  return Boolean(section && archived.has(section));
}

export function useArchivedSections(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => archived, () => archived);
}
