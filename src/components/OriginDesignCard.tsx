import { useMemo } from "react";
import { ArrowUpRight, PenTool, Presentation, StickyNote } from "lucide-react";
import type { Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { useCloudQuery } from "@/lib/origin-cloud";
import { requestCanvasFocus } from "@/lib/origin-canvas-focus";
import { useCanOpenOriginProject, useOpenOriginSection } from "@/lib/origin-issue-focus";
import { childrenIndex, decodeScene } from "../../shared/canvas-scene";
import { sceneSvg } from "../../shared/canvas-svg";
import type { CanvasKind, OriginDesignCard as Card } from "../../shared/origin-design";
import { CardFrame, quietButton } from "./origin-cards/CardFrame";

type Thumb = { id: string; name: string; src: string | null };

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const KINDS: Record<CanvasKind, { icon: typeof PenTool; open: string }> = {
  design: { icon: PenTool, open: "Open in Design" },
  board: { icon: StickyNote, open: "Open board" },
  deck: { icon: Presentation, open: "Open presentation" },
};

function useThumbs(card: Card): Thumb[] | undefined {
  const rows = useCloudQuery<string[]>("draw:scene", { teamId: card.teamId, canvasId: card.canvasId });
  return useMemo(() => {
    if (!rows) return undefined;
    const scene = new Map(decodeScene(rows).map((node) => [node.id, node]));
    if (card.kind === "board") {
      const roots = (childrenIndex(scene).get(null) ?? []).filter((node) => !node.page && !node.hidden);
      const document = roots.length ? sceneSvg(scene, [], { roots, padding: 40, background: "#FFFFFF" }) : null;
      return [{ id: card.canvasId, name: card.canvasName, src: document ? svgDataUrl(document.svg) : null }];
    }
    return card.frames.map((frame) => {
      const node = scene.get(frame.id);
      if (!node || node.deleted) return { id: frame.id, name: frame.name, src: null };
      const document = sceneSvg(scene, [frame.id], node.fill ? {} : { background: "#FFFFFF" });
      return { id: frame.id, name: node.name || frame.name, src: document ? svgDataUrl(document.svg) : null };
    });
  }, [rows, card]);
}

/** What an Origin canvas tool worked on, as live thumbnails that open it on the project's Design page: frames, slides, or a whole board. */
export function OriginDesignCard({ message }: { message: Message }) {
  const card = message.originDesign;
  return card && (card.frames.length || card.kind === "board") ? <DesignCard card={card} id={message.id} /> : null;
}

function DesignCard({ card, id }: { card: Card; id: string }) {
  const kind = card.kind ?? "design";
  const thumbs = useThumbs(card);
  const openSection = useOpenOriginSection();
  const openable = useCanOpenOriginProject(card.projectId);
  const shown = kind === "board" ? [{ id: card.canvasId, name: card.canvasName }] : card.frames;
  const open = () => {
    if (openable) openSection(card.projectId, "design", () => requestCanvasFocus({ projectId: card.projectId, canvasId: card.canvasId, frameId: card.frames[0]?.id ?? "" }));
  };
  const hint = openable ? `${KINDS[kind].open}: ${card.canvasName}` : "No project in this app is linked to this Origin project";
  return (
    <CardFrame kind="design" data={{ "data-origin-design": id, "data-design-kind": kind, "data-openable": openable ? "true" : undefined }} label={card.heading} icon={KINDS[kind].icon} title={card.heading}
      meta={[card.canvasName, card.issueKey].filter(Boolean).join(" · ")}>
      <button type="button" onClick={open} disabled={!openable} title={hint} aria-label={hint}
        className={cn("mt-2.5 grid w-full gap-2 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60", shown.length > 1 && "grid-cols-2", openable ? "cursor-pointer" : "cursor-default")}>
        {shown.map((frame, at) => {
          const thumb = thumbs?.[at];
          return (
            <figure key={frame.id} data-design-frame={frame.id} className="m-0 min-w-0">
              <div className={cn("flex items-center justify-center overflow-hidden rounded-xl border border-hairline/40 bg-panel transition-colors duration-150", kind === "deck" ? "aspect-video" : "aspect-[4/3]", openable && "hover:border-accent/50")}>
                {thumb?.src ? <img src={thumb.src} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
                  : thumbs ? <span className="text-[12px] text-ink-tertiary">{kind === "board" ? "The board is empty" : "Not on the canvas"}</span>
                  : <span className="size-full animate-pulse bg-inset" aria-hidden="true" />}
              </div>
              <figcaption className="truncate px-1 pt-1 text-[12px] text-ink-secondary">{thumb?.name ?? frame.name}</figcaption>
            </figure>
          );
        })}
      </button>
      <div className="mt-2.5 flex">
        <button type="button" onClick={open} disabled={!openable} title={openable ? undefined : hint} className={quietButton}>
          <ArrowUpRight size={12} aria-hidden="true" />{KINDS[kind].open}
        </button>
      </div>
    </CardFrame>
  );
}
