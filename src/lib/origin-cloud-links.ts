import { useSyncExternalStore } from "react";
import { api, useStore } from "@/state/store";
import type { CloudLinks } from "./origin-import";

const EMPTY: CloudLinks = { workspaces: {}, projects: {} };
let links: CloudLinks = EMPTY;
let loading: Promise<void> | null = null;
let latestRequest = 0;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

function load() {
  if (loading) return loading;
  const request = ++latestRequest;
  const pending: Promise<void> = api<CloudLinks>("/api/origin/cloud-links")
    .then((result) => {
      if (request !== latestRequest) return;
      links = { workspaces: result.workspaces ?? {}, projects: result.projects ?? {} };
      notify();
    })
    .catch(() => { if (loading === pending) loading = null; });
  loading = pending;
  return pending;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

export function refreshCloudLinks(): Promise<void> {
  loading = null;
  return load();
}

export function useCloudLinks(): CloudLinks {
  return useSyncExternalStore(subscribe, () => links, () => EMPTY);
}

/** The cloud project a project Chief is linked to, or the cloud workspace a workspace head is linked to. */
export function useCloudLink(botId: string): string | undefined {
  return useSyncExternalStore(subscribe, () => links.projects[botId] ?? links.workspaces[botId], () => undefined);
}

interface TeamBot { id: string; section?: string; chiefOfStaff?: boolean }

export function cloudProjectOf(bots: readonly TeamBot[], projects: Record<string, string>, botId: string): string | undefined {
  if (projects[botId]) return projects[botId];
  const team = bots.find((bot) => bot.id === botId)?.section?.trim();
  if (!team) return undefined;
  const chief = bots.find((bot) => bot.chiefOfStaff && bot.section?.trim() === team && projects[bot.id]);
  return chief ? projects[chief.id] : undefined;
}

/** The cloud project of a Chief or of any agent on its team. */
export function useCloudProjectFor(bot: { id: string } | undefined): string | undefined {
  const { state } = useStore();
  const { projects } = useCloudLinks();
  return bot ? cloudProjectOf(state.bots, projects, bot.id) : undefined;
}

interface WorkspaceBot extends TeamBot { managedSections?: string[] }

/** The cloud workspace whose head manages this bot's team. */
export function cloudWorkspaceOf(bots: readonly WorkspaceBot[], workspaces: Record<string, string>, botId: string): string | undefined {
  const team = bots.find((bot) => bot.id === botId)?.section?.trim();
  if (!team) return undefined;
  const head = bots.find((bot) => workspaces[bot.id] && bot.managedSections?.some((section) => section.trim() === team));
  return head ? workspaces[head.id] : undefined;
}

export function useCloudWorkspaceFor(bot: { id: string } | undefined): string | undefined {
  const { state } = useStore();
  const { workspaces } = useCloudLinks();
  return bot ? cloudWorkspaceOf(state.bots, workspaces, bot.id) : undefined;
}

export async function linkCloudRecord(patch: Partial<CloudLinks>): Promise<void> {
  await api("/api/origin/cloud-links", { method: "PUT", body: JSON.stringify(patch) });
  await refreshCloudLinks();
}
