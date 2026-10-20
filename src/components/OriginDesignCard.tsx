import { useMemo } from "react";
import { ArrowUpRight, PenTool } from "lucide-react";
import type { Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { useCloudQuery } from "@/lib/origin-cloud";
import { requestCanvasFocus } from "@/lib/origin-canvas-focus";
import { useCanOpenOriginProject, useOpenOriginSection } from "@/lib/origin-issue-focus";
import { decodeScene } from "../../shared/canvas-scene";
import { sceneSvg } from "../../shared/canvas-svg";
import type { OriginDesignCard as Card } from "../../shared/origin-design";
import { ghostButton } from "./origin-pages/ui";

type Thumb = { name: string; src: string | null };

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function useFrameThumbs(card: Card): Map<string, Thumb> | undefined {
  const rows = useCloudQuery<string[]>("draw:scene", { teamId: card.teamId, canvasId: card.canvasId });
  return useMemo(() => {
    if (!rows) return undefined;
    const scene = new Map(decodeScene(rows).map((node) => [node.id, node]));
    return new Map(card.frames.map((frame) => {
      const node = scene.get(frame.id);
      if (!node || node.deleted) return [frame.id, { name: frame.name, src: null }];
      const document = sceneSvg(scene, [frame.id], node.fill ? {} : { background: "#FFFFFF" });
      return [frame.id, { name: node.name || frame.name, src: document ? svgDataUrl(document.svg) : null }];
    }));
  }, [rows, card]);
}

/** Canvas frames an Origin design tool worked on, as live thumbnails that open the canvas in Studio's Design mode. */
export function OriginDesignCard({ message }: { message: Message }) {
  const card = message.originDesign;
  return card?.frames.length ? <DesignCard card={card} id={message.id} /> : null;
}

function DesignCard({ card, id }: { card: Card; id: string }) {
  const thumbs = useFrameThumbs(card);
  const openSection = useOpenOriginSection();
  const openable = useCanOpenOriginProject(card.projectId);
  const first = card.frames[0]!;
  const open = () => {
    if (openable) openSection(card.projectId, "draw", () => requestCanvasFocus({ projectId: card.projectId, canvasId: card.canvasId, frameId: first.id }));
  };
  const hint = openable ? `Open ${card.canvasName} in Design` : "No project in this app is linked to this Origin project";
  return (
    <section data-origin-design={id} data-openable={openable || undefined} aria-label={card.heading} className="w-full max-w-[26rem] rounded-2xl bg-inset/50 p-2">
      <div className="flex items-center gap-2 px-2 pb-1.5 pt-1 text-[12px] text-ink-tertiary">
        <span className="min-w-0 flex-1 truncate">{card.heading}</span>
        {card.issueKey ? <span className="shrink-0 tabular-nums">{card.issueKey}</span> : null}
      </div>
      <button type="button" onClick={open} disabled={!openable} title={hint} aria-label={hint}
        className={cn("grid w-full gap-2 rounded-xl p-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60", card.frames.length > 1 && "grid-cols-2", openable ? "cursor-pointer" : "cursor-default")}>
        {card.frames.map((frame) => {
          const thumb = thumbs?.get(frame.id);
          return (
            <figure key={frame.id} data-design-frame={frame.id} className="m-0 min-w-0">
              <div className={cn("flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-hairline/40 bg-panel transition-colors duration-150", openable && "hover:border-accent/50")}>
                {thumb?.src ? <img src={thumb.src} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
                  : thumbs ? <span className="text-[12px] text-ink-tertiary">Not on the canvas</span>
                  : <span className="size-full animate-pulse bg-inset" aria-hidden="true" />}
              </div>
              <figcaption className="truncate px-1 pt-1 text-[12px] text-ink-secondary">{thumb?.name ?? frame.name}</figcaption>
            </figure>
          );
        })}
      </button>
      <div className="flex items-center gap-2 px-1 pb-0.5 pt-1.5">
        <PenTool size={12} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-tertiary">{card.canvasName}</span>
        <button type="button" onClick={open} disabled={!openable} title={openable ? undefined : hint} className={cn(ghostButton, "min-h-7 px-2 py-1 text-[12px]")}>
          Open in Design<ArrowUpRight size={12} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
