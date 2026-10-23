import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Plus, X } from "lucide-react";
import { api, useStore, type Bot, type BotAnnouncement, type InstanceInfo } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { cn } from "@/lib/cn";
import { usePointerReorder } from "@/lib/use-pointer-reorder";
import { t } from "@/lib/i18n";
import { BotDailyApiBudgetField, parseDailyApiLimit, useDailyApiBudget } from "./DailyApiBudgetCard";
import { Select } from "./Select";
import { Switch } from "./SettingsPrimitives";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { modelPairKey } from "../../shared/model-selection";
import { sharedSourceLabel, useModelHostCatalog } from "@/lib/origin-model-hosts";
import { SharedModelChoices, SharedModelsStatus } from "./SharedModelChoices";

type Backup = NonNullable<Bot["fallback"]>[number];
type Draft = { fallback: Backup[]; quotaFallback: boolean; fallbackApiAllowed: boolean; dailyLimit: string };
export const fallbackKey = modelPairKey;

export function modelLabel(instance: InstanceInfo | undefined, model: string): string {
  return instance?.models.options.find(option => option.id === model)?.label ?? model;
}

export function moveFallback(values: readonly Backup[], from: number, to: number): Backup[] {
  if (from < 0 || to < 0 || from >= values.length || to >= values.length || from === to) return [...values];
  const result = [...values], [entry] = result.splice(from, 1);
  result.splice(to, 0, entry);
  return result;
}

export function paidApiInstance(instance: InstanceInfo): boolean {
  return instance.access === "api" || instance.snapshot.billing === "metered" || instance.snapshot.account?.method === "api-key";
}

export function ModelFallbackSettings({ bot, compact = false }: { bot: Bot; compact?: boolean }) {
  const { state, dispatch } = useStore();
  const owner = useOwnerOrAdmin();
  const { draft: creationDraft } = useBotEditor();
  const id = useId();
  const [open, setOpen] = useState(!compact);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const inFlight = useRef(false);
  const dirtyFields = useRef(new Set<keyof Draft>());
  const saveRequest = useRef<AbortController | null>(null);
  useEffect(() => () => saveRequest.current?.abort(), []);
  const budget = useDailyApiBudget(open && owner === true && !creationDraft);
  const catalog = useModelHostCatalog(bot, open && !creationDraft);
  const saved: Draft = { fallback: bot.fallback ?? [], quotaFallback: bot.quotaFallback === true, fallbackApiAllowed: bot.fallbackApiAllowed === true, dailyLimit: bot.dailyApiBudgetUsd === undefined ? "" : String(bot.dailyApiBudgetUsd) };
  const value = draft ?? saved;
  const disabled = saving || owner !== true;
  const change = (patch: Partial<Draft>) => { for (const field of Object.keys(patch) as Array<keyof Draft>) dirtyFields.current.add(field); setDraft({ ...value, ...patch }); setError(""); };
  const available = state.instances.filter(instance => instance.snapshot.state === "available" && instance.models.options.some(option => instance.snapshot.authenticated !== false || option.custom) && !instance.policy && (value.fallbackApiAllowed || !paidApiInstance(instance)));
  const engine = available.find(instance => instance.instanceId === provider);
  const choices = engine?.models.options.filter(option => (engine.snapshot.authenticated !== false || option.custom) && !value.fallback.some(entry => entry.instanceId === engine.instanceId && entry.model === option.id) && (engine.instanceId !== bot.modelSelection.instanceId || option.id !== bot.modelSelection.model)) ?? [];
  const labelOf = (entry: Backup) => {
    if (entry.source) {
      const source = catalog.sources.find(candidate => candidate.hostId === entry.source?.hostId && candidate.sourceId === entry.source?.sourceId);
      return `${source ? sharedSourceLabel(source) : t("modelHost.savedUnavailable")} · ${entry.model}`;
    }
    const instance = state.instances.find(candidate => candidate.instanceId === entry.instanceId);
    return `${instance?.displayName ?? entry.instanceId} · ${modelLabel(instance, entry.model)}`;
  };
  const move = (from: number, to: number) => {
    if (disabled || from < 0 || from >= value.fallback.length || from === to || to < 0 || to >= value.fallback.length) return;
    const next = moveFallback(value.fallback, from, to);
    change({ fallback: next });
    setAnnouncement(t("modelFallback.moved", { model: labelOf(next[to]), rank: to + 1 }));
  };
  const reorder = usePointerReorder(value.fallback.map(fallbackKey), disabled, (from, to) => move(value.fallback.findIndex(entry => fallbackKey(entry) === from), value.fallback.findIndex(entry => fallbackKey(entry) === to)));
  const save = async () => {
    if (!draft || inFlight.current || owner !== true) return;
    const dailyApiBudgetUsd = parseDailyApiLimit(draft.dailyLimit);
    if (dailyApiBudgetUsd === undefined) { setError(t("dailyApiBudget.invalid")); return; }
    inFlight.current = true; setSaving(true); setError("");
    const controller = new AbortController(); saveRequest.current = controller;
    const patch = {
      ...(dirtyFields.current.has("fallback") ? { fallback: draft.fallback } : {}),
      ...(dirtyFields.current.has("quotaFallback") ? { quotaFallback: draft.quotaFallback } : {}),
      ...(dirtyFields.current.has("fallbackApiAllowed") ? { fallbackApiAllowed: draft.fallbackApiAllowed } : {}),
      ...(dirtyFields.current.has("dailyLimit") ? { dailyApiBudgetUsd } : {}),
    };
    try {
      const response = await api<{ bot: BotAnnouncement }>(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify(patch), signal: controller.signal });
      if (controller.signal.aborted) return;
      dispatch({ type: "botPatched", bot: response.bot });
      dirtyFields.current.clear(); setDraft(null); budget.reload();
      setAnnouncement(t("modelFallback.saved"));
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : t("modelFallback.saveError"));
    } finally { if (saveRequest.current === controller) { saveRequest.current = null; inFlight.current = false; if (!controller.signal.aborted) setSaving(false); } }
  };
  if (creationDraft) return null;
  return (
    <section data-model-fallback-settings className={cn("min-w-0", compact ? "shrink-0 border-t border-hairline/40" : "rounded-xl bg-card p-4")}
      onKeyDown={reorder.onKeyDown}>
      {compact ? (
        <button type="button" aria-expanded={open} aria-controls={`${id}-content`} onClick={() => setOpen(current => !current)}
          className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left text-[12px] font-medium text-ink-secondary hover:bg-control/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
          <span>{t("modelFallback.title")}</span><ChevronDown size={13} className={cn("shrink-0", open && "rotate-180")} />
        </button>
      ) : <h3 className="text-[15px] font-medium text-ink">{t("modelFallback.title")}</h3>}
      {open && <div id={`${id}-content`} className={cn("flex min-w-0 flex-col gap-3", compact ? "max-h-[min(24rem,55dvh)] overflow-y-auto p-3" : "mt-2")}>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("modelFallback.help")}</p>
        {owner === false && <p className="text-[12px] text-ink-secondary">{t("dailyApiBudget.ownerOnly")}</p>}
        <ol ref={reorder.listRef} data-reorder-list className="flex min-w-0 flex-col gap-1" aria-label={t("modelFallback.order")}>
          {value.fallback.map((entry, index) => (
            <li key={fallbackKey(entry)} data-fallback-rank={index + 1} data-reorder-key={fallbackKey(entry)}
              className={cn("flex min-w-0 items-center gap-1 rounded-lg border bg-inset p-1.5", reorder.targetKey === fallbackKey(entry) ? "border-accent" : "border-transparent")}>
              <button type="button" {...reorder.handleProps(fallbackKey(entry))} disabled={disabled} aria-label={t("modelFallback.drag", { model: labelOf(entry) })}
                className="shrink-0 touch-none select-none cursor-grab rounded p-1.5 text-ink-secondary active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40"><GripVertical size={13} /></button>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-secondary">{index + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink" title={labelOf(entry)}>{labelOf(entry)}</span>
              <button type="button" disabled={disabled || index === 0} onClick={() => move(index, index - 1)} aria-label={t("modelFallback.up", { model: labelOf(entry) })} className="shrink-0 rounded p-1.5 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-30"><ArrowUp size={13} /></button>
              <button type="button" disabled={disabled || index === value.fallback.length - 1} onClick={() => move(index, index + 1)} aria-label={t("modelFallback.down", { model: labelOf(entry) })} className="shrink-0 rounded p-1.5 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-30"><ArrowDown size={13} /></button>
              <button type="button" disabled={disabled} onClick={() => change({ fallback: value.fallback.filter(candidate => fallbackKey(candidate) !== fallbackKey(entry)) })} aria-label={t("modelFallback.remove", { model: labelOf(entry) })} className="shrink-0 rounded p-1.5 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-30"><X size={13} /></button>
            </li>
          ))}
        </ol>
        {value.fallback.length === 0 && <p className="text-[12px] text-ink-secondary">{t("modelFallback.empty")}</p>}
        {value.fallback.length < 5 && <div className="grid min-w-0 gap-2">
          <Select size="sm" value={provider} disabled={disabled} aria-label={t("modelFallback.provider")} className="w-full min-w-0" onChange={event => { setProvider(event.target.value); setModel(""); }}>
            <option value="">{t("modelFallback.chooseProvider")}</option>
            {available.map(instance => <option key={instance.instanceId} value={instance.instanceId}>{instance.displayName}</option>)}
          </Select>
          <div className="flex min-w-0 items-center gap-2">
            <Select size="sm" value={model} disabled={disabled || !engine} aria-label={t("modelFallback.model")} className="min-w-0 flex-1" onChange={event => setModel(event.target.value)}>
              <option value="">{t("modelFallback.chooseModel")}</option>
              {choices.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </Select>
            <button type="button" disabled={disabled || !engine || !choices.some(option => option.id === model)} onClick={() => { if (engine && choices.some(option => option.id === model)) { change({ fallback: [...value.fallback, { instanceId: engine.instanceId, model }] }); setModel(""); } }} aria-label={t("modelFallback.add")} className="shrink-0 rounded-lg border border-hairline/50 p-2 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40"><Plus size={14} /></button>
          </div>
        </div>}
        {bot.shared && catalog.ready && value.fallback.length < 5 && <details className="min-w-0"><summary className="cursor-pointer rounded text-[12px] text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{t("modelHost.title")}</summary><div className="mt-2 grid min-w-0 gap-2">
          <SharedModelsStatus {...catalog} count={catalog.sources.length} />
          {!!catalog.sources.length && <SharedModelChoices sources={catalog.sources} excluded={[bot.modelSelection, ...value.fallback]} paidAllowed={value.fallbackApiAllowed} disabled={disabled} actionLabel={t("modelHost.addBackup")} onChoose={selection => change({ fallback: [...value.fallback, selection] })} />}
        </div></details>}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${id}-quota`} className="min-w-0 text-[12px] text-ink">{t("modelFallback.quota")}</label>
          <Switch id={`${id}-quota`} checked={value.quotaFallback} disabled={disabled} onClick={() => change({ quotaFallback: !value.quotaFallback })} />
        </div>
        <div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`${id}-api`} className="min-w-0 text-[12px] text-ink">{t("modelFallback.paid")}</label>
            <Switch id={`${id}-api`} checked={value.fallbackApiAllowed} disabled={disabled} aria-describedby={`${id}-charges`} onClick={() => { change({ fallbackApiAllowed: !value.fallbackApiAllowed }); setProvider(""); setModel(""); }} />
          </div>
          <p id={`${id}-charges`} className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("modelFallback.charges")}</p>
        </div>
        <BotDailyApiBudgetField value={value.dailyLimit} disabled={disabled} onChange={dailyLimit => change({ dailyLimit })} report={budget.report} botId={bot.id} />
        {budget.error && <p className="break-words text-[12px] text-ink-secondary">{t("dailyApiBudget.unavailable")}</p>}
        <div className="flex items-center gap-2">
          <button type="button" disabled={disabled || !draft} onClick={() => void save()} className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40">{t(saving ? "settings.threads.saving" : "common.save")}</button>
          {draft && <button type="button" disabled={saving} onClick={() => { dirtyFields.current.clear(); setDraft(null); setError(""); reorder.cancel(); }} className="rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{t("common.cancel")}</button>}
        </div>
        {error && <p role="alert" className="break-words text-[12px] text-danger">{error}</p>}
      </div>}
      <span role="status" className="sr-only">{announcement}</span>
    </section>
  );
}
