import { Fragment, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Activity, Check, ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { unreadReplies } from "@/lib/origin-unread";
import { useStore, type Bot } from "@/state/store";
import type { ChiefSection } from "@/lib/origin-chief-section";
import { sectionsThatFit } from "@/lib/section-overflow";
import { useCloudProjectFor } from "@/lib/origin-cloud-links";
import { stepOrigin, useProjectJourney, type ProjectJourney } from "@/lib/origin-journey";
import { cn } from "@/lib/cn";
import { UnreadBadge } from "./UnreadBadge";
import { SidebarPopoverMenu } from "./SidebarPopoverMenu";
import { BotAvatar } from "./Avatar";
import { NextStepStrip } from "./origin-journey/NextStep";
import { PHASE_LABEL, PROJECT_PHASES, phaseLanding, phaseOf, phaseSections, rememberSection, teamUnread, toolSections, type ProjectPhase, type ProjectSectionEntry } from "./project-sections";
import { phasesDone } from "../../shared/origin-journey";

const TAB_GAP = 2;
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const tabClass = `relative flex h-9 shrink-0 items-center gap-2 rounded-xl px-2.5 text-[13.5px] font-medium transition-colors duration-(--motion-fast) ${focusRing}`;

/** Slides one highlight under whichever tab, or More trigger, is current instead of swapping backgrounds. */
function useTabHighlight(strip: RefObject<HTMLDivElement | null>, current: string, layout: string) {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const root = strip.current;
    if (!root) return;
    const measure = () => {
      const tab = root.querySelector<HTMLElement>("[data-current]");
      if (!tab) return setBox(null);
      const rect = tab.getBoundingClientRect();
      setBox({ left: rect.left - root.getBoundingClientRect().left, width: rect.width });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    return () => resize.disconnect();
  }, [strip, current, layout]);
  return box;
}

/** How many tabs fit in the strip; the rest wait behind More. */
function useVisibleTabs(strip: RefObject<HTMLDivElement | null>, tabs: readonly ProjectSectionEntry[], current: number) {
  const ruler = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<number>(tabs.length);
  const key = tabs.map((tab) => tab.id).join();
  useLayoutEffect(() => {
    const root = strip.current, measures = ruler.current;
    if (!root || !measures) return;
    const fit = () => {
      const widths = [...measures.children].map((child) => child.getBoundingClientRect().width);
      const more = widths.pop() ?? 0, moreChevron = widths.pop() ?? 0;
      setVisible(sectionsThatFit({ tabs: widths, more, moreChevron, gap: TAB_GAP, available: root.clientWidth, current }));
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(root);
    resize.observe(measures);
    return () => resize.disconnect();
  }, [strip, current, key]);
  return { ruler, visible: Math.min(visible, tabs.length) };
}

function TabFace({ icon: Icon, label, current, badge }: { icon: LucideIcon; label: string; current: boolean; badge?: number }) {
  return (
    <>
      <Icon size={18} aria-hidden="true" className={cn("transition-colors duration-(--motion-fast)", current && "text-accent-text")} />{label}
      {badge !== undefined && <UnreadBadge count={badge} />}
    </>
  );
}

function SectionTabs({ tabs, section, badge, onSection }: { tabs: readonly ProjectSectionEntry[]; section: ChiefSection; badge(id: ChiefSection): number | undefined; onSection(section: ChiefSection): void }) {
  const currentIndex = tabs.findIndex((item) => item.id === section);
  const strip = useRef<HTMLDivElement>(null);
  const { ruler, visible } = useVisibleTabs(strip, tabs, currentIndex);
  const box = useTabHighlight(strip, section, `${visible}:${tabs.map((tab) => tab.id).join()}`);
  const shown = tabs.slice(0, visible);
  const hidden = tabs.slice(visible);
  const hiddenCurrent = currentIndex >= visible ? tabs[currentIndex] : undefined;
  return (
    <div ref={strip} role="group" aria-label="Sections" className="relative flex min-w-0 flex-1 items-center gap-0.5 max-md:order-4 max-md:-ml-8 max-md:basis-full">
      {box && <span aria-hidden="true" className="pointer-events-none absolute left-0 top-1/2 h-9 rounded-xl bg-raised transition-[translate,width] duration-(--motion-base) ease-out motion-reduce:transition-none"
        style={{ width: box.width, translate: `${box.left}px -50%` }} />}
      {shown.map(({ id, label, icon }, index) => (
        <button key={id} type="button" aria-current={section === id ? "page" : undefined} data-current={section === id || undefined} data-chief-section={id}
          onClick={() => onSection(id)} style={{ animationDelay: `${index * 20}ms` }}
          className={cn(tabClass, "motion-safe:animate-[rise_var(--motion-base)_var(--ease-out)_backwards]", section === id ? "text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink", section === id && !box && "bg-raised")}>
          <TabFace icon={icon} label={label} current={section === id} badge={badge(id)} />
        </button>
      ))}
      {hidden.length > 0 && (
        <div className="shrink-0" data-current={hiddenCurrent ? true : undefined}>
          <SidebarPopoverMenu
            ariaLabel={hiddenCurrent ? `More sections, ${hiddenCurrent.label} open` : "More sections"}
            triggerClassName={cn(tabClass, hiddenCurrent ? "text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink", hiddenCurrent && !box && "bg-raised")}
            items={hidden.map(({ id, label, icon: Icon }) => ({ key: id, label, icon: <Icon size={18} />, active: section === id, trailing: badge(id) ? <UnreadBadge count={badge(id)!} /> : undefined, onSelect: () => onSection(id) }))}
            renderTrigger={({ open }) => (
              <>
                {hiddenCurrent ? <TabFace icon={hiddenCurrent.icon} label={hiddenCurrent.label} current /> : "More"}
                <ChevronDown size={14} aria-hidden="true" className={cn("-ml-1 text-ink-tertiary transition-transform duration-(--motion-fast)", open && "rotate-180")} />
              </>
            )} />
        </div>
      )}
      <div ref={ruler} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max overflow-hidden">
        {tabs.map(({ id, label, icon }) => <span key={id} className={tabClass}><TabFace icon={icon} label={label} current={false} badge={badge(id)} /></span>)}
        <span className={cn(tabClass, "gap-0 px-0")}><ChevronDown size={14} className="-ml-1" /></span>
        <span className={tabClass}>More<ChevronDown size={14} className="-ml-1" /></span>
      </div>
    </div>
  );
}

const railButton = `relative flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium transition-colors duration-(--motion-fast) max-md:flex-1 ${focusRing}`;

/** Pulse, then Plan → Build → Launch → Sell: the project's journey as its top level. */
function PhaseRail({ section, journey, badge, onPulse, onPhase }: {
  section: ChiefSection; journey: ProjectJourney | undefined; badge(phase: ProjectPhase): number; onPulse(): void; onPhase(phase: ProjectPhase): void;
}) {
  const active = phaseOf(section);
  const done = journey ? phasesDone(journey.step) : undefined;
  return (
    <div role="group" aria-label="Phases" data-project-phases className="flex shrink-0 items-center gap-0.5 rounded-xl bg-inset/70 p-0.5 max-md:order-3 max-md:-ml-8 max-md:basis-full">
      <button type="button" onClick={onPulse} aria-current={section === "pulse" ? "page" : undefined} data-chief-section="pulse" title="Pulse"
        className={cn(railButton, section === "pulse" ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink")}>
        <Activity size={15} aria-hidden="true" className={cn("shrink-0", section === "pulse" && "text-accent-text")} /><span className="max-sm:sr-only">Pulse</span>
      </button>
      {PROJECT_PHASES.map((phase, index) => {
        const next = journey?.step.phase === phase;
        const count = badge(phase);
        return (
          <Fragment key={phase}>
            {index > 0 && <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-ink-tertiary/60 max-md:hidden" />}
            <button type="button" onClick={() => onPhase(phase)} aria-current={active === phase ? "true" : undefined} data-project-phase={phase}
              aria-label={`${PHASE_LABEL[phase]}${done?.[phase] ? ", done" : next ? ", next step" : ""}`}
              className={cn(railButton, active === phase ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink")}>
              {done?.[phase]
                ? <Check size={13} strokeWidth={2.75} aria-hidden="true" className="shrink-0 text-accent-text" />
                : next ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
              {PHASE_LABEL[phase]}
              {active !== phase && count > 0 && <UnreadBadge count={count} />}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** `joined` sits inside a glass header; otherwise the bar wears the same glass on its own. */
export function ChiefSectionBar({ bot, section, onSection, joined = false }: { bot: Bot; section: ChiefSection; onSection(section: ChiefSection): void; joined?: boolean }) {
  const { state } = useStore();
  const projectId = useCloudProjectFor(bot);
  const journey = useProjectJourney(projectId);
  const agentsUnread = teamUnread(state.bots, bot);
  const phase = phaseOf(section);
  useEffect(() => rememberSection(bot.id, section), [bot.id, section]);
  const badge = (id: ChiefSection) => (id === "agents" ? agentsUnread : undefined);
  const phaseBadge = (candidate: ProjectPhase) => phaseSections(candidate).reduce((sum, item) => sum + (badge(item.id) ?? 0), 0);
  const strip = journey && projectId && (section === "chat" || section === journey.step.section || stepOrigin(journey.step) === section);
  return (
    <>
      <nav aria-label={`${bot.name} sections`} data-chief-sections className={cn("relative flex h-14 shrink-0 items-center gap-1.5 px-3 pl-11 max-md:h-auto max-md:flex-wrap max-md:gap-y-1.5 max-md:py-2 md:pl-3", !joined && "glass-bar z-[25] border-b border-hairline/40 [--glass-tint:var(--color-app)]")}>
        <button type="button" onClick={() => onSection("chat")} title={`Chat with ${bot.name}`}
          className={cn("flex h-10 min-w-0 items-center gap-2 rounded-xl px-2 text-[14px] font-semibold text-ink transition-colors duration-(--motion-fast) hover:bg-raised/50 max-md:flex-1 md:shrink-0", focusRing)}>
          <BotAvatar bot={bot} size={24} />
          <span className="max-w-[160px] truncate">{bot.name}</span>
          {unreadReplies(bot) > 0
            ? <UnreadBadge count={unreadReplies(bot)} />
            : <span aria-label={bot.busy ? "Working" : "Idle"} className={cn("size-2 rounded-full", bot.busy ? "animate-pulse bg-success" : "bg-ink-tertiary/60")} />}
        </button>
        <PhaseRail section={section} journey={journey} badge={phaseBadge} onPulse={() => onSection("pulse")} onPhase={(next) => onSection(phaseLanding(bot.id, next))} />
        {phase ? <SectionTabs key={phase} tabs={phaseSections(phase)} section={section} badge={badge} onSection={onSection} /> : <div className="min-w-0 flex-1 max-md:hidden" />}
        <div className="flex shrink-0 items-center max-md:order-2" role="group" aria-label="Project tools">
          {toolSections().map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={section === id ? "page" : undefined} aria-label={label} title={label} data-chief-section={id}
              onClick={() => onSection(id)}
              className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-(--motion-fast) md:size-10", focusRing,
                section === id ? "bg-raised text-accent-text" : "text-ink-secondary hover:bg-raised/50 hover:text-ink")}>
              <Icon size={20} aria-hidden="true" />
            </button>
          ))}
        </div>
      </nav>
      {strip && <NextStepStrip chief={bot} projectId={projectId} journey={journey} here={section} />}
    </>
  );
}
