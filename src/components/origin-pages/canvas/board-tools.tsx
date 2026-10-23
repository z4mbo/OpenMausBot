import { useRef, useState, type ReactNode } from "react";
import { applyCanvasOps, newNode, type CanvasSpec } from "../../../../shared/canvas-ops";
import { ancestors, isLive, nextZ, randomId, type CanvasNode, type Scene } from "../../../../shared/canvas-scene";
import { INK_COLORS, STICKY_COLORS, STICKY_NAME, STICKY_SIZE, stickySpec, strokeSpec } from "../../../../shared/canvas-board";
import { cn } from "@/lib/cn";
import { deleteNodes } from "./actions";
import { measureText, type Point } from "./geometry";
import type { CanvasScene } from "./use-canvas-scene";

export const BOARD_TOOLS = ["draw", "highlight", "sticky", "eraser"] as const;
export type BoardTool = (typeof BOARD_TOOLS)[number];
export const isBoardTool = (tool: string): tool is BoardTool => (BOARD_TOOLS as readonly string[]).includes(tool);

const WIDTHS = [2, 4, 8] as const;
const ERASED_OPACITY = 0.2;

type Pair = [number, number];

/** A path node from a stroke spec, keeping `id` so the drawing previews and saves as one node. */
function strokeNode(spec: CanvasSpec, id: string, z: number): CanvasNode {
  const points = (spec.points ?? []).flat();
  const xs = points.filter((_, at) => at % 2 === 0);
  const ys = points.filter((_, at) => at % 2 === 1);
  return {
    ...newNode("path", null, z, {
      name: spec.name, x: spec.x, y: spec.y, width: Math.max(...xs, 0), height: Math.max(...ys, 0), points, curves: spec.curves,
      stroke: spec.stroke ?? null, strokeWidth: spec.strokeWidth, fill: null, opacity: spec.opacity ?? 1,
    }),
    id,
  };
}

/** The sticky note frame a text node sits in, so a double click on a sticky edits its text at once. */
export function stickyText(scene: Scene, index: ReadonlyMap<string | null, readonly CanvasNode[]>, node: CanvasNode): CanvasNode | undefined {
  if (node.type !== "frame" || node.name !== STICKY_NAME) return undefined;
  return (index.get(node.id) ?? []).find((child) => child.type === "text" && isLive(scene.get(child.id)));
}

/**
 * The whiteboard tools: freehand drawing and highlighting, sticky notes and an eraser that removes whole shapes it
 * touches. Sticky notes and strokes are built by the same shared specs the agents' board tool uses.
 */
export function useBoardTools({ canvas, zoom, onEditText }: { canvas: CanvasScene; zoom: number; onEditText(node: CanvasNode): void }) {
  const [ink, setInk] = useState<string>(INK_COLORS[0]);
  const [width, setWidth] = useState<number>(WIDTHS[1]);
  const [paper, setPaper] = useState<string>(STICKY_COLORS[0].color);
  const stroke = useRef<{ id: string; z: number; points: Pair[]; highlight: boolean } | null>(null);
  const erased = useRef<Map<string, CanvasNode> | null>(null);
  const sticky = useRef<Point | null>(null);
  const { scene, index } = canvas;

  const style = (highlight: boolean) => ({ color: ink, width: highlight ? width * 4 : width, highlight });

  const eraseAt = (client: { clientX: number; clientY: number }) => {
    const hit = document.elementFromPoint(client.clientX, client.clientY)?.closest("[data-node-id]")?.getAttribute("data-node-id");
    const node = hit ? scene.get(hit) : undefined;
    if (!isLive(node) || !erased.current) return;
    const root = [...ancestors(scene, node), node][0]!;
    if (root.locked || erased.current.has(root.id)) return;
    erased.current.set(root.id, root);
    canvas.preview([...erased.current.values()].map((item) => ({ ...item, opacity: item.opacity * ERASED_OPACITY })));
  };

  return {
    /** Starts a gesture that `up` finishes: a stroke, an erase, or a sticky placed where the pointer lifts its first press. */
    down(tool: BoardTool, world: Point, client: { clientX: number; clientY: number }): boolean {
      if (tool === "sticky") { sticky.current = world; return true; }
      if (tool === "eraser") { erased.current = new Map(); eraseAt(client); return true; }
      stroke.current = { id: randomId(), z: nextZ(index.get(null) ?? []), points: [[world.x, world.y]], highlight: tool === "highlight" };
      return true;
    },
    move(world: Point, client: { clientX: number; clientY: number }) {
      if (erased.current) { eraseAt(client); return; }
      const current = stroke.current;
      if (!current) return;
      const last = current.points[current.points.length - 1]!;
      if (Math.hypot(world.x - last[0], world.y - last[1]) * zoom < 1.5) return;
      current.points.push([world.x, world.y]);
      const spec = strokeSpec(current.points, { ...style(current.highlight), tolerance: 0 });
      if (spec) canvas.preview([strokeNode({ ...spec, curves: undefined }, current.id, current.z)]);
    },
    up() {
      if (sticky.current) {
        const at = sticky.current;
        sticky.current = null;
        const result = applyCanvasOps(scene, [{ op: "create", node: stickySpec({ x: at.x - STICKY_SIZE / 2, y: at.y - STICKY_SIZE / 2, color: paper }) }], { measure: measureText });
        canvas.commit(result.changed);
        const text = result.changed.find((node) => node.type === "text");
        if (text) onEditText(text);
        return;
      }
      if (erased.current) {
        const ids = [...erased.current.keys()];
        erased.current = null;
        canvas.preview(null);
        if (ids.length) canvas.commit(deleteNodes(scene, index, ids));
        return;
      }
      const current = stroke.current;
      stroke.current = null;
      canvas.preview(null);
      const spec = current ? strokeSpec(current.points, { ...style(current.highlight), tolerance: 0.75 / zoom }) : null;
      if (current && spec) canvas.commit([strokeNode(spec, current.id, current.z)]);
    },
    /** The colour and size choices shown above the toolbar while a board tool is on. */
    options(tool: string): ReactNode {
      if (tool === "sticky") return <Swatches label="Sticky colour" colors={STICKY_COLORS.map((item) => item.color)} value={paper} onChange={setPaper} />;
      if (tool !== "draw" && tool !== "highlight") return null;
      return (
        <>
          <Swatches label="Ink colour" colors={INK_COLORS} value={ink} onChange={setInk} />
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline/60" />
          <div role="radiogroup" aria-label="Stroke width" className="flex items-center gap-0.5">
            {WIDTHS.map((size) => (
              <button key={size} type="button" role="radio" aria-checked={width === size} aria-label={`${size} pixels`} onClick={() => setWidth(size)}
                className={cn("inline-flex size-7 items-center justify-center rounded-lg outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60", width === size && "bg-raised")}>
                <span className="rounded-full bg-ink" style={{ width: size + 2, height: size + 2 }} />
              </button>
            ))}
          </div>
        </>
      );
    },
  };
}

function Swatches({ label, colors, value, onChange }: { label: string; colors: readonly string[]; value: string; onChange(color: string): void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5">
      {colors.map((color) => (
        <button key={color} type="button" role="radio" aria-checked={value === color} aria-label={color} onClick={() => onChange(color)}
          className={cn("inline-flex size-7 items-center justify-center rounded-lg outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60", value === color && "bg-raised")}>
          <span className={cn("size-4 rounded-full ring-1 ring-hairline/60", value === color && "ring-2 ring-accent")} style={{ backgroundColor: color }} />
        </button>
      ))}
    </div>
  );
}
