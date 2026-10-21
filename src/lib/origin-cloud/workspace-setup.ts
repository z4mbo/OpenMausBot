import { useSyncExternalStore } from "react";
import { cloudMutation } from "./client";

const SEEN_KEY = "origin-github-intro-seen";
const SEEN_MAX = 200;

let offered: string | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

function seen(): string[] {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function workspaceGitHubIntroSeen(teamId: string): boolean {
  return seen().includes(teamId);
}

export function markWorkspaceGitHubIntroSeen(teamId: string): void {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify([...seen().filter((id) => id !== teamId), teamId].slice(-SEEN_MAX)));
  } catch {
    return;
  }
}

/** Opens the skippable GitHub step for a workspace its owner just created. */
export function offerWorkspaceGitHub(teamId: string): void {
  offered = teamId;
  markWorkspaceGitHubIntroSeen(teamId);
  notify();
}

export function closeWorkspaceGitHubOffer(): void {
  offered = null;
  notify();
}

export function useWorkspaceGitHubOffer(): string | null {
  return useSyncExternalStore(subscribe, () => offered, () => null);
}

/** Creates an Origin workspace, then offers its owner the GitHub step; skipping it never undoes the workspace. */
export async function createOriginWorkspace(name: string): Promise<{ teamId: string; slug: string }> {
  const created = await cloudMutation<{ teamId: string; slug: string }>("workspaces:create", { name });
  offerWorkspaceGitHub(created.teamId);
  return created;
}
