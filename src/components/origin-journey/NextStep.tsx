import { ArrowRight, Check, Sparkles, X } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { setChiefSectionOf, type ChiefSection } from "@/lib/origin-chief-section";
import { handOff } from "@/lib/origin-handoff";
import { useShowThreads } from "@/lib/thread-preferences";
import { useStepDismissed, type ProjectJourney } from "@/lib/origin-journey";
import { cn } from "@/lib/cn";
import { JOURNEY_PHASES, JOURNEY_PHASE_LABEL, phasesDone, type JourneyFacts, type JourneyPhase, type JourneyStep } from "../../../shared/origin-journey";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const openButton = `group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[12.5px] font-medium text-accent-ink transition-[opacity,transform] duration-(--motion-fast) hover:opacity-90 active:scale-[0.98] ${focusRing}`;
const askButton = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-ink-secondary transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink ${focusRing}`;

function useStepActions(chief: Bot, step: JourneyStep) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  return {
    open: () => setChiefSectionOf(chief.id, step.section as ChiefSection),
    ask: () => handOff(dispatch, chief, step.brief, showThreads),
  };
}

function Actions({ chief, step, here }: { chief: Bot; step: JourneyStep; here: boolean }) {
  const actions = useStepActions(chief, step);
  return (
    <>
      {!here && (
        <button type="button" className={openButton} onClick={actions.open}>
          {step.action}<ArrowRight size={13} aria-hidden="true" className="transition-transform duration-(--motion-fast) group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </button>
      )}
      <button type="button" className={askButton} onClick={actions.ask} title={`Hand this step to ${chief.name}`} aria-label={`Hand this step to ${chief.name}`}>
        <Sparkles size={14} aria-hidden="true" /><span className="max-w-[12rem] truncate">Ask {chief.name}</span>
      </button>
    </>
  );
}

/** The one-line next step under the project bar; `here` is the section the person is on. */
export function NextStepStrip({ chief, projectId, journey, here }: { chief: Bot; projectId: string; journey: ProjectJourney; here: ChiefSection }) {
  const { step } = journey;
  const [hidden, dismiss] = useStepDismissed(projectId, step.id);
  if (hidden) return null;
  return (
    <section aria-label="Next step" data-next-step={step.id}
      className="mx-3 mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-hairline/40 bg-panel/80 py-1 pl-3 pr-1 motion-safe:animate-[rise_var(--motion-base)_var(--ease-out)_backwards]">
      <span className="shrink-0 rounded-md bg-accent/12 px-1.5 py-px text-[11px] font-semibold text-accent-text">{JOURNEY_PHASE_LABEL[step.phase]}</span>
      <p className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-[13px] font-medium text-ink">{step.title}</span>
        <span className="truncate text-[12.5px] text-ink-tertiary max-lg:hidden">{step.detail}</span>
      </p>
      <div className="flex shrink-0 items-center gap-1 max-sm:order-last max-sm:w-full max-sm:pb-1">
        <Actions chief={chief} step={step} here={here === step.section} />
      </div>
      <button type="button" onClick={dismiss} aria-label="Hide this step" title="Hide this step"
        className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-tertiary transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink", focusRing)}>
        <X size={14} aria-hidden="true" />
      </button>
    </section>
  );
}

/** The project home's next step: what to do now and who can do it. */
export function NextStepCard({ chief, step }: { chief: Bot; step: JourneyStep }) {
  return (
    <section aria-label="Next step" data-next-step={step.id}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3.5 motion-safe:animate-[rise_var(--motion-base)_var(--ease-out)_backwards]">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-[11.5px] font-medium text-accent-text">Next · {JOURNEY_PHASE_LABEL[step.phase]}</p>
        <h3 className="mt-0.5 text-[15px] font-semibold tracking-[-0.01em] text-ink">{step.title}</h3>
        <p className="mt-0.5 text-[13px] text-ink-secondary">{step.detail}</p>
      </div>
      <div className="flex items-center gap-1"><Actions chief={chief} step={step} here={false} /></div>
    </section>
  );
}

function phaseLine(facts: JourneyFacts, phase: JourneyPhase): string {
  const n = (value: number, one: string, many: string) => `${value.toLocaleString()} ${value === 1 ? one : many}`;
  switch (phase) {
    case "plan": return [facts.brief ? "Brief" : "No Brief", n(facts.canvases, "canvas", "canvases")].join(" · ");
    case "build": return facts.issuesOpen + facts.issuesDone ? `${facts.issuesOpen.toLocaleString()} open · ${facts.issuesDone.toLocaleString()} done` : "No issues yet";
    case "launch": return facts.shipped ? `Shipped · ${n(facts.postsLive, "post", "posts")}` : "Not shipped";
    case "sell": return facts.leads ? n(facts.leads, "lead", "leads") : "No leads yet";
  }
}

const PHASE_HOME: Record<JourneyPhase, ChiefSection> = { plan: "docs", build: "issues", launch: "broadcast", sell: "pipeline" };

/** Plan → Build → Launch → Sell, with the phase the next step belongs to marked current. */
export function JourneyStrip({ journey, go }: { journey: ProjectJourney; go(section: ChiefSection): void }) {
  const { step, facts } = journey;
  const done = phasesDone(step);
  return (
    <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label={`Journey: ${JOURNEY_PHASE_LABEL[step.phase]}`}>
      {JOURNEY_PHASES.map((phase) => {
        const current = phase === step.phase;
        return (
          <li key={phase} className="min-w-0">
            <button type="button" onClick={() => go(current ? step.section : PHASE_HOME[phase])} aria-current={current ? "step" : undefined}
              className={cn("flex w-full min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-(--motion-fast)", focusRing,
                current ? "border-accent/60 bg-accent/10" : "border-hairline/40 bg-panel hover:bg-raised/50")}>
              <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-(--motion-base)",
                done[phase] ? "border-accent bg-accent text-accent-ink" : current ? "border-accent text-accent" : "border-hairline text-transparent")}>
                {done[phase] ? <Check size={12} strokeWidth={3} /> : <span className={cn("size-1.5 rounded-full", current ? "bg-accent" : "bg-transparent")} />}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-[13px] font-semibold", current ? "text-ink" : done[phase] ? "text-ink-secondary" : "text-ink-tertiary")}>
                  {JOURNEY_PHASE_LABEL[phase]}<span className="sr-only">{current ? ", current phase" : done[phase] ? ", done" : ", not started"}</span>
                </span>
                <span className="block truncate text-[11.5px] tabular-nums text-ink-tertiary">{phaseLine(facts, phase)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
