import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { ModelSelection } from "@/state/store";
import { t } from "@/lib/i18n";
import { sharedSelection, sharedSourceLabel, sharedSourceModels, type ModelHostSource } from "@/lib/origin-model-hosts";
import { Select } from "./Select";

export function SharedModelChoices({ sources, excluded = [], paidAllowed, disabled, onChoose, actionLabel }: {
  sources: ModelHostSource[]; excluded?: readonly ModelSelection[]; paidAllowed: boolean; disabled: boolean;
  onChoose: (selection: ModelSelection, source: ModelHostSource) => void; actionLabel: string;
}) {
  const [sourceKey, setSourceKey] = useState("");
  const [model, setModel] = useState("");
  const keyOf = (source: ModelHostSource) => JSON.stringify([source.hostId, source.sourceId]);
  const source = sources.find(candidate => keyOf(candidate) === sourceKey);
  const models = source ? sharedSourceModels(source, excluded, paidAllowed) : [];
  return <div className="grid min-w-0 gap-2">
    <Select size="sm" value={sourceKey} disabled={disabled} aria-label={t("modelHost.source")} className="w-full min-w-0" onChange={event => { setSourceKey(event.target.value); setModel(""); }}>
      <option value="">{t("modelHost.chooseSource")}</option>
      {sources.map(candidate => <option key={keyOf(candidate)} value={keyOf(candidate)} disabled={sharedSourceModels(candidate, excluded, paidAllowed).length === 0}>
        {sharedSourceLabel(candidate)} · {t(candidate.billing === "metered" ? "modelHost.metered" : candidate.billing === "subscription" ? "modelHost.subscription" : "modelHost.unknownBilling")}
      </option>)}
    </Select>
    <div className="flex min-w-0 gap-2">
      <Select size="sm" value={model} disabled={disabled || !models.length} aria-label={t("modelHost.model")} className="min-w-0 flex-1" onChange={event => setModel(event.target.value)}>
        <option value="">{t("modelFallback.chooseModel")}</option>
        {models.map(value => <option key={value} value={value}>{value}</option>)}
      </Select>
      <button type="button" disabled={disabled || !source || !models.includes(model)} aria-label={actionLabel}
        onClick={() => { if (source && sharedSourceModels(source, excluded, paidAllowed).includes(model)) { onChoose(sharedSelection(source, model), source); setModel(""); } }}
        className="shrink-0 rounded-lg border border-hairline/50 p-2 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40"><Plus size={14} /></button>
    </div>
    {source && <p className="break-words text-[11px] leading-relaxed text-ink-secondary">{t("modelHost.runsOn", { owner: source.ownerName, computer: source.computerName })} {t(source.billing === "metered" ? "modelHost.ownerCharged" : "modelHost.ownerPlan")}</p>}
  </div>;
}

export function SharedModelsStatus({ loading, error, count, reload }: { loading: boolean; error: string; count: number; reload: () => unknown }) {
  return <div className="flex min-w-0 items-start gap-2">
    <p role={loading ? "status" : undefined} className="min-w-0 flex-1 break-words text-[12px] leading-relaxed text-ink-secondary">{error || t(loading ? "modelHost.loading" : count ? "modelHost.help" : "modelHost.empty")}</p>
    <button type="button" disabled={loading} onClick={() => void reload()} aria-label={t("modelHost.refresh")}
      className="shrink-0 rounded p-1.5 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40"><RefreshCw size={13} /></button>
  </div>;
}
