import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { engineReady, providerName } from "@/components/EngineLibrary";
import { InstanceProviderMark } from "@/components/ProviderIcons";
import { Select } from "@/components/Select";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  defaultsChanged,
  defaultsPayload,
  parsePlan,
  providerDefaults,
  type PlanVia,
  type SharedAgentPlan,
} from "@/lib/shared-agents-plan";
import { api, useStore } from "@/state/store";
import { PrimaryButton, staggerIndex, type BeatProps } from "./shared";

const PLAN_PATH = "/api/origin/shared-agents/plan";

async function fetchPlan(): Promise<SharedAgentPlan | null> {
  return parsePlan(await api(PLAN_PATH, { timeoutMs: 10_000 }));
}

function viaLabel(via: Exclude<PlanVia, "none">): string {
  if (via === "intent") return t("onboarding.defaults.via.intent");
  if (via === "default") return t("onboarding.defaults.via.default");
  return t("onboarding.defaults.via.fallback");
}

export function DefaultsBeat({ onNext, setMascot, onSetUpModels }: BeatProps & { onSetUpModels: () => void }) {
  const { state } = useStore();
  const [plan, setPlan] = useState<SharedAgentPlan | null>(null);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    setMascot("thinking");
    const request = ++latest.current;
    fetchPlan()
      .then((next) => {
        if (request === latest.current) setPlan(next);
      })
      .catch(() => {});
    return () => {
      latest.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = useMemo(() => state.instances.filter(engineReady), [state.instances]);
  const saved = useMemo(() => plan?.defaults ?? {}, [plan]);
  const rowsWith = useCallback(
    (choices: Record<string, number>) =>
      providerDefaults(ready, saved).map((row) => ({ ...row, selected: choices[row.driverKind] ?? row.selected })),
    [ready, saved],
  );
  const rows = rowsWith(picked);

  const save = async (choices: Record<string, number>): Promise<boolean> => {
    if (!plan) return true;
    const defaults = defaultsPayload(rowsWith(choices), plan.defaults);
    if (!defaultsChanged(defaults, plan.defaults)) return true;
    const request = ++latest.current;
    setSaving(true);
    setError(false);
    try {
      await api("/api/origin/shared-agents/defaults", { method: "PUT", body: JSON.stringify({ defaults }), timeoutMs: 10_000 });
      const next = await fetchPlan();
      if (request === latest.current) {
        setPlan(next);
        setPicked({});
      }
      return true;
    } catch {
      if (request === latest.current) setError(true);
      return false;
    } finally {
      if (request === latest.current) setSaving(false);
    }
  };

  const pick = (driverKind: string, index: number) => {
    const next = { ...picked, [driverKind]: index };
    setPicked(next);
    void save(next);
  };

  const finish = async () => {
    if (rows.length === 0) return;
    if ((await save(picked)) || error) onNext();
  };

  return (
    <div className="flex min-h-0 flex-col">
      <p className="animate-rise mt-1 text-[13.5px] text-ink-secondary">{t("onboarding.defaults.intro")}</p>

      {rows.length === 0 ? (
        <div className="animate-rise mt-4 flex items-center justify-between gap-3 rounded-xl bg-card p-3.5" style={staggerIndex(1)}>
          <span className="text-[13.5px] text-ink">{t("onboarding.defaults.noModels")}</span>
          <button
            type="button"
            onClick={onSetUpModels}
            className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-raised-hover"
          >
            {t("onboarding.defaults.setUp")}
          </button>
        </div>
      ) : (
        <div
          className="animate-rise mt-4 divide-y divide-hairline/40 rounded-xl border border-hairline/40 bg-card"
          style={staggerIndex(1)}
        >
          {rows.map((row) => {
            const provider = providerName(row.instance);
            return (
              <div key={row.driverKind} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="flex size-[18px] shrink-0 items-center justify-center">
                  <InstanceProviderMark instance={row.instance} size={18} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{provider}</span>
                <Select
                  size="sm"
                  className="w-[260px] max-w-[55%]"
                  value={String(row.selected)}
                  disabled={saving}
                  aria-label={t("onboarding.defaults.provider", { provider })}
                  onChange={(event) => pick(row.driverKind, Number(event.target.value))}
                >
                  {row.options.map((option, index) => (
                    <option key={`${option.instanceId}:${option.model}`} value={index}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            );
          })}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{t("onboarding.defaults.saveError")}</p>}

      {plan && plan.bots.length > 0 && (
        <>
          <div className="animate-rise mt-5 text-[12px] font-medium text-ink-secondary" style={staggerIndex(2)}>
            {t("onboarding.defaults.bots")}
          </div>
          <div
            className="animate-rise mt-2 min-h-0 divide-y divide-hairline/40 overflow-y-auto rounded-xl border border-hairline/40 bg-card [scrollbar-width:thin]"
            style={staggerIndex(3)}
          >
            {plan.bots.map((bot) => (
              <div key={bot.botId} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-ink">{bot.name}</div>
                  {bot.intent && bot.via !== "intent" && (
                    <div className="truncate text-[11.5px] text-ink-secondary">
                      {t("onboarding.defaults.wants", { model: bot.intent.model })}
                    </div>
                  )}
                </div>
                {bot.via === "none" || !bot.resolved ? (
                  <button
                    type="button"
                    onClick={onSetUpModels}
                    className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[12.5px] text-warning transition-colors hover:bg-raised-hover"
                  >
                    {t("onboarding.defaults.setUp")}
                  </button>
                ) : (
                  <div className="flex min-w-0 shrink-0 items-center gap-2">
                    <span className="max-w-[220px] truncate text-[12.5px] text-ink">{bot.resolved.label}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        bot.via === "fallback" ? "bg-warning/15 text-warning" : "bg-raised text-ink-secondary",
                      )}
                    >
                      {viaLabel(bot.via)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <PrimaryButton onClick={() => void finish()} disabled={saving || rows.length === 0} className="mt-5">
        {t("onboarding.continue")}
      </PrimaryButton>
    </div>
  );
}
