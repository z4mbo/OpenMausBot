import { useEffect, useRef, useState, type ReactNode } from "react";
import { Minus } from "lucide-react";
import { cn } from "@/lib/cn";

export const field = "h-7 w-full min-w-0 rounded-md border border-transparent bg-inset px-1.5 text-[12px] tabular-nums text-ink outline-none transition-colors hover:border-hairline/60 focus:border-accent/70 disabled:opacity-50";
/** A field's frame with its label or swatch inside, the way the Design panel's rows read. */
export const shell = "flex h-7 min-w-0 items-center rounded-md border border-transparent bg-inset transition-colors duration-(--motion-fast) hover:border-hairline/60 focus-within:border-accent/70";
const bare = "h-full w-full min-w-0 bg-transparent pr-1.5 text-[12px] tabular-nums text-ink outline-none placeholder:text-ink-tertiary disabled:opacity-50";
export const iconToggle = "inline-flex h-7 min-w-7 flex-1 items-center justify-center rounded-md text-ink-secondary outline-none transition-colors duration-100 hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40";

export function Section({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="border-b border-hairline/40 px-3 py-2.5">
      <div className="mb-1.5 flex h-6 items-center justify-between">
        <h3 className="text-[11.5px] font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children && <div className="flex flex-col gap-1.5">{children}</div>}
    </section>
  );
}

const tidy = (value: number) => String(Math.round(value * 100) / 100);

export function NumberField({ label, name, value, onCommit, min, max, step = 1, disabled, suffix, placeholder = "Mixed" }: {
  label: ReactNode; name?: string; placeholder?: string; value: number | undefined; onCommit(value: number): void; min?: number; max?: number; step?: number; disabled?: boolean; suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : tidy(value));
  const clamp = (next: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
  const commit = (text: string) => {
    setDraft(null);
    const parsed = Number(text.replace(",", ".").replace(/[^\d.+-]/g, ""));
    if (text.trim() && Number.isFinite(parsed) && parsed !== value) onCommit(clamp(parsed));
  };
  const scrub = useRef<{ x: number; start: number } | null>(null);
  return (
    <label className={cn(shell, disabled && "hover:border-transparent")}>
      <span className={cn("flex h-full min-w-6 shrink-0 select-none items-center justify-center px-1 text-[11px] text-ink-tertiary", !disabled && value !== undefined && "cursor-ew-resize")}
        onPointerDown={(event) => { if (disabled || value === undefined) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); scrub.current = { x: event.clientX, start: value }; }}
        onPointerMove={(event) => { if (!scrub.current) return; const next = clamp(Math.round(scrub.current.start + (event.clientX - scrub.current.x) * step)); setDraft(tidy(next)); }}
        onPointerUp={() => { if (!scrub.current) return; scrub.current = null; if (draft !== null) commit(draft); }}>
        {label}
      </span>
      <input className={bare} value={shown} placeholder={value === undefined ? placeholder : undefined} disabled={disabled} inputMode="decimal" aria-label={name ?? (typeof label === "string" ? label : undefined)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") { setDraft(null); event.currentTarget.blur(); }
          if ((event.key === "ArrowUp" || event.key === "ArrowDown") && value !== undefined) {
            event.preventDefault();
            onCommit(clamp(value + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1)));
          }
        }} />
      {suffix && <span className="shrink-0 pr-1.5 text-[11px] text-ink-tertiary">{suffix}</span>}
    </label>
  );
}

export function ColorField({ label, value, onPreview, onCommit, onRemove, disabled }: { label: string; value: string | null | undefined; onPreview(value: string): void; onCommit(value: string): void; onRemove?: () => void; disabled?: boolean }) {
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => {
    const input = picker.current;
    if (!input) return;
    const change = () => commitRef.current(input.value.toUpperCase());
    input.addEventListener("change", change);
    return () => input.removeEventListener("change", change);
  }, []);
  const hex = value ? value.slice(0, 7) : "#000000";
  return (
    <div className="flex items-center gap-1">
      <div className={cn(shell, "flex-1")}>
        <span className="relative ml-1.5 mr-2 size-4 shrink-0 overflow-hidden rounded-[4px] border border-hairline/70" style={{ background: value ?? "transparent" }}>
          <input ref={picker} type="color" aria-label={`${label} colour`} value={hex.length === 7 ? hex : "#000000"} disabled={disabled}
            onInput={(event) => onPreview(event.currentTarget.value.toUpperCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0" />
        </span>
        <input className={cn(bare, "uppercase")} aria-label={`${label} hex`} value={draft ?? (value ?? "")} placeholder="Mixed" disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => { setDraft(null); const next = event.target.value.trim(); if (/^#?[0-9a-f]{3,8}$/i.test(next)) onCommit((next.startsWith("#") ? next : `#${next}`).toUpperCase()); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </div>
      {onRemove && <button type="button" className={cn(iconToggle, "max-w-7 flex-none")} aria-label={`Remove ${label.toLowerCase()}`} disabled={disabled} onClick={onRemove}><Minus size={13} /></button>}
    </div>
  );
}

export function Toggles<T extends string>({ value, options, onChange, label, disabled }: { value: T | undefined; options: readonly { value: T; label: ReactNode; title: string }[]; onChange(value: T): void; label: string; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-md bg-inset p-0.5">
      {options.map((option) => (
        <button key={option.value} type="button" title={option.title} aria-label={option.title} aria-pressed={option.value === value} disabled={disabled} onClick={() => onChange(option.value)}
          className={cn(iconToggle, "h-6 text-[11.5px]", option.value === value && "bg-raised text-ink")}>{option.label}</button>
      ))}
    </div>
  );
}
