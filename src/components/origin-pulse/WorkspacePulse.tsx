import { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { useCloudLinks } from "@/lib/origin-cloud-links";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { projectBotFor } from "@/lib/origin-issue-focus";
import { openOriginPage } from "@/lib/origin-pages";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot } from "@/state/thread-navigation";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { formatLeadValue } from "../../../shared/origin-pipeline";
import { PULSE_STAGE_LABEL, attentionLabel, formatCompact, formatUsd, type PulseRange } from "../../../shared/origin-pulse";
import { Segmented, Skeleton } from "../origin-pages/ui";
import { DayBars } from "./PulseCharts";
import { RANGE_OPTIONS } from "./PulsePage";
import { orderByAttention, type ProjectPulse } from "./pulse-model";

type ProjectRow = { _id: string; name: string; accent: string };

function useOpenProjectPulse(): (projectId: string) => (() => void) | null {
  const { state, dispatch } = useStore();
  const { projects } = useCloudLinks();
  const showThreads = useShowThreads();
  return (projectId) => {
    const botId = projectBotFor(projects, state.bots, projectId);
    const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
    if (!bot) return null;
    return () => {
      setChiefSectionOf(bot.id, "pulse");
      openOriginPage(null);
      openBot(dispatch, bot, showThreads);
    };
  };
}

/** One row per project the person can open, with what the boss needs to see first: the projects with the most waiting come first. */
export function WorkspacePulse({ teamId }: { teamId: string }) {
  const [range, setRange] = useState<PulseRange>(7);
  const list = useCloudQuery<{ projects: ProjectRow[]; truncated: boolean }>("pulse:projects", { teamId });
  const [loaded, setLoaded] = useState<ReadonlyMap<string, ProjectPulse>>(new Map());
  const report = useCallback((pulse: ProjectPulse) => setLoaded((current) => current.get(pulse.projectId) === pulse ? current : new Map(current).set(pulse.projectId, pulse)), []);
  const open = useOpenProjectPulse();
  if (!list?.projects.length) return null;
  const byId = new Map(list.projects.map((project) => [project._id, project]));
  const settled = list.projects.every((project) => loaded.get(project._id)?.range === range);
  const order = settled ? orderByAttention(list.projects, loaded) : list.projects.map((project) => project._id);
  return (
    <section aria-labelledby="workspace-pulse" className="rounded-xl border border-hairline/40 bg-panel p-1.5">
      <header className="flex flex-wrap items-center gap-2 px-2.5 pb-1.5 pt-1.5">
        <h2 id="workspace-pulse" className="text-[13px] font-semibold text-ink">Pulse</h2>
        <span className="text-[12px] text-ink-tertiary">Projects with the most waiting first</span>
        <div className="ml-auto"><Segmented label="Range" value={String(range) as "7" | "30"} options={RANGE_OPTIONS} onChange={(value) => setRange(Number(value) as PulseRange)} /></div>
      </header>
      <ul className="flex flex-col">
        {order.map((id) => <Row key={id} project={byId.get(id)!} range={range} onLoad={report} open={open(id)} />)}
      </ul>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-ink-tertiary">{label}</dt>
      <dd className={cn("m-0 truncate text-[13px] font-medium tabular-nums", tone === "warn" ? "text-warning" : "text-ink")}>{value}</dd>
    </div>
  );
}

function Row({ project, range, onLoad, open }: { project: ProjectRow; range: PulseRange; onLoad(pulse: ProjectPulse): void; open: (() => void) | null }) {
  const pulse = useCloudQuery<ProjectPulse>("pulse:project", { projectId: project._id, range });
  useEffect(() => { if (pulse) onLoad(pulse); }, [pulse, onLoad]);
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-2 md:w-44 md:shrink-0">
        <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: project.accent }} aria-hidden="true" />
        {open
          ? <button type="button" onClick={(event) => { event.stopPropagation(); open(); }} title={`Open ${project.name}'s pulse`}
              className="truncate rounded text-[13px] font-semibold text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/60">{project.name}</button>
          : <strong className="truncate text-[13px] font-semibold text-ink">{project.name}</strong>}
        {pulse && <span className="shrink-0 rounded-full bg-raised px-2 py-px text-[11px] text-ink-secondary">{PULSE_STAGE_LABEL[pulse.stage]}</span>}
        {open && <ChevronRight size={14} aria-hidden="true" className="ml-auto shrink-0 text-ink-tertiary md:hidden" />}
      </div>
      {!pulse ? <Skeleton className="h-9 flex-1" /> : (
        <>
          <DayBars compact className="w-full md:w-32 md:shrink-0" height={24} label="Issues done per day" values={pulse.build.doneSeries} days={pulse.days} color={project.accent} />
          <dl className="m-0 grid min-w-0 flex-1 grid-cols-3 gap-x-3 gap-y-1 sm:grid-cols-6">
            <Metric label="Done" value={pulse.build.done.value.toLocaleString()} />
            <Metric label="PRs waiting" value={pulse.build.prsWaiting.toLocaleString()} tone={pulse.build.prsWaiting ? "warn" : undefined} />
            <Metric label="Views" value={formatCompact(pulse.launch.views.value)} />
            <Metric label="New leads" value={pulse.grow.leads.value.toLocaleString()} />
            <Metric label="Open sales" value={formatLeadValue(pulse.grow.pipelineValue, pulse.grow.currency)} />
            <Metric label="Spend" value={pulse.team.budgetUsd !== null ? `${formatUsd(pulse.team.spendMonthUsd)} / ${formatUsd(pulse.team.budgetUsd)}` : formatUsd(pulse.team.spendMonthUsd)}
              tone={pulse.team.budgetLevel === "ok" ? undefined : "warn"} />
          </dl>
          {pulse.attention.length === 0 ? <span className="hidden md:block md:w-44 md:shrink-0" /> : (
            <ul className="flex flex-wrap gap-1 md:w-44 md:shrink-0 md:justify-end" aria-label="Needs attention">
              {pulse.attention.map((item) => (
                <li key={item.kind} className={cn("rounded-full px-2 py-px text-[11px] font-medium", item.tone === "danger" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning")}>
                  {attentionLabel(item, pulse.team.budgetLevel)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
  const layout = "flex w-full min-w-0 flex-col gap-2 rounded-lg px-2.5 py-2.5 text-left md:flex-row md:items-center md:gap-4";
  return (
    <li className="border-t border-hairline/30 first:border-t-0" data-pulse-project={project._id}>
      <div onClick={open ?? undefined} className={cn(layout, open && "cursor-pointer transition-colors duration-(--motion-fast) hover:bg-raised/40")}>{body}</div>
    </li>
  );
}
