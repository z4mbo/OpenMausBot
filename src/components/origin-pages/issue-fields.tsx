import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Check, ChevronDown, Circle, Search, SignalHigh, SignalLow, SignalMedium, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CloudColumn, CloudPerson, Priority } from "./cloud-types";
import { chipButton } from "./ui";
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
  if (name === "idea" || name === "backlog") return "text-ink-tertiary";
  if (name === "todo") return "text-ink-secondary";
  if (name === "inprogress" || name === "doing") return "text-warning";
  if (name === "review" || name === "inreview") return "text-accent-text";
  if (name === "done") return "text-success";
  return "text-ink-secondary";
}

export function parseLabels(value: string): string[] {
  return [...new Set(value.split(",").map((label) => label.trim()).filter(Boolean))].slice(0, 20);
}

export type ChipOption = { value: string; label: string; icon?: ReactNode; hint?: string };

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
  const selected = options.find((option) => option.value === value);
  const matches = options.filter((option) => `${option.label} ${option.hint ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const choose = (option: ChipOption) => { onChange(option.value); close(); };
  const show = () => { setQuery(""); setActive(Math.max(0, options.findIndex((option) => option.value === value))); setOpen(true); };
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, id, open]);
  return (
    <div ref={root} className={cn("relative", className)} onKeyDown={(event) => {
      if (!open) return;
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
        <div className={cn("absolute top-full z-40 mt-1.5 w-60 overflow-hidden rounded-xl border border-hairline/60 bg-menu shadow-2xl motion-safe:animate-pop-in", align === "right" ? "right-0" : "left-0")}>
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
        className="w-[7.5rem] cursor-pointer bg-transparent text-[12.5px] outline-none [color-scheme:dark] max-md:text-[16px]" />
    </label>
  );
}

export function statusOptions(columns: readonly CloudColumn[]): ChipOption[] {
  return columns.map((column) => ({ value: column._id, label: column.title, icon: <Circle size={14} className={cn("shrink-0", laneTone(column.title))} aria-hidden="true" /> }));
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

/** The roomy dialog the composer and the issue page share. */
export function IssueDialog({ label, heading, onClose, children, wide }: { label: string; heading: ReactNode; onClose(): void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close.current(); } };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); returnTo?.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/55 backdrop-blur-[2px] motion-safe:animate-[workspace-in_0.16s_ease-out] sm:items-start sm:p-6 md:pt-[8vh]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label}
        className={cn("w-full rounded-t-2xl border border-hairline/60 bg-menu shadow-[0_24px_80px_rgb(0_0_0/0.55)] motion-safe:animate-pop-in sm:rounded-[18px]", wide ? "sm:max-w-5xl" : "sm:max-w-[860px]")}>
        <div className="flex items-center gap-2 px-5 pb-1 pt-3.5">
          <div className="min-w-0 flex-1">{heading}</div>
          <button type="button" aria-label="Close" onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
