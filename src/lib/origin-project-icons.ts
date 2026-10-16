import { useSyncExternalStore } from "react";
import { api } from "@/state/store";

let icons: Record<string, string> = {};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

function load() {
  loading ??= api<{ icons: Record<string, string> }>("/api/origin/project-icons")
    .then((result) => { icons = result.icons ?? {}; notify(); })
    .catch(() => { loading = null; });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

export function useProjectIcon(botId: string): string | undefined {
  return useSyncExternalStore(subscribe, () => icons[botId], () => undefined);
}

export async function setProjectIcon(botId: string, iconUrl: string | null) {
  const result = await api<{ iconUrl: string | null }>(`/api/bots/${encodeURIComponent(botId)}/project-icon`, {
    method: "PUT", body: JSON.stringify({ iconUrl }),
  });
  icons = { ...icons };
  if (result.iconUrl) icons[botId] = result.iconUrl; else delete icons[botId];
  notify();
}
