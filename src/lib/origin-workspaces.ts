import { useSyncExternalStore } from "react";

/** A workspace is a head bot and the projects (Chief bots) filed under it. Kept in this browser only. */
export type ProjectSort = "custom" | "recent" | "name";

interface WorkspaceState {
  active?: string;
  projectWorkspace: Record<string, string>;
  order: string[];
  sort: ProjectSort;
  collapsed: boolean;
}

const KEY = "origin-workspaces";
const EMPTY: WorkspaceState = { projectWorkspace: {}, order: [], sort: "custom", collapsed: false };
const listeners = new Set<() => void>();
let cached: WorkspaceState | undefined;

function read(): WorkspaceState {
  if (cached) return cached;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    cached = raw ? { ...EMPTY, ...JSON.parse(raw) as Partial<WorkspaceState> } : EMPTY;
  } catch {
    cached = EMPTY;
  }
  return cached;
}

function write(patch: Partial<WorkspaceState>) {
  cached = { ...read(), ...patch };
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(cached)); } catch { /* per-browser convenience only */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaces(): WorkspaceState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function activeWorkspace(state: WorkspaceState, heads: readonly { id: string }[]): string | undefined {
  return heads.some((head) => head.id === state.active) ? state.active : heads[0]?.id;
}

export function workspaceOf(state: WorkspaceState, projectId: string, fallback: string | undefined): string | undefined {
  return state.projectWorkspace[projectId] ?? fallback;
}

export const activeWorkspaceId = () => read().active;
export const switchWorkspace =(headId: string) => write({ active: headId });
export const setProjectSort = (sort: ProjectSort) => write({ sort });
export const setProjectsCollapsed = (collapsed: boolean) => write({ collapsed });
export const setProjectOrder = (order: string[]) => write({ order, sort: "custom" });

export function fileProject(projectId: string, headId: string | undefined) {
  if (!headId) return;
  const state = read();
  write({ projectWorkspace: { ...state.projectWorkspace, [projectId]: headId }, order: [...state.order.filter((id) => id !== projectId), projectId] });
}

/** Projects of one workspace, in the chosen order. `updatedAt` is the project's latest thread activity. */
export function sortProjects<T extends { id: string; name: string; updatedAt: number }>(projects: readonly T[], state: WorkspaceState): T[] {
  const list = [...projects];
  if (state.sort === "name") return list.sort((a, b) => a.name.localeCompare(b.name));
  if (state.sort === "recent") return list.sort((a, b) => b.updatedAt - a.updatedAt);
  const rank = (id: string) => { const index = state.order.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  return list.sort((a, b) => rank(a.id) - rank(b.id));
}

export function movedOrder(ids: readonly string[], from: string, to: string, place: "before" | "after"): string[] {
  const rest = ids.filter((id) => id !== from);
  const at = rest.indexOf(to);
  if (at < 0) return [...ids];
  rest.splice(place === "before" ? at : at + 1, 0, from);
  return rest;
}
