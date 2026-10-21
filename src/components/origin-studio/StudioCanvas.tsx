import { useEffect, useState, type KeyboardEvent } from "react";
import { AlertTriangle, ArrowUpFromLine, AudioLines, Ban, BookmarkPlus, Clapperboard, Image as ImageIcon, FastForward, Loader2, Maximize2, RotateCcw, Scissors, Send, Shuffle, Square, Trash2, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/memory";
import { useVideoPoster } from "@/lib/video-poster";
import { formatSeconds, ratioOf, studioCard, typing } from "./studio-ui";
import { studioEta, type StudioGeneration } from "../../../shared/studio";

export type TileAction = "open" | "animate" | "upscale" | "remix" | "removeBackground" | "extend" | "reuse" | "library" | "broadcast" | "cancel" | "delete";

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
  library: { id: "library", label: "Save to library", key: "L", icon: BookmarkPlus },
  broadcast: { id: "broadcast", label: "Add to Publish", key: "B", icon: Send },
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
    if (kind === "image") list.push("library");
  }
  if (canEdit) list.push("reuse");
  if (live && canEdit) list.push("cancel");
  if (canEdit || isAdmin) list.push("delete");
  return list.map((id) => ACTIONS[id]);
}

const KEY_ACTION: Record<string, TileAction> = { a: "animate", u: "upscale", r: "remix", x: "extend", p: "reuse", l: "library", b: "broadcast", Delete: "delete", Backspace: "delete" };

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
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[12.5px] text-ink-secondary" role="status" aria-label={`${row.modelLabel}: ${label}`}>
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-transparent via-raised/40 to-transparent [background-size:200%_100%] motion-safe:animate-shimmer" />
      <span className="relative tabular-nums text-ink">{label}</span>
      <span className="relative text-[11px] tabular-nums text-ink-tertiary">{row.modelLabel} · {formatSeconds(elapsed)}</span>
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-hairline/30" aria-hidden="true">
        <span className="block h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </div>
  );
}

function Unavailable({ kind, ratio }: { kind: "image" | "video"; ratio: string }) {
  const Icon = kind === "video" ? Clapperboard : ImageIcon;
  return (
    <span className="flex w-full items-center justify-center bg-inset" style={{ aspectRatio: ratio }}>
      <span className="flex size-9 items-center justify-center rounded-full bg-raised/70 text-ink-tertiary"><Icon size={16} aria-hidden="true" /></span>
    </span>
  );
}

function VideoMedia({ url, ratio, onBroken }: { url: string; ratio: string; onBroken(): void }) {
  const poster = useVideoPoster(url);
  return (
    <video src={url} poster={poster} muted loop playsInline preload={poster ? "none" : "metadata"} className="block h-auto w-full bg-inset object-cover" style={{ aspectRatio: ratio }} onError={onBroken}
      onMouseEnter={(event) => void event.currentTarget.play().catch(() => undefined)} onMouseLeave={(event) => event.currentTarget.pause()} />
  );
}

function Media({ row }: { row: StudioGeneration }) {
  const [broken, setBroken] = useState(false);
  const output = row.outputs[0];
  if (!output) return null;
  const ratio = ratioOf(row.aspectRatio, output.kind);
  if (broken && output.kind !== "audio") return <Unavailable kind={output.kind} ratio={ratio} />;
  if (output.kind === "image") return <img src={output.url} alt={row.prompt} loading="lazy" className="block h-auto w-full" onError={() => setBroken(true)} />;
  if (output.kind === "video") return <VideoMedia url={output.url} ratio={ratio} onBroken={() => setBroken(true)} />;
  return <audio src={output.url} controls preload="none" className="h-9 w-full [color-scheme:var(--code-color-scheme)]" onClick={(event) => event.stopPropagation()} />;
}

function Tile({ row, rows, canEdit, isAdmin, busy, onAction }: {
  row: StudioGeneration; rows: readonly StudioGeneration[]; canEdit: boolean; isAdmin: boolean; busy: boolean; onAction(row: StudioGeneration, action: TileAction): void;
}) {
  const live = row.status === "queued" || row.status === "running";
  const actions = tileActions(row, canEdit, isAdmin);
  const picked = row.broadcast.some((entry) => entry.index === 0);
  const kind = row.outputs[0]?.kind ?? row.kind;
  const visual = row.status === "done" && Boolean(row.outputs[0]) && kind !== "audio";
  const character = typeof row.params?.character === "string" ? row.params.character : undefined;
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
  const caption = (
    <>
      <p className="line-clamp-2 text-[12.5px] leading-snug text-ink" title={row.prompt}>{row.prompt || <span className="text-ink-tertiary">{row.action ? `${row.action[0]!.toUpperCase()}${row.action.slice(1)}` : "No prompt"}</span>}</p>
      <p className="truncate text-[11px] text-ink-tertiary">{row.modelLabel} · {row.agentName ?? row.createdByName} · {relativeTime(row.createdAt)}</p>
    </>
  );
  return (
    <article tabIndex={0} onKeyDown={onKey} onDoubleClick={() => row.status === "done" && onAction(row, "open")} data-studio-generation={row.status} data-studio-tile={row._id}
      aria-label={`${row.modelLabel} ${row.kind}: ${row.prompt || "no prompt"}`}
      className={cn(studioCard, "mb-3 break-inside-avoid outline-none focus-visible:border-accent motion-safe:animate-pop-in")}>
      {live && <div className="relative bg-inset" style={{ aspectRatio: ratioOf(row.aspectRatio, row.kind) }}><Progress row={row} rows={rows} /></div>}
      {visual && <button type="button" tabIndex={-1} className="block w-full cursor-zoom-in bg-inset text-left" onClick={() => onAction(row, "open")} aria-label="Open"><Media row={row} /></button>}
      {(row.status === "failed" || row.status === "cancelled") && (
        <div className={cn("flex items-start gap-2 px-3 pb-1 pt-3 text-[12.5px] md:pr-20", row.status === "failed" ? "text-danger" : "text-ink-tertiary")} role={row.status === "failed" ? "alert" : undefined}>
          {row.status === "failed" ? <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" /> : <Ban size={14} className="mt-px shrink-0" aria-hidden="true" />}
          <span className="line-clamp-3">{row.status === "failed" ? row.error ?? "The generation failed" : "Cancelled"}</span>
        </div>
      )}
      {row.status === "done" && kind === "audio" && (
        <div className="flex flex-col gap-2 px-3 pt-3">
          <span className="flex items-center gap-1.5 text-[11.5px] text-ink-tertiary"><AudioLines size={14} className="text-accent-text" aria-hidden="true" />{row.modelLabel}</span>
          <Media row={row} />
        </div>
      )}
      {visual ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-app/90 via-app/60 to-transparent px-2.5 pb-2 pt-10 opacity-0 transition-opacity duration-(--motion-fast) group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100">
          {caption}
        </div>
      ) : <div className="flex flex-col gap-0.5 px-3 pb-2.5 pt-2">{caption}</div>}
      <div className="absolute left-2 top-2 flex flex-wrap gap-1">
        {picked && <span className="flex items-center gap-1 rounded-full bg-app/85 px-2 py-0.5 text-[11px] text-accent-text"><Send size={10} aria-hidden="true" />Publish</span>}
        {character && visual && <span className="flex max-w-[140px] items-center gap-1 rounded-full bg-app/85 px-2 py-0.5 text-[11px] text-ink-secondary"><UserRound size={10} aria-hidden="true" /><span className="truncate">{character}</span></span>}
        {row.outputs.length > 1 && <span className="rounded-full bg-app/85 px-2 py-0.5 text-[11px] tabular-nums text-ink-secondary">+{row.outputs.length - 1}</span>}
      </div>
      {actions.length > 0 && (
        <div className={cn("absolute right-1.5 top-1.5 flex max-w-[calc(100%-12px)] flex-wrap items-center justify-end gap-px rounded-lg border border-hairline/40 bg-panel/95 p-0.5",
          "opacity-0 transition-opacity duration-(--motion-fast) group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100",
          visual ? "max-md:hidden" : "max-md:static max-md:mx-2 max-md:mb-2 max-md:w-fit max-md:justify-start max-md:opacity-100")}>
          {actions.map((spec) => (
            <button key={spec.id} type="button" disabled={busy} onClick={() => onAction(row, spec.id)} aria-pressed={spec.id === "broadcast" ? picked : undefined}
              title={`${spec.id === "broadcast" && picked ? "Remove from Publish" : spec.label}${spec.key ? ` (${spec.key})` : ""}`} aria-label={spec.id === "broadcast" && picked ? "Remove from Publish" : spec.id === "delete" ? "Delete generation" : spec.label}
              className={cn("flex size-7 items-center justify-center rounded-md text-ink-secondary outline-none transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40",
                spec.id === "broadcast" && picked && "text-accent-text", spec.id === "delete" && "hover:text-danger")}>
              {busy && spec.id === "cancel" ? <Loader2 size={13} className="animate-spin" /> : <spec.icon size={13} />}
            </button>
          ))}
        </div>
      )}
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
    <div className="columns-2 gap-3 md:columns-3 xl:columns-4 2xl:columns-5" onKeyDown={move} data-studio-gallery>
      {rows.map((row) => <Tile key={row._id} row={row} rows={all} canEdit={canEdit} isAdmin={isAdmin} busy={busy.has(row._id)} onAction={onAction} />)}
    </div>
  );
}
