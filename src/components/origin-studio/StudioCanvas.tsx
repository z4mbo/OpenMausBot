import { useEffect, useState, type KeyboardEvent } from "react";
import { AlertTriangle, ArrowUpFromLine, AudioLines, Ban, Clapperboard, FastForward, Loader2, Maximize2, RotateCcw, Scissors, Send, Shuffle, Square, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/memory";
import { formatSeconds, ratioOf, typing } from "./studio-ui";
import { studioEta, type StudioGeneration } from "../../../shared/studio";

export type TileAction = "open" | "animate" | "upscale" | "remix" | "removeBackground" | "extend" | "reuse" | "broadcast" | "cancel" | "delete";

interface ActionSpec {
  id: TileAction;
  label: string;
  key?: string;
  icon: typeof Send;
}

const ACTIONS: Record<TileAction, ActionSpec> = {
  open: { id: "open", label: "Open", key: "Enter", icon: Maximize2 },
  animate: { id: "animate", label: "Animate", key: "A", icon: Clapperboard },
  upscale: { id: "upscale", label: "Upscale", key: "U", icon: ArrowUpFromLine },
  remix: { id: "remix", label: "Remix", key: "R", icon: Shuffle },
  removeBackground: { id: "removeBackground", label: "Remove background", icon: Scissors },
  extend: { id: "extend", label: "Extend", key: "X", icon: FastForward },
  reuse: { id: "reuse", label: "Reuse settings", key: "P", icon: RotateCcw },
  broadcast: { id: "broadcast", label: "Use in Broadcast", key: "B", icon: Send },
  cancel: { id: "cancel", label: "Cancel", icon: Square },
  delete: { id: "delete", label: "Delete", key: "Del", icon: Trash2 },
};

/** What a person can do with a generation in its state, in the order the tile shows them. */
export function tileActions(row: StudioGeneration, canEdit: boolean, isAdmin: boolean): ActionSpec[] {
  const live = row.status === "queued" || row.status === "running";
  const kind = row.outputs[0]?.kind ?? row.kind;
  const list: TileAction[] = [];
  if (row.status === "done" && canEdit) {
    if (kind === "image") list.push("animate", "upscale", "remix", "removeBackground");
    if (kind === "video") list.push("extend", "upscale");
    list.push("broadcast");
  }
  if (canEdit) list.push("reuse");
  if (live && canEdit) list.push("cancel");
  if (canEdit || isAdmin) list.push("delete");
  return list.map((id) => ACTIONS[id]);
}

const KEY_ACTION: Record<string, TileAction> = { a: "animate", u: "upscale", r: "remix", x: "extend", p: "reuse", b: "broadcast", Delete: "delete", Backspace: "delete" };

/** Seconds since a live generation started, ticking each second. */
function useElapsed(since: number, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live]);
  return Math.max(0, (now - since) / 1000);
}

function Progress({ row, rows }: { row: StudioGeneration; rows: readonly StudioGeneration[] }) {
  const elapsed = useElapsed(row.startedAt ?? row.createdAt, true);
  const eta = studioEta(row.model, rows);
  const share = row.status === "queued" ? 0.04 : Math.min(0.95, elapsed / eta);
  const left = eta - elapsed;
  const label = row.status === "queued"
    ? row.queuePosition ? `In fal's queue · #${row.queuePosition}` : "Queued"
    : left > 1 ? `~${formatSeconds(left)} left` : elapsed > eta * 1.5 ? "Taking longer than usual" : "Almost done";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12.5px] text-ink-secondary" role="status" aria-label={`${row.modelLabel}: ${label}`}>
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-transparent via-raised/50 to-transparent [background-size:200%_100%] motion-safe:animate-shimmer" />
      <Loader2 size={16} className="relative animate-spin text-accent-text" aria-hidden="true" />
      <span className="relative tabular-nums">{label}</span>
      <span className="relative text-[11px] tabular-nums text-ink-tertiary">{formatSeconds(elapsed)}</span>
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-hairline/30" aria-hidden="true">
        <span className="block h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </div>
  );
}

function Media({ row }: { row: StudioGeneration }) {
  const output = row.outputs[0];
  if (!output) return null;
  if (output.kind === "image") return <img src={output.url} alt={row.prompt} loading="lazy" className="block h-auto w-full" />;
  if (output.kind === "video") {
    return <video src={output.url} muted loop playsInline preload="metadata" className="block h-auto w-full"
      onMouseEnter={(event) => void event.currentTarget.play().catch(() => undefined)} onMouseLeave={(event) => event.currentTarget.pause()} />;
  }
  return (
    <div className="flex w-full flex-col gap-3 px-3 pb-3 pt-4">
      <span className="flex items-center gap-2 text-[12px] text-ink-secondary"><AudioLines size={16} className="text-accent-text" aria-hidden="true" />{row.modelLabel}</span>
      <audio src={output.url} controls preload="none" className="h-9 w-full [color-scheme:var(--code-color-scheme)]" onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

function Tile({ row, rows, canEdit, isAdmin, busy, onAction }: {
  row: StudioGeneration; rows: readonly StudioGeneration[]; canEdit: boolean; isAdmin: boolean; busy: boolean; onAction(row: StudioGeneration, action: TileAction): void;
}) {
  const live = row.status === "queued" || row.status === "running";
  const actions = tileActions(row, canEdit, isAdmin);
  const picked = row.broadcast.some((entry) => entry.index === 0);
  const audio = row.outputs[0]?.kind === "audio";
  const placeholder = live || row.status !== "done" || !row.outputs[0];
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (typing(event) || event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (row.status === "done") onAction(row, "open");
      return;
    }
    const action = KEY_ACTION[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (action && actions.some((spec) => spec.id === action)) {
      event.preventDefault();
      onAction(row, action);
    }
  };
  return (
    <article tabIndex={0} onKeyDown={onKey} onDoubleClick={() => row.status === "done" && onAction(row, "open")} data-studio-generation={row.status} data-studio-tile={row._id}
      aria-label={`${row.modelLabel} ${row.kind}: ${row.prompt || "no prompt"}`}
      className="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl border border-hairline/40 bg-panel outline-none transition-colors duration-(--motion-fast) focus-visible:border-accent motion-safe:animate-pop-in">
      <div className={cn("relative bg-inset", placeholder && "min-h-[132px]")} style={live ? { aspectRatio: ratioOf(row.aspectRatio, row.kind) } : undefined}>
        {live && <Progress row={row} rows={rows} />}
        {row.status === "failed" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center text-[12.5px] text-danger" role="alert">
            <AlertTriangle size={18} aria-hidden="true" /><span className="line-clamp-4">{row.error ?? "The generation failed"}</span>
          </div>
        )}
        {row.status === "cancelled" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-[12.5px] text-ink-tertiary"><Ban size={18} aria-hidden="true" /><span>Cancelled</span></div>
        )}
        {row.status === "done" && <button type="button" tabIndex={-1} className="block w-full cursor-zoom-in text-left" onClick={() => onAction(row, "open")} aria-label="Open">{!audio && <Media row={row} />}</button>}
        {row.status === "done" && audio && <Media row={row} />}
        {row.outputs.length > 1 && <span className="absolute right-2 top-2 rounded-full bg-app/85 px-2 py-0.5 text-[11px] text-ink-secondary">+{row.outputs.length - 1}</span>}
        {picked && <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-app/85 px-2 py-0.5 text-[11px] text-accent-text"><Send size={10} aria-hidden="true" />Broadcast</span>}
      </div>
      <div className="flex flex-col gap-1 px-2.5 pb-2 pt-2">
        <p className="line-clamp-2 text-[12.5px] leading-snug text-ink" title={row.prompt}>{row.prompt || <span className="text-ink-tertiary">{row.action ? `${row.action[0]!.toUpperCase()}${row.action.slice(1)}` : "No prompt"}</span>}</p>
        <p className="truncate text-[11.5px] text-ink-tertiary">{row.modelLabel} · {row.agentName ?? row.createdByName} · {relativeTime(row.createdAt)}</p>
      </div>
      <div className={cn("flex flex-wrap items-center gap-0.5 border-t border-hairline/30 px-1.5 py-1",
        "md:absolute md:inset-x-0 md:bottom-0 md:border-t-0 md:bg-panel opacity-0 transition-opacity duration-(--motion-fast) group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 max-md:opacity-100")}>
        {actions.filter((spec) => spec.id !== "delete").map((spec) => (
          <button key={spec.id} type="button" disabled={busy} onClick={() => onAction(row, spec.id)} aria-pressed={spec.id === "broadcast" ? picked : undefined}
            title={`${spec.id === "broadcast" && picked ? "Remove from Broadcast" : spec.label}${spec.key ? ` (${spec.key})` : ""}`} aria-label={spec.id === "broadcast" && picked ? "Remove from Broadcast" : spec.label}
            className={cn("flex size-8 items-center justify-center rounded-lg text-ink-secondary outline-none transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40", spec.id === "broadcast" && picked && "text-accent-text")}>
            {busy && spec.id === "cancel" ? <Loader2 size={14} className="animate-spin" /> : <spec.icon size={14} />}
          </button>
        ))}
        <span className="flex-1" />
        {actions.some((spec) => spec.id === "delete") && (
          <button type="button" disabled={busy} onClick={() => onAction(row, "delete")} title="Delete (Del)" aria-label="Delete generation"
            className="flex size-8 items-center justify-center rounded-lg text-ink-secondary outline-none hover:bg-raised hover:text-danger focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"><Trash2 size={14} /></button>
        )}
      </div>
    </article>
  );
}

/** The results canvas: every generation as a masonry tile, newest first, live as teammates and agents add more. */
export function StudioCanvas({ rows, all, canEdit, isAdmin, busy, onAction }: {
  rows: readonly StudioGeneration[]; all: readonly StudioGeneration[]; canEdit: boolean; isAdmin: boolean; busy: ReadonlySet<string>; onAction(row: StudioGeneration, action: TileAction): void;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || typing(event)) return;
    const tiles = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-studio-tile]")];
    const at = tiles.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    const here = tiles[at]!.getBoundingClientRect();
    const centre = (tile: HTMLElement) => { const box = tile.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2, box }; };
    let next = at;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tiles.length - 1;
    else {
      const from = centre(tiles[at]!);
      const candidates = tiles.map((tile, index) => ({ index, ...centre(tile) })).filter(({ index, x, y, box }) => index !== at && (
        event.key === "ArrowRight" ? box.left >= here.right - 4 : event.key === "ArrowLeft" ? box.right <= here.left + 4 : event.key === "ArrowDown" ? y > from.y && Math.abs(x - from.x) < here.width / 2 : y < from.y && Math.abs(x - from.x) < here.width / 2));
      candidates.sort((a, b) => Math.hypot((a.x - from.x) * (event.key.startsWith("ArrowL") || event.key.startsWith("ArrowR") ? 1 : 3), a.y - from.y) - Math.hypot((b.x - from.x) * (event.key.startsWith("ArrowL") || event.key.startsWith("ArrowR") ? 1 : 3), b.y - from.y));
      next = candidates[0]?.index ?? at;
    }
    tiles[next]?.focus();
    tiles[next]?.scrollIntoView({ block: "nearest" });
  };
  return (
    <div className="columns-1 gap-3 min-[480px]:columns-2 md:columns-3 xl:columns-4 2xl:columns-5" onKeyDown={move} data-studio-gallery>
      {rows.map((row) => <Tile key={row._id} row={row} rows={all} canEdit={canEdit} isAdmin={isAdmin} busy={busy.has(row._id)} onAction={onAction} />)}
    </div>
  );
}
