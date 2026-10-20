import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/state/store";
import type { Bot, ModelSelection } from "@/state/store";
import { modelPairKey, REMOTE_MODEL_INSTANCE } from "../../shared/model-selection";
import { t } from "./i18n";

export interface ModelHostSource {
  sourceId: string; hostId: string; ownerUserId: string; ownerName: string; computerName: string;
  provider: string; label: string; billing: "subscription" | "metered" | "unknown";
  models: string[]; heartbeatAt: number; expiresAt: number; capacity: number;
}

export function sharedSourceLabel(source: ModelHostSource): string {
  return `${source.ownerName} · ${source.computerName} · ${source.label}`;
}

export function sharedSelection(source: ModelHostSource, model: string): ModelSelection {
  return { instanceId: REMOTE_MODEL_INSTANCE, model, source: { hostId: source.hostId, sourceId: source.sourceId } };
}

export function sharedSourceReady(source: ModelHostSource, now = Date.now()): boolean {
  return source.expiresAt > now && source.billing !== "unknown";
}

export function sharedSourceModels(source: ModelHostSource, excluded: readonly ModelSelection[], paidAllowed: boolean, now = Date.now()): string[] {
  if (!sharedSourceReady(source, now) || (!paidAllowed && source.billing !== "subscription")) return [];
  const keys = new Set(excluded.map(modelPairKey));
  return source.models.filter(model => !keys.has(modelPairKey(sharedSelection(source, model))));
}

export function useModelHostCatalog(bot: Pick<Bot, "id" | "shared">, enabled: boolean) {
  const [state, setState] = useState<{ scope: string; sources: ModelHostSource[]; ready: boolean; error: string; loading: boolean }>({ scope: "", sources: [], ready: false, error: "", loading: false });
  const request = useRef<AbortController | null>(null);
  const bound = Boolean(bot.shared?.agentId);
  const scope = JSON.stringify([bot.id, bot.shared?.teamId, bot.shared?.agentId]);
  const reload = useCallback(async () => {
    if (!enabled || !bound) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setState(previous => ({ scope, sources: previous.scope === scope ? previous.sources : [], ready: previous.scope === scope && previous.ready, error: "", loading: true }));
    try {
      const result = await api<{ ready?: boolean; reason?: string; sources: ModelHostSource[] }>(`/api/origin/model-host/catalog?botId=${encodeURIComponent(bot.id)}`, { signal: controller.signal });
      if (!controller.signal.aborted) setState({ scope, sources: result.ready === true ? result.sources : [], ready: result.ready === true, error: result.ready === true ? "" : result.reason || t("modelHost.releaseUnavailable"), loading: false });
    } catch (cause) {
      if (!controller.signal.aborted) setState({ scope, sources: [], ready: false, error: cause instanceof Error && cause.message ? cause.message : t("modelHost.loadError"), loading: false });
    }
  }, [bot.id, enabled, bound, scope]);
  useEffect(() => {
    if (!enabled || !bound) return;
    void reload();
    const timer = setInterval(() => void reload(), 30_000);
    return () => { clearInterval(timer); request.current?.abort(); };
  }, [enabled, bound, reload]);
  const current = state.scope === scope && enabled && bound ? state : { sources: [], ready: false, error: "", loading: false };
  return { ...current, reload };
}
