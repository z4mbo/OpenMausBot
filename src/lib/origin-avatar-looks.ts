import { useSyncExternalStore } from "react";
import { api } from "@/state/store";

export interface AvatarLook { look?: "mascot" | "dot"; color?: string }

/** Zap's dot colours, offered beside a free colour picker. */
export const ZAP_SWATCHES = ["#C8FF00", "#FF5FCB", "#4DA3FF", "#FFB020", "#A78BFA", "#2EE6C9", "#FF6A3D", "#FFE14D", "#7C9CFF", "#FF8FAB", "#9BE7FF", "#F2F2EF"] as const;

const NONE: AvatarLook = {};
let looks: Record<string, AvatarLook> = {};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

function load() {
  loading ??= api<{ looks: Record<string, AvatarLook> }>("/api/origin/avatar-looks")
    .then((result) => { looks = result.looks ?? {}; notify(); })
    .catch(() => { loading = null; });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

export function useAvatarLook(botId: string | undefined): AvatarLook {
  return useSyncExternalStore(subscribe, () => (botId && looks[botId]) || NONE, () => NONE);
}

export async function setAvatarLook(botId: string, patch: { look?: "mascot" | "dot"; color?: string | null }) {
  const result = await api<{ look: AvatarLook }>(`/api/bots/${encodeURIComponent(botId)}/avatar-look`, {
    method: "PUT", body: JSON.stringify(patch),
  });
  looks = { ...looks, [botId]: result.look };
  notify();
}
