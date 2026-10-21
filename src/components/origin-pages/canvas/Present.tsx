import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ancestors, type CanvasNode, type PrototypeLink, type Scene } from "../../../../shared/canvas-scene";
import { NodeView } from "./NodeView";

const button = "inline-flex size-8 items-center justify-center rounded-lg text-ink-secondary outline-none transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-35";

/** Plays the page's frames full screen: clicks follow prototype links, arrows step through frames in reading order. */
export function Present({ scene, index, images, start, onClose }: {
  scene: Scene; index: ReadonlyMap<string | null, readonly CanvasNode[]>; images: ReadonlyMap<string, string>; start: string | null; onClose(): void;
}) {
  const frames = useMemo(() => (index.get(null) ?? []).filter((node) => node.type === "frame" && !node.hidden).sort((a, b) => a.y - b.y || a.x - b.x), [index]);
  const [current, setCurrent] = useState<{ id: string; transition: PrototypeLink["transition"]; step: number }>(() => ({ id: start ?? frames[0]?.id ?? "", transition: "instant", step: 0 }));
  const [box, setBox] = useState({ width: 0, height: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const frame = scene.get(current.id);
  const at = frames.findIndex((item) => item.id === current.id);
  const go = (id: string | undefined, transition: PrototypeLink["transition"] = "dissolve") => { if (id && scene.get(id)) setCurrent((now) => ({ id, transition, step: now.step + 1 })); };

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      else if (event.key === "ArrowRight" || event.key === " ") { event.preventDefault(); go(frames[at + 1]?.id, "slide"); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); go(frames[at - 1]?.id, "instant"); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  const options = useMemo(() => ({ index, images, interactive: true, prefix: "p-" }), [index, images]);
  if (!frame) return null;
  const scale = Math.min((box.width - 32) / Math.max(1, frame.width), (box.height - 32) / Math.max(1, frame.height), 4);
  const click = (target: Element) => {
    const id = target.closest("[data-node-id]")?.getAttribute("data-node-id");
    const node = id ? scene.get(id) : undefined;
    if (!node) return;
    const linked = [node, ...[...ancestors(scene, node)].reverse()].find((item) => item.prototype);
    if (linked?.prototype) go(linked.prototype.to, linked.prototype.transition);
  };
  const animation = current.transition === "dissolve" ? "origin-present-dissolve" : current.transition === "slide" ? "origin-present-slide" : "";
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Presenting ${frame.name}`} className="fixed inset-0 z-[100] flex flex-col bg-app text-ink">
      <style>{"@keyframes origin-present-dissolve{from{opacity:0}to{opacity:1}}@keyframes origin-present-slide{from{opacity:.4;transform:translateX(48px)}to{opacity:1;transform:none}}"
        + ".origin-present-dissolve{animation:origin-present-dissolve 220ms ease-out}.origin-present-slide{animation:origin-present-slide 260ms cubic-bezier(.2,.8,.2,1)}"
        + "@media (prefers-reduced-motion:reduce){.origin-present-dissolve,.origin-present-slide{animation:none}}"}</style>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline/40 px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{frame.name}</span>
        <span className="text-[12px] tabular-nums text-ink-tertiary">{at + 1} / {frames.length}</span>
        <button type="button" className={button} aria-label="Previous frame" disabled={at <= 0} onClick={() => go(frames[at - 1]?.id, "instant")}><ChevronLeft size={16} /></button>
        <button type="button" className={button} aria-label="Next frame" disabled={at >= frames.length - 1} onClick={() => go(frames[at + 1]?.id, "slide")}><ChevronRight size={16} /></button>
        <button type="button" className={button} aria-label="Stop presenting" onClick={onClose}><X size={16} /></button>
      </div>
      <div ref={stage} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden" onClick={(event) => click(event.target as Element)}>
        {box.width > 0 && (
          <svg key={`${current.id}-${current.step}`} className={animation} width={frame.width * scale} height={frame.height * scale} viewBox={`0 0 ${frame.width} ${frame.height}`} role="img" aria-label={frame.name}
            style={{ cursor: "default" }}>
            <NodeView node={{ ...frame, x: 0, y: 0 }} options={options} />
          </svg>
        )}
      </div>
    </div>,
    document.body,
  );
}
