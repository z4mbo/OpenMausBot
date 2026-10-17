import { useSyncExternalStore } from "react";
import { isWorkspaceSection } from "../../shared/origin-workspaces";

/** Which workspace is open and how its projects are listed: per-browser view choices. Membership lives on the server. */
export type ProjectSort = "custom" | "recent" | "name";

interface WorkspaceView {
  active?: string;
  order: string[];
  sort: ProjectSort;
  collapsed: boolean;
  /** Order and folded state of the sidebar groups below Projects (Agents and template teams). */
  groupOrder?: string[];
  collapsedGroups?: string[];
  /** Workspace heads that belong to the signed-in Origin account; other local heads stay hidden. */
  account?: string[];
}

interface Head { id: string; section?: string; chiefOfStaff?: boolean; managedSections?: string[] }

const KEY = "origin-workspaces";
const EMPTY: WorkspaceView = { order: [], sort: "custom", collapsed: false };
const listeners = new Set<() => void>();
let cached: WorkspaceView | undefined;

function read(): WorkspaceView {
  if (cached) return cached;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    cached = raw ? { ...EMPTY, ...JSON.parse(raw) as Partial<WorkspaceView> } : EMPTY;
  } catch {
    cached = EMPTY;
  }
  return cached;
}

function write(patch: Partial<WorkspaceView>) {
  cached = { ...read(), ...patch };
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(cached)); } catch { /* per-browser convenience only */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaces(): WorkspaceView {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/** Heads arrive newest first; the oldest is the default workspace. */
export function workspaceHeadsOf<T extends Head>(bots: readonly T[]): T[] {
  const account = read().account;
  return bots.filter((bot) => bot.chiefOfStaff && isWorkspaceSection(bot.section) && (!account || account.includes(bot.id))).reverse();
}

export function setAccountWorkspaces(headIds: string[]) {
  const current = read().account;
  if (current && current.length === headIds.length && current.every((id, index) => id === headIds[index])) return;
  write({ account: headIds });
}

export function activeWorkspace(view: WorkspaceView, heads: readonly { id: string }[]): string | undefined {
  return heads.some((head) => head.id === view.active) ? view.active : heads[0]?.id;
}

export function inWorkspace(head: Head | undefined, project: { section?: string }): boolean {
  const team = project.section?.trim();
  return !head || Boolean(team && head.managedSections?.some((name) => name.trim() === team));
}

export const activeWorkspaceId = () => read().active;
/** Tells the server which workspace is open, so a template team added now joins it. */
export function reportActiveWorkspace(headId: string) {
  void fetch("/api/workspaces/active", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: headId }) }).catch(() => {});
}
export const switchWorkspace = (headId: string) => {
  write({ active: headId });
  reportActiveWorkspace(headId);
};
export const setProjectSort = (sort: ProjectSort) => write({ sort });
export const setProjectsCollapsed = (collapsed: boolean) => write({ collapsed });
export const setGroupOrder = (groupOrder: string[]) => write({ groupOrder });
export function toggleGroup(id: string) {
  const folded = new Set(read().collapsedGroups ?? []);
  if (folded.has(id)) folded.delete(id); else folded.add(id);
  write({ collapsedGroups: [...folded] });
}
export function orderedGroups<T extends { id: string }>(groups: readonly T[], view: WorkspaceView): T[] {
  const order = view.groupOrder ?? [];
  const rank = (id: string) => { const index = order.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  return [...groups].sort((a, b) => rank(a.id) - rank(b.id));
}
export const setProjectOrder = (order: string[]) => write({ order, sort: "custom" });

/** Projects of one workspace, in the chosen order. `updatedAt` is the project's latest thread activity. */
export function sortProjects<T extends { id: string; name: string; updatedAt: number }>(projects: readonly T[], view: WorkspaceView): T[] {
  const list = [...projects];
  if (view.sort === "name") return list.sort((a, b) => a.name.localeCompare(b.name));
  if (view.sort === "recent") return list.sort((a, b) => b.updatedAt - a.updatedAt);
  const rank = (id: string) => { const index = view.order.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  return list.sort((a, b) => rank(a.id) - rank(b.id));
}

export function movedOrder(ids: readonly string[], from: string, to: string, place: "before" | "after"): string[] {
  const rest = ids.filter((id) => id !== from);
  const at = rest.indexOf(to);
  if (at < 0) return [...ids];
  rest.splice(place === "before" ? at : at + 1, 0, from);
  return rest;
}
