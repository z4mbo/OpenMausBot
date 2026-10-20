import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type { View } from "./geometry";

export type PageGuide = { axis: "x" | "y"; at: number };

export const RULER = 20;
const STEPS = [1, 2, 5];

function tickStep(zoom: number): number {
  for (let power = -2; power < 7; power++) for (const step of STEPS) { const value = step * 10 ** power; if (value * zoom >= 56) return value; }
  return 1e7;
}

function ticks(start: number, length: number, view: View, axis: "x" | "y") {
  const step = tickStep(view.zoom);
  const offset = axis === "x" ? view.x : view.y;
  const first = Math.floor((start - offset) / view.zoom / step) * step;
  const out: { at: number; label: string }[] = [];
  for (let value = first; (value * view.zoom + offset) < start + length; value += step) {
    const at = value * view.zoom + offset;
    if (at >= start) out.push({ at, label: String(Math.round(value * 100) / 100) });
  }
  return out;
}

/** Rulers along the stage's top and left edges; drag out of one to add a guide, drag a guide back onto it to remove it. */
export function Rulers({ view, size, insets, guides, onGuides, readOnly, selection }: {
  view: View; size: { width: number; height: number }; insets: { left: number; right: number }; guides: readonly PageGuide[]; onGuides(guides: PageGuide[]): void; readOnly: boolean;
  selection: { x: number; y: number; width: number; height: number } | null;
}) {
  const [drag, setDrag] = useState<{ index: number | null; axis: "x" | "y"; at: number } | null>(null);
  const world = (axis: "x" | "y", screen: number) => Math.round((screen - (axis === "x" ? view.x : view.y)) / view.zoom);
  const local = (event: ReactPointerEvent) => {
    const stage = (event.currentTarget as HTMLElement).closest("[data-canvas-stage]")!.getBoundingClientRect();
    return { x: event.clientX - stage.left, y: event.clientY - stage.top };
  };
  const start = (event: ReactPointerEvent, axis: "x" | "y", index: number | null) => {
    if (readOnly || event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const point = local(event);
    setDrag({ index, axis, at: world(axis, axis === "x" ? point.x : point.y) });
  };
  const move = (event: ReactPointerEvent) => {
    if (!drag) return;
    const point = local(event);
    setDrag({ ...drag, at: world(drag.axis, drag.axis === "x" ? point.x : point.y) });
  };
  const end = (event: ReactPointerEvent) => {
    if (!drag) return;
    const point = local(event);
    const gone = drag.axis === "x" ? point.x < insets.left + RULER : point.y < RULER;
    const next = guides.filter((_, index) => index !== drag.index);
    onGuides(gone ? next : [...next, { axis: drag.axis, at: drag.at }]);
    setDrag(null);
  };
  const shown = guides.map((guide, index) => (drag?.index === index ? { ...guide, at: drag.at } : guide));
  if (drag && drag.index === null) shown.push({ axis: drag.axis, at: drag.at });
  const edges = (axis: "x" | "y") => (selection ? [axis === "x" ? selection.x : selection.y, axis === "x" ? selection.x + selection.width : selection.y + selection.height].map((value) => value * view.zoom + (axis === "x" ? view.x : view.y)) : []);
  const crowded = (axis: "x" | "y", at: number) => edges(axis).some((edge) => Math.abs(edge - at) < 30);
  const band = "absolute z-10 overflow-hidden bg-app/90 text-[9.5px] tabular-nums text-ink-tertiary select-none";
  const highlight = (axis: "x" | "y") => {
    if (!selection) return null;
    const from = (axis === "x" ? selection.x : selection.y) * view.zoom + (axis === "x" ? view.x - insets.left : view.y);
    const length = (axis === "x" ? selection.width : selection.height) * view.zoom;
    const edge = "absolute z-[1] bg-app px-0.5 font-medium leading-[14px] text-accent-text";
    const value = (offset: number) => Math.round((axis === "x" ? selection.x : selection.y) + offset);
    const size = axis === "x" ? selection.width : selection.height;
    return (
      <>
        <span aria-hidden="true" className="absolute bg-accent/[0.07]" style={axis === "x" ? { left: from, width: length, top: 0, bottom: 0 } : { top: from, height: length, left: 0, right: 0 }} />
        {from >= RULER && <span data-ruler-edge className={axis === "x" ? edge : `${edge} [writing-mode:vertical-rl] rotate-180`} style={axis === "x" ? { left: from, top: 0 } : { top: from, left: 0, width: RULER }}>{value(0)}</span>}
        {length > 28 && <span data-ruler-edge className={axis === "x" ? edge : `${edge} [writing-mode:vertical-rl] rotate-180`} style={axis === "x" ? { left: from + length, top: 0, transform: "translateX(-100%)" } : { top: from + length, left: 0, width: RULER, transform: "translateY(-100%) rotate(180deg)" }}>{value(size)}</span>}
      </>
    );
  };
  return (
    <div data-canvas-chrome className="contents" onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
      <div aria-hidden="true" className={`${band} top-0 border-b border-hairline/40`} style={{ left: insets.left, right: insets.right, height: RULER, cursor: readOnly ? "default" : "row-resize" }}
        onPointerDown={(event) => start(event, "y", null)}>
        {highlight("x")}
        {ticks(insets.left + RULER, size.width - insets.left - insets.right - RULER, view, "x").map((tick) => (
          <span key={tick.at} className="absolute top-0 h-full border-l border-hairline/60 pl-0.5 leading-[14px]" style={{ left: tick.at - insets.left }}>{crowded("x", tick.at) ? "" : tick.label}</span>
        ))}
      </div>
      <div aria-hidden="true" className={`${band} bottom-0 top-0 border-r border-hairline/40`} style={{ left: insets.left, width: RULER, cursor: readOnly ? "default" : "col-resize" }}
        onPointerDown={(event) => start(event, "x", null)}>
        {highlight("y")}
        {ticks(RULER, size.height, view, "y").map((tick) => (
          <span key={tick.at} className="absolute left-0 w-full border-t border-hairline/60 [writing-mode:vertical-rl] rotate-180 leading-[14px]" style={{ top: tick.at }}>{crowded("y", tick.at) ? "" : tick.label}</span>
        ))}
      </div>
      <span aria-hidden="true" className="absolute top-0 z-10 border-b border-r border-hairline/40 bg-app" style={{ left: insets.left, width: RULER, height: RULER }} />
      {shown.map((guide, index) => {
        const at = guide.at * view.zoom + (guide.axis === "x" ? view.x : view.y);
        return (
          <div key={`${guide.axis}-${index}`} data-guide={index} title={`${guide.axis === "x" ? "X" : "Y"} ${guide.at}`}
            onPointerDown={(event) => start(event, guide.axis, index < guides.length ? index : null)}
            className="absolute z-[5]"
            style={guide.axis === "x"
              ? { left: at - 3, top: 0, bottom: 0, width: 7, cursor: readOnly ? "default" : "col-resize" }
              : { top: at - 3, left: 0, right: 0, height: 7, cursor: readOnly ? "default" : "row-resize" }}>
            <span className="pointer-events-none absolute bg-accent/80" style={guide.axis === "x" ? { left: 3, top: 0, bottom: 0, width: 1 } : { top: 3, left: 0, right: 0, height: 1 }} />
          </div>
        );
      })}
    </div>
  );
}
