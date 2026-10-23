import type { CanvasSpec } from "./canvas-ops.ts";

export const STICKY_COLORS = [
  { id: "yellow", color: "#FFE588" }, { id: "pink", color: "#FFC2D7" }, { id: "green", color: "#BDEBC0" }, { id: "blue", color: "#BFDBFF" },
  { id: "purple", color: "#DCCBFF" }, { id: "orange", color: "#FFD1A3" }, { id: "gray", color: "#E4E4E7" },
] as const;
export const INK_COLORS = ["#1E1E1E", "#E03131", "#2F9E44", "#1971C2", "#F08C00", "#9C36B5"] as const;
export const STICKY_SIZE = 240;
export const STICKY_NAME = "Sticky";
const STICKY_INK = "#1E1E1E";
const POINTS_MAX = 4000;

type Pair = [number, number];
export interface Box { x: number; y: number; width: number; height: number }

export const stickyColor = (value: string | undefined): string =>
  STICKY_COLORS.find((item) => item.id === value || item.color.toLowerCase() === value?.toLowerCase())?.color ?? STICKY_COLORS[0].color;

/** A sticky note: a coloured square frame holding its text, the shape boards are mostly made of. */
export function stickySpec(note: { text?: string; color?: string; x: number; y: number; key?: string }): CanvasSpec {
  return {
    type: "frame", name: STICKY_NAME, x: Math.round(note.x), y: Math.round(note.y), w: STICKY_SIZE, h: STICKY_SIZE, fill: stickyColor(note.color), radius: 6,
    shadow: { x: 0, y: 2, blur: 6, color: "#0000001A" }, ...(note.key ? { key: note.key } : {}),
    children: [{ type: "text", name: "Note", text: (note.text ?? "").slice(0, 2000), x: 20, y: 20, w: STICKY_SIZE - 40, autoWidth: false, fontSize: 22, lineHeight: 1.35, fill: STICKY_INK }],
  };
}

function perpendicular(point: Pair, start: Pair, end: Pair): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  return Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / length;
}

/** Ramer–Douglas–Peucker: drops points closer than `tolerance` to the line between the points kept around them. */
export function simplify(points: readonly Pair[], tolerance: number): Pair[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Pair[] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let index = first + 1; index < last; index++) {
      const distance = perpendicular(points[index]!, points[first]!, points[last]!);
      if (distance > worst) { worst = distance; at = index; }
    }
    if (worst > tolerance && at > 0) { keep[at] = 1; stack.push([first, at], [at, last]); }
  }
  return points.filter((_, index) => keep[index]);
}

const tenth = (value: number) => Math.round(value * 10) / 10 || 0;

/** A freehand stroke through world `points`, simplified and smoothed into one open vector path. */
export function strokeSpec(points: readonly Pair[], style: { color?: string; width?: number; highlight?: boolean; tolerance?: number }): CanvasSpec | null {
  const clean = points.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (!clean.length) return null;
  let kept = simplify(clean, style.tolerance ?? 0.75);
  if (kept.length === 1) kept = [kept[0]!, [kept[0]![0] + 0.5, kept[0]![1] + 0.5]];
  if (kept.length > POINTS_MAX) { const step = Math.ceil(kept.length / POINTS_MAX); kept = kept.filter((_, index) => index % step === 0); }
  const left = Math.min(...kept.map((point) => point[0]));
  const top = Math.min(...kept.map((point) => point[1]));
  const local = kept.map(([x, y]): Pair => [tenth(x - left), tenth(y - top)]);
  const curves = local.flatMap((_, index) => {
    const before = local[index - 1];
    const after = local[index + 1];
    if (!before || !after) return [0, 0, 0, 0];
    const tx = (after[0] - before[0]) / 6;
    const ty = (after[1] - before[1]) / 6;
    return [-tx, -ty, tx, ty].map(tenth);
  });
  return {
    type: "path", name: style.highlight ? "Highlight" : "Drawing", x: tenth(left), y: tenth(top), points: local, curves,
    stroke: style.color ?? INK_COLORS[0], strokeWidth: style.width ?? (style.highlight ? 18 : 3), fill: null, ...(style.highlight ? { opacity: 0.4 } : {}),
  };
}

function edgeToward(box: Box, toward: Pair): Pair {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (!dx && !dy) return [cx, cy];
  const scale = Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * scale, cy + dy * scale];
}

/** An arrow from the edge of box `from` to the edge of box `to`, along the line between their centres. */
export function connectorSpec(from: Box, to: Box, style: { color?: string; label?: string } = {}): CanvasSpec {
  const start = edgeToward(from, [to.x + to.width / 2, to.y + to.height / 2]);
  const end = edgeToward(to, [from.x + from.width / 2, from.y + from.height / 2]);
  return {
    type: "arrow", name: style.label?.slice(0, 60) || "Connector", x: Math.round(start[0]), y: Math.round(start[1]),
    points: [[0, 0], [Math.round(end[0] - start[0]), Math.round(end[1] - start[1])]], stroke: style.color ?? INK_COLORS[0], strokeWidth: 3,
  };
}
