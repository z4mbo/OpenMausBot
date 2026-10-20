import { useEffect, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FolderCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/memory";
import { Modal, ghostButton, iconButton } from "../origin-pages/ui";
import { tileActions, type TileAction } from "./StudioCanvas";
import { typing } from "./studio-ui";
import { STUDIO_CAMERA_MOTIONS, type StudioGeneration } from "../../../shared/studio";

const KEYS: Record<string, TileAction> = { a: "animate", u: "upscale", r: "remix", x: "extend", p: "reuse", l: "library", b: "broadcast" };

function settings(row: StudioGeneration): string[] {
  const params = row.params ?? {};
  return [
    row.aspectRatio, row.duration && (row.duration.endsWith("s") ? row.duration : `${row.duration}s`),
    typeof params.resolution === "string" ? params.resolution : undefined, typeof params.voice === "string" ? params.voice : undefined,
    typeof params.motion === "string" ? STUDIO_CAMERA_MOTIONS.find((motion) => motion.id === params.motion)?.label : undefined,
    params.sound === false ? "silent" : undefined, typeof params.seed === "number" ? `seed ${params.seed}` : undefined,
    typeof params.references === "number" ? `${params.references} reference${params.references === 1 ? "" : "s"}` : undefined,
    typeof params.character === "string" ? params.character : undefined, row.branded ? "brand kit" : undefined,
  ].filter((value): value is string => Boolean(value));
}

/** One generation at full size with its settings, lineage and actions; arrow keys walk the canvas. */
export function StudioViewer({ row, rows, canEdit, isAdmin, busy, onAction, onMove, onClose }: {
  row: StudioGeneration; rows: readonly StudioGeneration[]; canEdit: boolean; isAdmin: boolean; busy: boolean;
  onAction(row: StudioGeneration, action: TileAction): void; onMove(step: -1 | 1): void; onClose(): void;
}) {
  const output = row.outputs[0];
  const parent = row.parentId ? rows.find((candidate) => candidate._id === row.parentId) : undefined;
  const children = rows.filter((candidate) => candidate.parentId === row._id);
  const actions = tileActions(row, canEdit, isAdmin).filter((spec) => spec.id !== "delete" && spec.id !== "open");
  const picked = row.broadcast.some((entry) => entry.index === 0);
  useEffect(() => {
    if (output?.kind !== "video") return;
    const video = document.querySelector<HTMLVideoElement>("[data-studio-viewer] video");
    void video?.play().catch(() => undefined);
  }, [output]);
  const onKey = (event: KeyboardEvent) => {
    if (typing(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onMove(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    const action = KEYS[event.key.toLowerCase()];
    if (action && actions.some((spec) => spec.id === action)) {
      event.preventDefault();
      onAction(row, action);
    }
  };
  return (
    <Modal title={row.modelLabel} onClose={onClose} wide className="sm:max-w-6xl">
      <div className="flex flex-col gap-4 lg:flex-row" onKeyDown={onKey} data-studio-viewer>
        <div className="relative flex min-h-[200px] flex-1 items-center justify-center overflow-hidden rounded-xl bg-inset">
          {output?.kind === "image" && <img src={output.url} alt={row.prompt} className="max-h-[70vh] w-auto max-w-full object-contain" />}
          {output?.kind === "video" && <video src={output.url} controls loop playsInline className="max-h-[70vh] w-full" />}
          {output?.kind === "audio" && <audio src={output.url} controls autoPlay className="w-[min(100%,420px)] [color-scheme:var(--code-color-scheme)]" />}
          <button type="button" className={cn(iconButton, "absolute left-2 top-1/2 -translate-y-1/2 bg-app/80")} onClick={() => onMove(-1)} aria-label="Previous (←)"><ChevronLeft size={16} /></button>
          <button type="button" className={cn(iconButton, "absolute right-2 top-1/2 -translate-y-1/2 bg-app/80")} onClick={() => onMove(1)} aria-label="Next (→)"><ChevronRight size={16} /></button>
        </div>
        <aside className="flex w-full flex-col gap-3 lg:w-72">
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{row.prompt || <span className="text-ink-tertiary">No prompt</span>}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-ink-tertiary">Model</dt><dd className="truncate text-ink-secondary">{row.modelLabel}</dd>
            <dt className="text-ink-tertiary">By</dt><dd className="truncate text-ink-secondary">{row.agentName ? `${row.agentName} for ${row.createdByName}` : row.createdByName} · {relativeTime(row.createdAt)}</dd>
            {settings(row).length > 0 && <><dt className="text-ink-tertiary">Settings</dt><dd className="text-ink-secondary">{settings(row).join(" · ")}</dd></>}
            {parent && <><dt className="text-ink-tertiary capitalize">{row.action ?? "From"}</dt><dd className="truncate text-ink-secondary">of “{parent.prompt || parent.modelLabel}”</dd></>}
            {children.length > 0 && <><dt className="text-ink-tertiary">Made from it</dt><dd className="text-ink-secondary">{children.map((child) => child.action ?? child.modelLabel).join(", ")}</dd></>}
          </dl>
          {row.saved.length > 0 && <p className="flex items-center gap-1.5 text-[12px] text-ink-secondary"><FolderCheck size={14} className="text-success" aria-hidden="true" />In Assets · Studio</p>}
          <div className="flex flex-wrap gap-1.5">
            {actions.map((spec) => (
              <button key={spec.id} type="button" className={cn(ghostButton, "h-8 min-h-8 px-2.5 text-[12.5px]", spec.id === "broadcast" && picked && "border-accent/50 text-accent-text")} disabled={busy}
                aria-pressed={spec.id === "broadcast" ? picked : undefined} onClick={() => onAction(row, spec.id)} title={spec.key ? `${spec.label} (${spec.key})` : spec.label}>
                <spec.icon size={13} />{spec.id === "broadcast" && picked ? "In Broadcast" : spec.label}
              </button>
            ))}
            {output && <a className={cn(ghostButton, "h-8 min-h-8 px-2.5 text-[12.5px]")} href={output.url} target="_blank" rel="noreferrer"><ExternalLink size={13} />Original</a>}
          </div>
        </aside>
      </div>
    </Modal>
  );
}
