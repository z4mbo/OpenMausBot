import { useEffect, useRef } from "react";
import { Archive, BellOff, Inbox as InboxIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { ghostButton } from "../origin-pages/ui";
import { snoozeUntil, type InboxFolder, type SnoozeChoice } from "../../../shared/origin-sales";
import type { PipelineActor } from "../../../shared/origin-pipeline";
import { ownerKey } from "./pipeline-model";
import type { OwnerOption } from "./owners";

const small = cn(ghostButton, "h-8 min-h-8 rounded-full px-2.5 text-[12.5px]");
const kbd = "rounded border border-hairline/60 px-1 font-sans text-[10.5px] leading-[1.35] text-ink-tertiary";

const SNOOZE: { choice: SnoozeChoice; label: string }[] = [
  { choice: "later", label: "Later today" },
  { choice: "tomorrow", label: "Tomorrow morning" },
  { choice: "week", label: "Next week" },
];

const at = (time: number) => new Date(time).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export function Kbd({ children }: { children: string }) {
  return <kbd className={kbd}>{children}</kbd>;
}

function SnoozeMenu({ open, onOpen, onClose, onSnooze, busy }: { open: boolean; onOpen(): void; onClose(): void; onSnooze(until: number): void; busy: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, onClose]);
  return (
    <div ref={root} className="relative">
      <button type="button" className={small} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => (open ? onClose() : onOpen())} title="Snooze (S)">
        <BellOff size={13} /><span className="max-sm:sr-only">Snooze</span>
      </button>
      {open && (
        <div role="menu" aria-label="Snooze until" className="absolute right-0 top-[calc(100%+4px)] z-30 flex w-56 flex-col rounded-xl border border-hairline/60 bg-panel p-1 motion-safe:animate-[pop-in_var(--motion-fast)_var(--ease-out)]"
          onKeyDown={(event) => {
            const items = [...(root.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "Escape") { event.preventDefault(); onClose(); }
            if (event.key === "ArrowDown" || event.key === "j") { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
            if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
          }}>
          {SNOOZE.map((option) => {
            const until = snoozeUntil(option.choice);
            return (
              <button key={option.choice} type="button" role="menuitem" onClick={() => onSnooze(until)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink outline-none hover:bg-raised focus-visible:bg-raised">
                <span className="flex-1">{option.label}</span><span className="text-[11.5px] tabular-nums text-ink-tertiary">{at(until)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ConversationActions({ folder, owner, owners, busy, snoozing, onSnoozing, onAssign, onMove }: {
  folder?: InboxFolder; owner?: PipelineActor; owners: readonly OwnerOption[]; busy: boolean; snoozing: boolean;
  onSnoozing(open: boolean): void; onAssign(owner: PipelineActor | null): void; onMove(state: InboxFolder, until?: number): void;
}) {
  const current = ownerKey(owner);
  return (
    <div className="flex items-center gap-1.5">
      <Select size="sm" variant="pill" aria-label="Assign to" className="max-w-[9.5rem]" value={current} disabled={busy}
        onChange={(event) => onAssign(owners.find((option) => ownerKey(option) === event.target.value) ?? null)}>
        <option value="">Unassigned</option>
        {owner && !owners.some((option) => ownerKey(option) === current) && <option value={current}>{owner.name}</option>}
        {owners.map((option) => <option key={ownerKey(option)} value={ownerKey(option)}>{option.kind === "agent" ? `${option.name} (agent)` : option.name}</option>)}
      </Select>
      {folder !== "snoozed" && <SnoozeMenu open={snoozing} busy={busy} onOpen={() => onSnoozing(true)} onClose={() => onSnoozing(false)} onSnooze={(until) => { onSnoozing(false); onMove("snoozed", until); }} />}
      {folder === "open" || !folder
        ? <button type="button" className={small} disabled={busy} onClick={() => onMove("archived")} title="Archive (E)">{busy ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}<span className="max-sm:sr-only">Archive</span></button>
        : <button type="button" className={small} disabled={busy} onClick={() => onMove("open")} title="Move to inbox (E)"><InboxIcon size={13} /><span className="max-sm:sr-only">Move to inbox</span></button>}
    </div>
  );
}
