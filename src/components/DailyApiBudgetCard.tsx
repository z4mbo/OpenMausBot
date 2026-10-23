import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { formatUsd } from "@/lib/usage";
import { t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";
import { Select } from "./Select";

export interface DailyApiBudgetReport {
  timeZone: string;
  day: string;
  resetsAt: string;
  spentUsd: number;
  reservedUsd: number;
  unknownCost: boolean;
  global?: { limitUsd: number; remainingUsd: number; exceeded: boolean };
  agents: Array<{ botId: string; spentUsd: number; reservedUsd: number; unknownCost: boolean; limitUsd?: number; remainingUsd?: number; exceeded: boolean }>;
}

export function parseDailyApiLimit(value: string): number | null | undefined {
  if (!value.trim()) return null;
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? number : undefined;
}

export function useDailyApiBudget(enabled: boolean) {
  const [report, setReport] = useState<DailyApiBudgetReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(current => current + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<DailyApiBudgetReport>("/api/daily-api-budget", { signal: controller.signal })
      .then(value => { if (current) setReport(value); })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : t("dailyApiBudget.loadError")); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [enabled, revision]);
  return { report, error, loading, reload };
}

function resetLabel(report: DailyApiBudgetReport): string {
  const date = new Date(report.resetsAt);
  try {
    return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { timeZone: report.timeZone, dateStyle: "medium", timeStyle: "short" }) : t("dailyApiBudget.resetUnknown");
  } catch { return t("dailyApiBudget.resetUnknown"); }
}

export function DailyApiBudgetStatus({ report, botId }: { report: DailyApiBudgetReport; botId?: string }) {
  const agent = botId ? report.agents.find(value => value.botId === botId) : undefined;
  if (botId && !agent) return <p className="text-[12px] text-ink-secondary">{t("dailyApiBudget.agentUnknown")}</p>;
  const spent = botId ? agent?.spentUsd ?? 0 : report.spentUsd;
  const reserved = botId ? agent?.reservedUsd ?? 0 : report.reservedUsd;
  const limited = Boolean(report.global) || agent?.limitUsd !== undefined;
  const blocked = report.global?.exceeded || agent?.exceeded;
  const unknown = botId ? agent?.unknownCost : report.unknownCost;
  return (
    <div className="min-w-0 text-[12px] leading-relaxed text-ink-secondary" data-daily-api-budget-status>
      <p>{t("dailyApiBudget.tracked", { spent: formatUsd(spent), reserved: formatUsd(reserved) })}</p>
      {report.global && <p>{t("dailyApiBudget.computerRemaining", { remaining: formatUsd(report.global.remainingUsd) })}</p>}
      {agent?.remainingUsd !== undefined && <p>{t("dailyApiBudget.agentRemaining", { remaining: formatUsd(agent.remainingUsd) })}</p>}
      {limited && <p>{t("dailyApiBudget.resets", { when: resetLabel(report), zone: report.timeZone })}</p>}
      {unknown && <p className="mt-1 text-warning">{t("dailyApiBudget.unknownReserved")}</p>}
      {blocked && <p role="status" className="mt-1 text-warning">{t("dailyApiBudget.reached")}</p>}
    </div>
  );
}

export function BotDailyApiBudgetField({ value, onChange, disabled, report, botId }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  report: DailyApiBudgetReport | null;
  botId: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0 border-t border-hairline/40 pt-3">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">{t("dailyApiBudget.agentTitle")}</label>
      <input id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} inputMode="decimal"
        placeholder={t("dailyApiBudget.agentPlaceholder")} aria-describedby={`${id}-help`}
        className="mt-2 w-full min-w-0 rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50" />
      <p id={`${id}-help`} className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("dailyApiBudget.agentHelp")}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("dailyApiBudget.coverage")}</p>
      {report && <div className="mt-2"><DailyApiBudgetStatus report={report} botId={botId} /></div>}
    </div>
  );
}

export function DailyApiBudgetCard() {
  const { state, dispatch } = useStore();
  const owner = useOwnerOrAdmin();
  const saved = state.config?.dailyApiBudget;
  const [draft, setDraft] = useState<{ limit: string; timeZone: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const saveRequest = useRef<AbortController | null>(null);
  useEffect(() => () => saveRequest.current?.abort(), []);
  const budget = useDailyApiBudget(owner === true);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const value = draft ?? { limit: saved === undefined ? "" : String(saved.limitUsd), timeZone: saved?.timeZone ?? localZone };
  const zones = [...new Set(["UTC", value.timeZone, localZone, ...Intl.supportedValuesOf("timeZone")])];
  const change = (patch: Partial<typeof value>) => { setDraft({ ...value, ...patch }); setError(""); };
  const save = async () => {
    if (!draft || inFlight.current || owner !== true) return;
    const limitUsd = parseDailyApiLimit(draft.limit);
    if (limitUsd === undefined) { setError(t("dailyApiBudget.invalid")); return; }
    inFlight.current = true; setSaving(true); setError("");
    const controller = new AbortController(); saveRequest.current = controller;
    try {
      const config = await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ dailyApiBudget: limitUsd === null ? null : { limitUsd, timeZone: draft.timeZone } }), signal: controller.signal });
      if (controller.signal.aborted) return;
      dispatch({ type: "configStatus", config });
      setDraft(null); budget.reload();
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : t("dailyApiBudget.saveError"));
    } finally { if (saveRequest.current === controller) { saveRequest.current = null; inFlight.current = false; if (!controller.signal.aborted) setSaving(false); } }
  };
  return (
    <Card title={t("dailyApiBudget.title")} subtitle={t("dailyApiBudget.scope")}>
      <div className="mb-3 flex items-start justify-between gap-2">
        {budget.report ? <DailyApiBudgetStatus report={budget.report} /> : <p role="status" className="text-[12px] text-ink-secondary">{t(budget.loading ? "dailyApiBudget.loading" : "dailyApiBudget.unavailable")}</p>}
        <button type="button" onClick={budget.reload} disabled={budget.loading || owner !== true} aria-label={t("dailyApiBudget.refresh")}
          className="shrink-0 rounded-md p-1.5 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">
          {budget.loading ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : <RefreshCw size={14} />}
        </button>
      </div>
      <form className="grid min-w-0 gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="min-w-0 text-[12px] text-ink-secondary">{t("dailyApiBudget.amount")}
          <input value={value.limit} onChange={event => change({ limit: event.target.value })} inputMode="decimal" placeholder={t("dailyApiBudget.disabled")}
            aria-label={t("dailyApiBudget.amount")} disabled={saving || owner !== true}
            className="mt-1 w-full min-w-0 rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50" />
        </label>
        <label className="min-w-0 text-[12px] text-ink-secondary">{t("dailyApiBudget.timeZone")}
          <Select value={value.timeZone} onChange={event => change({ timeZone: event.target.value })} aria-label={t("dailyApiBudget.timeZone")}
            disabled={saving || owner !== true} className="mt-1 w-full min-w-0">
            {zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}
          </Select>
        </label>
        <p className="text-[12px] leading-relaxed text-ink-secondary sm:col-span-2">{t("dailyApiBudget.help")}</p>
        <p className="text-[12px] leading-relaxed text-ink-secondary sm:col-span-2">{t("dailyApiBudget.coverage")}</p>
        <button type="submit" disabled={!draft || saving || owner !== true}
          className="justify-self-start rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">{t(saving ? "settings.threads.saving" : "common.save")}</button>
      </form>
      {owner === false && <p className="mt-2 text-[12px] text-ink-secondary">{t("dailyApiBudget.ownerOnly")}</p>}
      {(error || budget.error) && <p role="alert" className="mt-2 break-words text-[12px] text-danger">{error || budget.error}</p>}
    </Card>
  );
}
