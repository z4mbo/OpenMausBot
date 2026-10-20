import { useState, type ReactNode } from "react";
import { ArrowRight, Bot as BotIcon, CircleDot, Rocket, Target } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { setChiefSectionOf, type ChiefSection } from "@/lib/origin-chief-section";
import { cn } from "@/lib/cn";
import { useStore } from "@/state/store";
import { useProjectJourney } from "@/lib/origin-journey";
import { JourneyStrip, NextStepCard } from "../origin-journey/NextStep";
import { formatLeadValue } from "../../../shared/origin-pipeline";
import { attentionLabel, formatCompact, formatHours, formatUsd, type PulseCount, type PulseRange } from "../../../shared/origin-pulse";
import { CloudGate, Loading, Notice, PageHeader, Segmented, cardClass, pageClass, type OriginPageProps } from "../origin-pages/ui";
import { BudgetMeter, DayBars, StageBars } from "./PulseCharts";
import { ATTENTION_SECTION, deltaText, type ProjectPulse } from "./pulse-model";

export const RANGE_OPTIONS = [{ value: "7", label: "7d", title: "Last 7 days" }, { value: "30", label: "30d", title: "Last 30 days" }] as const;

export function PulsePage({ botId, ...props }: OriginPageProps & { botId: string }) {
  return <CloudGate {...props} label="Pulse">{({ projectId }) => <Pulse projectId={projectId} botId={botId} go={(section) => setChiefSectionOf(botId, section)} />}</CloudGate>;
}

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

function Pulse({ projectId, botId, go }: { projectId: string; botId: string; go(section: ChiefSection): void }) {
  const [range, setRange] = useState<PulseRange>(7);
  const pulse = useCloudQuery<ProjectPulse>("pulse:project", { projectId, range });
  const journey = useProjectJourney(projectId);
  const chief = useStore().state.bots.find((bot) => bot.id === botId);
  return (
    <section className={pageClass} aria-label="Pulse">
      <PageHeader title="Pulse">
        <Segmented label="Range" value={String(range) as "7" | "30"} options={RANGE_OPTIONS} onChange={(value) => setRange(Number(value) as PulseRange)} />
      </PageHeader>
      {!pulse || !journey ? <Loading label="Loading the project's pulse" variant="grid" /> : (
        <div className="flex flex-col gap-3">
          <JourneyStrip journey={journey} go={go} />
          {chief && <NextStepCard chief={chief} step={journey.step} />}
          {pulse.attention.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Needs attention">
              {pulse.attention.map((item) => (
                <button key={item.kind} type="button" onClick={() => go(ATTENTION_SECTION[item.kind])}
                  className={cn("flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors duration-(--motion-fast)", focusRing,
                    item.tone === "danger" ? "bg-danger/10 text-danger hover:bg-danger/15" : "bg-warning/10 text-warning hover:bg-warning/15")}>
                  <span aria-hidden="true" className={cn("size-1.5 rounded-full", item.tone === "danger" ? "bg-danger" : "bg-warning")} />
                  {attentionLabel(item, pulse.team.budgetLevel)}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <BuildCard pulse={pulse} go={go} />
            <LaunchCard pulse={pulse} go={go} />
            <GrowCard pulse={pulse} go={go} />
            <TeamCard pulse={pulse} go={go} />
          </div>
          {pulse.truncated && <Notice>This project has more activity than Pulse reads at once, so some counts may be low.</Notice>}
        </div>
      )}
    </section>
  );
}

function Card({ icon, title, section, linkLabel, go, children }: { icon: ReactNode; title: string; section: ChiefSection; linkLabel: string; go(section: ChiefSection): void; children: ReactNode }) {
  return (
    <section className={cn(cardClass, "flex flex-col gap-3 p-3.5")} aria-label={title}>
      <header className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-raised text-ink-secondary" aria-hidden="true">{icon}</span>
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        <button type="button" onClick={() => go(section)}
          className={cn("group ml-auto flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-ink-secondary transition-colors duration-(--motion-fast) hover:bg-raised/60 hover:text-ink", focusRing)}>
          {linkLabel}<ArrowRight size={13} aria-hidden="true" className="transition-transform duration-(--motion-fast) group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </button>
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, count, range, hint }: { label: string; value: string; count?: PulseCount; range?: number; hint?: string }) {
  const delta = count && range ? deltaText(count, range) : null;
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11.5px] text-ink-tertiary">{label}</dt>
      <dd className="m-0 flex items-baseline gap-1.5">
        <span className="text-[20px] font-semibold leading-7 tabular-nums tracking-[-0.01em] text-ink">{value}</span>
        {delta && <span className="text-[11.5px] tabular-nums text-ink-tertiary" title={delta.title}>{delta.text}<span className="sr-only"> against {delta.title}</span></span>}
        {hint && <span className="truncate text-[11.5px] text-ink-tertiary">{hint}</span>}
      </dd>
    </div>
  );
}

const Stats = ({ children }: { children: ReactNode }) => <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">{children}</dl>;

function Hint({ children, action, onAction }: { children: ReactNode; action: string; onAction(): void }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-inset/60 px-3 py-2 text-[12.5px] text-ink-secondary">
      {children}
      <button type="button" onClick={onAction} className={cn("rounded font-medium text-accent-text hover:underline", focusRing)}>{action}</button>
    </p>
  );
}

const n = (value: number) => value.toLocaleString();

function BuildCard({ pulse, go }: { pulse: ProjectPulse; go(section: ChiefSection): void }) {
  const { build, range, days } = pulse;
  return (
    <Card icon={<CircleDot size={15} />} title="Build" section="issues" linkLabel="Issues" go={go}>
      <Stats>
        <Stat label="Done" value={n(build.done.value)} count={build.done} range={range} />
        <Stat label="Opened" value={n(build.opened.value)} count={build.opened} range={range} />
        <Stat label="Open now" value={n(build.open)} />
        <Stat label="Cycle time" value={formatHours(build.cycleHours)} hint={build.cycleHours === null ? undefined : "median"} />
      </Stats>
      {pulse.reached.build
        ? <DayBars label="Issues done per day" values={build.doneSeries} days={days} />
        : <Hint action="Open Issues" onAction={() => go("issues")}>No issues outside Draft yet.</Hint>}
      <button type="button" onClick={() => go("repo")} disabled={!build.prsWaiting}
        className={cn("flex items-center gap-2 rounded-lg px-1 text-left text-[12.5px] text-ink-secondary enabled:hover:text-ink", focusRing)}>
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", build.prsWaiting ? "bg-warning" : "bg-ink-tertiary/50")} />
        {build.prsWaiting
          ? `${n(build.prsWaiting)} ${build.prsWaiting === 1 ? "pull request waits" : "pull requests wait"} for a person${build.prsApproved ? ` · ${n(build.prsApproved)} approved, ready to merge` : ""}`
          : "No pull requests waiting"}
      </button>
    </Card>
  );
}

function LaunchCard({ pulse, go }: { pulse: ProjectPulse; go(section: ChiefSection): void }) {
  const { launch, range, days } = pulse;
  const engaged = launch.engagement.likes + launch.engagement.reposts + launch.engagement.replies;
  return (
    <Card icon={<Rocket size={15} />} title="Launch" section="broadcast" linkLabel="Broadcast" go={go}>
      <Stats>
        <Stat label="Pages live" value={n(launch.pagesLive)} hint={launch.viewsTotal ? `${formatCompact(launch.viewsTotal)} views all time` : undefined} />
        <Stat label="Views" value={formatCompact(launch.views.value)} count={launch.views} range={range} />
        <Stat label="Posts published" value={n(launch.posts.value)} count={launch.posts} range={range} hint={launch.postsScheduled ? `${n(launch.postsScheduled)} scheduled` : undefined} />
        <Stat label="Engagement" value={formatCompact(engaged)}
          hint={launch.engagement.impressions ? `${formatCompact(launch.engagement.impressions)} seen` : undefined} />
      </Stats>
      {pulse.reached.launch ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <DayBars label="Page views per day" values={launch.viewsSeries} days={days} format={formatCompact} />
          <DayBars label="Posts per day" values={launch.postsSeries} days={days} />
        </div>
      ) : <Hint action="Open Canvas" onAction={() => go("draw")}>Publish a page from Canvas or a post from Broadcast to launch.</Hint>}
      {engaged > 0 && <p className="text-[11.5px] text-ink-tertiary">Likes, reposts and replies on {n(launch.engagement.posts)} campaign {launch.engagement.posts === 1 ? "post" : "posts"} published in range, as last refreshed.</p>}
    </Card>
  );
}

function GrowCard({ pulse, go }: { pulse: ProjectPulse; go(section: ChiefSection): void }) {
  const { grow, range, days } = pulse;
  const money = (value: number) => formatLeadValue(value, grow.currency);
  return (
    <Card icon={<Target size={15} />} title="Sell" section="pipeline" linkLabel="Sales" go={go}>
      <Stats>
        <Stat label="New leads" value={n(grow.leads.value)} count={grow.leads} range={range} />
        <Stat label="Revenue" value={money(grow.revenue.value)} count={grow.revenue} range={range} hint={`${n(grow.won.value)} won`} />
        <Stat label="Conversion" value={grow.conversion === null ? "–" : `${Math.round(grow.conversion * 100)}%`} hint={grow.total ? `of ${n(grow.total)}` : undefined} />
        <Stat label="Open pipeline" value={money(grow.pipelineValue)} />
      </Stats>
      {pulse.reached.grow ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <StageBars rows={grow.stages} format={money} />
          <DayBars label="New leads per day" values={grow.leadsSeries} days={days} />
        </div>
      ) : <Hint action="Open Sales" onAction={() => go("pipeline")}>Leads from a page's form, an import or an agent show here.</Hint>}
      {(grow.leadsAwaiting > 0 || grow.draftsAwaiting > 0) && (
        <button type="button" onClick={() => go("pipeline")} className={cn("flex items-center gap-2 rounded-lg px-1 text-left text-[12.5px] text-ink-secondary hover:text-ink", focusRing)}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
          {[grow.leadsAwaiting && `${n(grow.repliesAwaiting)} unread ${grow.repliesAwaiting === 1 ? "reply" : "replies"} from ${n(grow.leadsAwaiting)} ${grow.leadsAwaiting === 1 ? "lead" : "leads"}`,
            grow.draftsAwaiting && `${n(grow.draftsAwaiting)} agent ${grow.draftsAwaiting === 1 ? "draft" : "drafts"} to approve`].filter(Boolean).join(" · ")}
        </button>
      )}
    </Card>
  );
}

function TeamCard({ pulse, go }: { pulse: ProjectPulse; go(section: ChiefSection): void }) {
  const { team, range, days } = pulse;
  return (
    <Card icon={<BotIcon size={15} />} title="Team" section="agents" linkLabel="Agents" go={go}>
      <Stats>
        <Stat label="Agent runs" value={n(team.runs.value)} count={team.runs} range={range} hint={team.live ? `${n(team.live)} live` : undefined} />
        <Stat label="Succeeded" value={n(team.succeeded)} hint={team.failed ? `${n(team.failed)} failed` : undefined} />
        <Stat label="Agents active" value={n(team.agents)} hint={team.approvalsWaiting ? `${n(team.approvalsWaiting)} need approval` : undefined} />
        <Stat label="Spend" value={formatUsd(team.spendRangeUsd)} />
      </Stats>
      {team.runs.value + team.runs.previous > 0
        ? <DayBars label="Agent runs per day" values={team.runsSeries} days={days} />
        : <Hint action="Open Agents" onAction={() => go("agents")}>No agent has run in this project yet.</Hint>}
      {team.budgetUsd !== null
        ? <BudgetMeter spent={team.spendMonthUsd} budget={team.budgetUsd} level={team.budgetLevel} format={formatUsd} />
        : <p className="text-[11.5px] tabular-nums text-ink-tertiary">{formatUsd(team.spendMonthUsd)} spent this month · no budget set</p>}
    </Card>
  );
}
