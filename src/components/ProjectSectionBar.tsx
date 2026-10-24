import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { unreadReplies } from "@/lib/origin-unread";
import type { Bot } from "@/state/store";
import type { ShownSection } from "@/lib/origin-chief-section";
import { sectionsThatFit } from "@/lib/section-overflow";
import { cn } from "@/lib/cn";
import { UnreadBadge } from "./UnreadBadge";
import { SidebarPopoverMenu } from "./SidebarPopoverMenu";
import { BotAvatar } from "./Avatar";
import { useCaptionChrome } from "./DesktopCapabilities";
import { tabSections, toolSections, type ProjectSectionEntry } from "./project-sections";

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

function TabFace({ icon: Icon, label, current }: { icon: LucideIcon; label: string; current: boolean }) {
  return (
    <>
      <Icon size={18} aria-hidden="true" className={cn("transition-colors duration-(--motion-fast)", current && "text-ink")} />{label}
    </>
  );
}

function SectionTabs({ tabs, section, onSection }: { tabs: readonly ProjectSectionEntry[]; section: ShownSection; onSection(section: ShownSection): void }) {
  const currentIndex = tabs.findIndex((item) => item.id === section);
  const strip = useRef<HTMLDivElement>(null);
  const { ruler, visible } = useVisibleTabs(strip, tabs, currentIndex);
  const box = useTabHighlight(strip, section, `${visible}:${tabs.map((tab) => tab.id).join()}`);
  const shown = tabs.slice(0, visible);
  const hidden = tabs.slice(visible);
  const hiddenCurrent = currentIndex >= visible ? tabs[currentIndex] : undefined;
  const { noDragStyle } = useCaptionChrome();
  return (
    <div ref={strip} role="group" aria-label="Sections" className="relative flex min-w-0 flex-1 items-center gap-0.5 max-md:order-4 max-md:-ml-8 max-md:basis-full">
      {box && <span aria-hidden="true" className="pointer-events-none absolute left-0 top-1/2 h-9 rounded-xl bg-raised transition-[translate,width] duration-(--motion-base) ease-out motion-reduce:transition-none"
        style={{ width: box.width, translate: `${box.left}px -50%` }} />}
      {shown.map(({ id, label, icon }, index) => (
        <button key={id} type="button" aria-current={section === id ? "page" : undefined} data-current={section === id || undefined} data-chief-section={id}
          onClick={() => onSection(id)} style={{ ...noDragStyle, animationDelay: `${index * 20}ms` }}
          className={cn(tabClass, "motion-safe:animate-[rise_var(--motion-base)_var(--ease-out)_backwards]", section === id ? "text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink", section === id && !box && "bg-raised")}>
          <TabFace icon={icon} label={label} current={section === id} />
        </button>
      ))}
      {hidden.length > 0 && (
        <div className="shrink-0" data-current={hiddenCurrent ? true : undefined} style={noDragStyle}>
          <SidebarPopoverMenu
            ariaLabel={hiddenCurrent ? `More sections, ${hiddenCurrent.label} open` : "More sections"}
            triggerClassName={cn(tabClass, hiddenCurrent ? "text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink", hiddenCurrent && !box && "bg-raised")}
            items={hidden.map(({ id, label, icon: Icon }) => ({ key: id, label, icon: <Icon size={18} />, active: section === id, onSelect: () => onSection(id) }))}
            renderTrigger={({ open }) => (
              <>
                {hiddenCurrent ? <TabFace icon={hiddenCurrent.icon} label={hiddenCurrent.label} current /> : "More"}
                <ChevronDown size={14} aria-hidden="true" className={cn("-ml-1 text-ink-tertiary transition-transform duration-(--motion-fast)", open && "rotate-180")} />
              </>
            )} />
        </div>
      )}
      <div ref={ruler} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max overflow-hidden">
        {tabs.map(({ id, label, icon }) => <span key={id} className={tabClass}><TabFace icon={icon} label={label} current={false} /></span>)}
        <span className={cn(tabClass, "px-0")}><span /><ChevronDown size={14} className="-ml-1" /></span>
        <span className={tabClass}>More<ChevronDown size={14} className="-ml-1" /></span>
      </div>
    </div>
  );
}

/** `joined` sits inside a glass header; otherwise the bar wears the same glass on its own. */
export function ChiefSectionBar({ bot, section, onSection, joined = false }: { bot: Bot; section: ShownSection; onSection(section: ShownSection): void; joined?: boolean }) {
  const chief = section === "chat";
  const { dragProps, noDragStyle } = useCaptionChrome();
  return (
    <nav aria-label={`${bot.name} sections`} data-chief-sections {...dragProps} className={cn("relative flex h-14 shrink-0 items-center gap-1.5 px-3 pl-11 max-md:h-auto max-md:flex-wrap max-md:gap-y-1.5 max-md:py-2 md:pl-3", !joined && "glass-bar z-[25] border-b border-hairline/40 [--glass-tint:var(--color-app)]")}>
      <button type="button" onClick={() => onSection("chat")} title={`Chat with ${bot.name}`} aria-current={chief ? "page" : undefined} data-chief-section="chat" style={noDragStyle}
        className={cn("flex h-10 min-w-0 items-center gap-2 rounded-xl px-2 text-[14px] font-semibold text-ink transition-colors duration-(--motion-fast) max-md:flex-1 md:shrink-0", focusRing,
          chief ? "bg-raised" : "hover:bg-raised/50")}>
        <BotAvatar bot={bot} size={24} />
        <span className="max-w-[160px] truncate">{bot.name}</span>
        {unreadReplies(bot) > 0
          ? <UnreadBadge count={unreadReplies(bot)} />
          : <span aria-label={bot.busy ? "Working" : "Idle"} className={cn("size-2 rounded-full", bot.busy ? "animate-pulse bg-success" : "bg-ink-tertiary/60")} />}
      </button>
      <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-hairline max-md:hidden" />
      <SectionTabs tabs={tabSections()} section={section} onSection={onSection} />
      <div className="flex shrink-0 items-center max-md:order-2" role="group" aria-label="Project tools" style={noDragStyle}>
        {toolSections().map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={section === id ? "page" : undefined} aria-label={label} title={label} data-chief-section={id}
            onClick={() => onSection(id)}
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-(--motion-fast) md:size-10", focusRing,
              section === id ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink")}>
            <Icon size={20} aria-hidden="true" />
          </button>
        ))}
      </div>
    </nav>
  );
}
