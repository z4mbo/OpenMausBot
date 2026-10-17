import { useSyncExternalStore } from "react";
import { api, useStore } from "@/state/store";
import type { CloudLinks } from "./origin-import";

const EMPTY: CloudLinks = { workspaces: {}, projects: {} };
let links: CloudLinks = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

function load() {
  loading ??= api<CloudLinks>("/api/origin/cloud-links")
    .then((result) => { links = { workspaces: result.workspaces ?? {}, projects: result.projects ?? {} }; notify(); })
    .catch(() => { loading = null; });
  return loading;
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
