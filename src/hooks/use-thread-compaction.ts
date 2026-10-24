import { useEffect, useSyncExternalStore } from "react";
import { api, useStore, type Bot } from "@/state/store";

type Phase = "requesting" | "accepted" | "running";

const phases = new Map<string, Phase>();
const listeners = new Set<() => void>();

function setPhase(key: string, phase: Phase | undefined) {
  if (phases.get(key) === phase) return;
  if (phase) phases.set(key, phase); else phases.delete(key);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useThreadCompaction(bot: Pick<Bot, "id" | "threadId" | "busy">) {
  const { dispatch } = useStore();
  const key = `${bot.id}:${bot.threadId}`;
  const phase = useSyncExternalStore(subscribe, () => phases.get(key), () => undefined);
  const busy = Boolean(bot.busy);
  useEffect(() => {
    if (phase === "accepted" && busy) setPhase(key, "running");
    else if (phase === "running" && !busy) setPhase(key, undefined);
  }, [key, phase, busy]);
  const compact = () => {
    if (phase || busy) return;
    setPhase(key, "requesting");
    void api(`/api/bots/${bot.id}/compact`, { method: "POST", body: JSON.stringify({ threadId: bot.threadId }) })
      .then(() => { if (phases.get(key) === "requesting") setPhase(key, "accepted"); })
      .catch((cause) => {
        setPhase(key, undefined);
        dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
  };
  return { compacting: phase !== undefined, blocked: busy && phase === undefined, compact };
}
