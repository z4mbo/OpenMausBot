import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
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

function usageFill(used: number): string {
  return used >= 95 ? "bg-danger" : used >= 80 ? "bg-warning" : "bg-accent";
}

function WindowRow({ label, window, now }: { label: string; window: PlanWindow; now: number }) {
  const used = window.available && typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent) && window.usedPercent >= 0 ? window.usedPercent : null;
  const reset = window.available ? formatResetDistance(window.resetsAt, now) : null;
  return <div className="grid min-w-0 gap-1.5">
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <div className="min-w-0 text-[12.5px] leading-5 text-ink">
        <span className="break-words">{label}</span>
        {reset && <span className="text-[11.5px] text-ink-tertiary"> · {t("planUsage.resetsIn", { when: reset })}</span>}
      </div>
      <span className={cn("shrink-0 whitespace-nowrap text-[12px] tabular-nums", used === null ? "text-ink-tertiary" : "font-medium text-ink-secondary")}>
        {used === null ? t("chatUsage.notReported") : t("planUsage.used", { used: Math.round(used) })}
      </span>
    </div>
    {used !== null && <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, used))} className="h-1.5 overflow-hidden rounded-full bg-inset">
      <div className={cn("h-full rounded-full transition-[width] duration-500", usageFill(used))} style={{ width: `${Math.max(1.5, Math.min(100, used))}%` }} />
    </div>}
  </div>;
}

function ProviderWindows({ provider, now }: { provider: PlanProvider; now: number }) {
  return <div className="grid gap-4">
    <WindowRow label={t("chatUsage.session")} window={provider.fiveHour} now={now} />
    <div className="grid gap-3">
      <h3 className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">{t("chatUsage.weeklyLimits")}</h3>
      <WindowRow label={t("chatUsage.allModels")} window={provider.weekly} now={now} />
      {provider.models?.flatMap(model => model.windows.map((entry, index) => <WindowRow key={`${model.name}-${entry.label}-${index}`} label={entry.label === "Weekly" ? model.name : `${model.name} · ${windowLabel(entry.label)}`} window={{ ...entry, available: true }} now={now} />))}
    </div>
    {provider.extra.length > 0 && <div className="grid gap-3">{provider.extra.map((entry, index) => <WindowRow key={`${entry.label}-${index}`} label={windowLabel(entry.label)} window={{ ...entry, available: true }} now={now} />)}</div>}
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
      <div className="mb-3.5 flex min-w-0 items-center justify-between gap-2"><span className="truncate text-[12.5px] font-medium text-ink">{provider.name}</span>{provider.plan && <span className="min-w-0 max-w-[50%] truncate rounded-full bg-control px-2 py-0.5 text-[11px] font-medium text-ink">{provider.plan}</span>}</div>
      {provider.ok ? <ProviderWindows provider={provider} now={now} /> : <p title={provider.error || t("planUsage.fetchError")} className="text-[12px] text-ink-secondary">{t("chatUsage.unavailable")}</p>}
    </div>)}
    <div className="flex min-w-0 items-center justify-end gap-1.5 text-[11px] text-ink-tertiary">
      {fetchedAt && <span>{t("chatUsage.updated", { when: fetchedAt })}</span>}
      <button type="button" onClick={() => void load(true)} disabled={loading} aria-label={t("planUsage.refresh")} title={t("planUsage.refresh")} className="shrink-0 rounded-full p-1 text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40">{loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}</button>
    </div>
  </div>;
  return compact ? <section aria-label={t("chatUsage.limits")}>{content}</section> : <Card title={t("chatUsage.limits")}>{content}</Card>;
}
