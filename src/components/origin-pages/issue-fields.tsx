import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bot as BotIcon, CalendarDays, Check, ChevronDown, Circle, CircleDashed, Search, SignalHigh, SignalLow, SignalMedium, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { isDraftColumn } from "../../../shared/origin-columns";
import type { CloudColumn, CloudPerson, Priority } from "./cloud-types";
import { CenteredDialog } from "../CenteredDialog";
import { CloudQueryRefreshNotice, chipButton } from "./ui";
import { PersonAvatar } from "./PersonAvatar";

export const PRIORITIES: readonly Priority[] = ["low", "medium", "high"];
export const priorityTone: Record<Priority, string> = { low: "text-ink-tertiary", medium: "text-warning", high: "text-danger" };
const PRIORITY_ICON = { low: SignalLow, medium: SignalMedium, high: SignalHigh } as const;

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  const Icon = PRIORITY_ICON[priority];
  return <Icon size={size} className={cn("shrink-0", priorityTone[priority])} aria-hidden="true" />;
}

export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function isDoneColumn(column: CloudColumn): boolean {
  return column.isDone ?? column.title.trim().toLowerCase() === "done";
}

export function laneTone(title: string): string {
  const name = title.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (name === "draft" || name === "idea" || name === "backlog") return "text-ink-tertiary";
  if (name === "todo") return "text-ink-secondary";
  if (name === "inprogress" || name === "doing") return "text-warning";
  if (name === "review" || name === "inreview") return "text-accent-text";
  if (name === "done") return "text-success";
  return "text-ink-secondary";
}

/** The height a chip's open list needs below it before it opens upward instead. */
const MENU_ROOM = 340;

export type ChipOption ={ value: string; label: string; icon?: ReactNode; hint?: string };

/** A pill that opens a searchable, keyboard-driven list, like the Origin issue composer's property chips. */
export function ChipSelect({ label, value, options, onChange, icon, disabled, placeholder, className, align = "left" }: {
  label: string; value: string; options: readonly ChipOption[]; onChange(value: string): void; icon?: ReactNode; disabled?: boolean; placeholder?: string; className?: string; align?: "left" | "right";
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [upward, setUpward] = useState(false);
  const [menuLeft, setMenuLeft] = useState(0);
  const selected = options.find((option) => option.value === value);
  const matches = options.filter((option) => `${option.label} ${option.hint ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const choose = (option: ChipOption) => { onChange(option.value); close(); };
  const show = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (box) {
      const width = Math.min(240, window.innerWidth - 16);
      const edge = align === "right" ? box.right - width : box.left;
      setMenuLeft(Math.max(8, Math.min(edge, window.innerWidth - width - 8)) - box.left);
    }
    const below = box ? window.innerHeight - box.bottom : Infinity;
    setUpward(box !== undefined && below < MENU_ROOM && box.top > below);
    setQuery("");
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, id, open]);
  return (
    <div ref={root} className={cn("relative", className)} onKeyDown={(event) => {
      if (!open || event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length));
      } else if (event.key === "Enter") { event.preventDefault(); if (matches[active]) choose(matches[active]); }
      else if (event.key === "Tab") close(false);
    }}>
      <button ref={trigger} type="button" className={cn(chipButton, "w-full", selected && "text-ink")} aria-label={selected ? `${label}: ${selected.label}` : label} title={label}
        aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => { if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); show(); } }}>
        {selected?.icon ?? icon}
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label ?? placeholder ?? label}</span>
        <ChevronDown size={12} className="shrink-0 opacity-60" aria-hidden="true" />
      </button>
      {open && (
        <div style={{ left: menuLeft }} className={cn("absolute z-40 w-60 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-hairline/60 bg-menu motion-safe:animate-pop-in", upward ? "bottom-full mb-1.5" : "top-full mt-1.5")}>
          <div className="flex items-center gap-2 border-b border-hairline/40 px-3 py-2 text-ink-tertiary">
            <Search size={14} aria-hidden="true" />
            <input autoFocus className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]"
              role="combobox" aria-expanded="true" aria-controls={id} aria-activedescendant={matches[active] ? `${id}-${active}` : undefined}
              aria-label={`Search ${label.toLowerCase()}`} placeholder={`Change ${label.toLowerCase()}…`} value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0); }} />
          </div>
          <div role="listbox" id={id} aria-label={label} className="max-h-64 overflow-y-auto p-1.5">
            {matches.map((option, index) => (
              <button key={option.value} id={`${id}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={option.value === value}
                onMouseEnter={() => setActive(index)} onClick={() => choose(option)}
                className={cn("flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-ink", index === active && "bg-raised")}>
                {option.icon ?? icon}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{option.hint}</span>}
                {option.value === value && <Check size={14} className="shrink-0 text-accent-text" aria-hidden="true" />}
              </button>
            ))}
            {!matches.length && <p className="px-2.5 py-2 text-[12.5px] text-ink-tertiary">No results</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function DateChip({ value, onChange, disabled, required }: { value: string; onChange(value: string): void; disabled?: boolean; required?: boolean }) {
  return (
    <label className={cn(chipButton, "relative cursor-pointer pr-2", value && "text-ink")}>
      <CalendarDays size={14} aria-hidden="true" className="shrink-0" />
      <input type="date" aria-label="Due date" title="Due date" value={value} required={required} disabled={disabled} onChange={(event) => onChange(event.target.value)}
        style={{ colorScheme: "var(--code-color-scheme)" }} className="w-[7.5rem] cursor-pointer bg-transparent text-[12.5px] outline-none max-md:text-[16px]" />
    </label>
  );
}

export function ColumnIcon({ column, size = 14, strokeWidth }: { column: CloudColumn; size?: number; strokeWidth?: number }) {
  const Icon = isDraftColumn(column) ? CircleDashed : Circle;
  return <Icon size={size} strokeWidth={strokeWidth} className={cn("shrink-0", isDraftColumn(column) ? "text-ink-tertiary" : laneTone(column.title))} aria-hidden="true" />;
}

export function statusOptions(columns: readonly CloudColumn[]): ChipOption[] {
  return columns.map((column) => ({ value: column._id, label: column.title, icon: <ColumnIcon column={column} />, hint: isDraftColumn(column) ? "Not on GitHub" : undefined }));
}

export function priorityOptions(): ChipOption[] {
  return PRIORITIES.map((priority) => ({ value: priority, label: capitalize(priority), icon: <PriorityIcon priority={priority} /> }));
}

export function memberOptions(people: readonly CloudPerson[]): ChipOption[] {
  return people.map((person) => ({ value: person.email, label: person.username || person.name || person.email, hint: person.role === "viewer" ? "viewer" : undefined, icon: <PersonAvatar person={person} size={18} /> }));
}

/** An agent the composer can hand a fresh issue to. */
export type IssueAgent = { id: string; name: string; avatar: ReactNode };

export type CreatedIssue = {
  projectId: string; taskId: string; title: string; description: string; priority: Priority; dueDate: string; labels: string[]; status: string; agentId?: string;
};

/** The box the composer and the issue page share: a heading, then the title, description and property chips. */
export function IssueDialog({ label, heading, onClose, canClose, children }: { label: string; heading: ReactNode; onClose(): void; canClose?(): boolean; children: ReactNode }) {
  return (
    <CenteredDialog label={label} onClose={onClose} canClose={canClose} className="sm:max-w-[780px]">
      {(dismiss) => <>
        <div className="flex items-center gap-2 px-6 pb-1 pt-4 max-sm:px-5">
          <div className="min-w-0 flex-1">{heading}</div>
          <button type="button" aria-label="Close" onClick={dismiss}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <CloudQueryRefreshNotice className="px-6 pb-2 max-sm:px-5" />
        {children}
      </>}
    </CenteredDialog>
  );
}

export function ProjectDot({ name }: { name: string }) {
  return <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded bg-accent/20 text-[9.5px] font-bold text-accent-text">{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

/** The row of property chips under an issue's title and description. */
export function IssueChips({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap items-center gap-2">{children}</div>;
}

export const issueTitleClass = "w-full resize-none bg-transparent text-[24px] font-semibold leading-snug tracking-[-0.01em] text-ink outline-none [field-sizing:content] placeholder:text-ink-tertiary disabled:opacity-100 max-md:text-[20px]";
export const issueDescriptionClass = "mt-3 min-h-[140px] w-full resize-none bg-transparent text-[14.5px] leading-relaxed text-ink-secondary outline-none [field-sizing:content] placeholder:text-ink-tertiary disabled:opacity-100 max-md:text-[16px]";

/** Chips that hand an issue to one of the project's agents; with no agents listed, the host asks which one. */
export function AgentChip({ agents, onPick, disabled, value = "", onClear }: {
  agents: readonly IssueAgent[]; onPick(agentId?: string): void; disabled?: boolean; value?: string; onClear?(): void;
}) {
  if (!agents.length) {
    return <button type="button" className={chipButton} disabled={disabled} onClick={() => onPick()}><BotIcon size={14} aria-hidden="true" />Hand to agent</button>;
  }
  const options: ChipOption[] = [
    ...agents.map((agent) => ({ value: agent.id, label: agent.name, icon: agent.avatar })),
    ...(value && onClear ? [{ value: NO_AGENT, label: "Don't hand off", icon: <X size={14} aria-hidden="true" /> }] : []),
  ];
  return (
    <ChipSelect label="Hand to agent" value={value} placeholder="Hand to agent" align="right" icon={<BotIcon size={14} aria-hidden="true" />} options={options} disabled={disabled}
      onChange={(next) => (next === NO_AGENT ? onClear?.() : onPick(next))} />
  );
}

const NO_AGENT = "none";
