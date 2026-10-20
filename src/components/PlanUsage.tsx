import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";

interface PlanWindow {
  available: boolean;
  remainingPercent: number | null;
  usedPercent: number | null;
  resetsAt: string | null;
}

interface PlanExtra {
  label: string;
  remainingPercent: number;
  usedPercent: number;
  resetsAt: string | null;
}

interface PlanModelUsage {
  name: string;
  windows: PlanExtra[];
}

interface PlanProvider {
  id: string;
  name: string;
  driver: string;
  plan: string | null;
  ok: boolean;
  error: string | null;
  fiveHour: PlanWindow;
  weekly: PlanWindow;
  extra: PlanExtra[];
  models?: PlanModelUsage[];
}

interface PlanUsageReport {
  fetchedAt: string;
  providers: PlanProvider[];
}

function formatResetDistance(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at) || at <= now) return null;
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes < 1) return "less than a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

function dueResetDeadlines(report: PlanUsageReport, now: number, seen: Set<string>): string[] {
  const due: string[] = [];
  for (const provider of report.providers) {
    if (!provider.ok) continue;
    const stamps = [
      provider.fiveHour.available ? provider.fiveHour.resetsAt : null,
      provider.weekly.available ? provider.weekly.resetsAt : null,
      ...provider.extra.map((extra) => extra.resetsAt),
      ...(provider.models ?? []).flatMap((model) => model.windows.map((entry) => entry.resetsAt)),
    ];
    for (const resetsAt of stamps) {
      if (!resetsAt || seen.has(resetsAt) || due.includes(resetsAt)) continue;
      const at = Date.parse(resetsAt);
      if (Number.isFinite(at) && at <= now) due.push(resetsAt);
    }
  }
  return due;
}

function windowLabel(label: string): string {
  if (label === "5-hour") return t("planUsage.fiveHour");
  if (label === "Weekly") return t("planUsage.weekly");
  return label;
}

function WindowRow({ label, window, now }: { label: string; window: PlanWindow; now: number }) {
  const used = window.available && typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent) && window.usedPercent >= 0 ? window.usedPercent : null;
  const reset = window.available ? formatResetDistance(window.resetsAt, now) : null;
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(2rem,1fr)_auto] items-center gap-x-2">
    <div className="min-w-0"><div className="break-words text-[12px] text-ink">{label}</div>{reset && <div className="mt-0.5 break-words text-[11px] text-ink-secondary">{t("planUsage.resetsIn", { when: reset })}</div>}</div>
    {used !== null ? <><div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, used))} className="h-1.5 overflow-hidden rounded-full bg-inset"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, used)}%` }} /></div><span className="whitespace-nowrap text-[11px] tabular-nums text-ink-secondary">{t("planUsage.used", { used: Math.round(used) })}</span></> : <span className="col-span-2 text-right text-[11px] text-ink-secondary">{t("chatUsage.notReported")}</span>}
  </div>;
}

function ProviderWindows({ provider, now }: { provider: PlanProvider; now: number }) {
  return <div className="grid gap-3">
    <WindowRow label={t("chatUsage.session")} window={provider.fiveHour} now={now} />
    <div className="border-t border-hairline/40 pt-2.5"><h3 className="mb-2 text-[12px] font-medium text-ink">{t("chatUsage.weeklyLimits")}</h3><div className="grid gap-3">
      <WindowRow label={t("chatUsage.allModels")} window={provider.weekly} now={now} />
      {provider.models?.flatMap(model => model.windows.map((entry, index) => <WindowRow key={`${model.name}-${entry.label}-${index}`} label={entry.label === "Weekly" ? model.name : `${model.name} · ${windowLabel(entry.label)}`} window={{ ...entry, available: true }} now={now} />))}
    </div></div>
    {provider.extra.length > 0 && <div className="grid gap-3 border-t border-hairline/40 pt-2.5">{provider.extra.map((entry, index) => <WindowRow key={`${entry.label}-${index}`} label={windowLabel(entry.label)} window={{ ...entry, available: true }} now={now} />)}</div>}
  </div>;
}

export function PlanUsage({ providerId, compact = false }: { providerId?: string; compact?: boolean }) {
  const [report, setReport] = useState<PlanUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const refreshedDeadlines = useRef(new Set<string>());
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (refresh = false) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true);
    setError("");
    try {
      const data = await api<PlanUsageReport>(refresh ? "/api/plan-usage?refresh=1" : "/api/plan-usage", { signal: controller.signal });
      if (controller.signal.aborted) return;
      setReport(data);
      setNow(Date.now());
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error && cause.message ? cause.message : t("planUsage.fetchError"));
    } finally {
      if (!controller.signal.aborted && request.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    return () => request.current?.abort();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!report) return;
    const due = dueResetDeadlines(report, now, refreshedDeadlines.current);
    if (due.length === 0) return;
    for (const deadline of due) refreshedDeadlines.current.add(deadline);
    void load(true);
  }, [report, now, load]);

  const providers = report?.providers.filter(provider => !providerId || provider.id === providerId) ?? [];
  const fetchedAt = report?.fetchedAt && Number.isFinite(Date.parse(report.fetchedAt)) ? new Date(report.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const content = <div className="grid min-w-0 gap-3">
    {loading && !report ? <p role="status" className="text-[12px] text-ink-secondary">{t("planUsage.loading")}</p> : error || providers.length === 0 ? <p title={error || undefined} className="text-[12px] text-ink-secondary">{t("chatUsage.unavailable")}</p> : providers.map(provider => <div key={provider.id} className="min-w-0 border-t border-hairline/40 pt-3 first:border-0 first:pt-0">
      <div className="mb-3 flex min-w-0 items-baseline justify-between gap-2"><span className="truncate text-[12px] font-medium text-ink">{provider.name}</span>{provider.plan && <span className="truncate text-[11px] text-ink-secondary">{provider.plan}</span>}</div>
      {provider.ok ? <ProviderWindows provider={provider} now={now} /> : <p title={provider.error || t("planUsage.fetchError")} className="text-[12px] text-ink-secondary">{t("chatUsage.unavailable")}</p>}
    </div>)}
    <div className="flex min-w-0 items-center justify-end gap-2 text-[10px] text-ink-secondary">
      {fetchedAt && <span>{t("chatUsage.updated", { when: fetchedAt })}</span>}
      <button type="button" onClick={() => void load(true)} disabled={loading} aria-label={t("planUsage.refresh")} title={t("planUsage.refresh")} className="shrink-0 rounded p-1 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40">{loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}</button>
    </div>
  </div>;
  return compact ? <section aria-label={t("chatUsage.limits")}>{content}</section> : <Card title={t("chatUsage.limits")}>{content}</Card>;
}
