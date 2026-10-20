import { estimateTextWidth, fontStack, worldOrigin, type CanvasNode, type Scene, type TextMeasure } from "../../../../shared/canvas-scene";

export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type View = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;
export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const toWorld = (view: View, point: Point): Point => ({ x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom });
export const toScreen = (view: View, point: Point): Point => ({ x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y });

export function fontString(node: Pick<CanvasNode, "fontSize" | "fontWeight" | "font" | "family">): string {
  return `${node.fontWeight ?? 400} ${node.fontSize ?? 16}px ${fontStack(node)}`;
}

let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

export const forgetTextWidths = () => widths.clear();

export const measureText: TextMeasure = (text, node) => {
  if (context === undefined) {
    try { context = document.createElement("canvas").getContext("2d"); } catch { context = null; }
  }
  if (!context) return estimateTextWidth(text, node);
  const font = fontString(node);
  const key = `${font}\u0000${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    context.font = font;
    width = context.measureText(text).width;
    if (widths.size > 20_000) widths.clear();
    widths.set(key, width);
  }
  return width;
};

export function rotatePoint(point: Point, center: Point, degrees: number): Point {
  if (!degrees) return point;
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

export function corners(box: Box, rotation: number): Point[] {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return [
    { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height },
  ].map((point) => rotatePoint(point, center, rotation));
}

export function worldBox(scene: Scene, node: CanvasNode): Box {
  const origin = worldOrigin(scene, node);
  return { x: origin.x, y: origin.y, width: node.width, height: node.height };
}

export function worldBounds(scene: Scene, node: CanvasNode): Box {
  return boundsOf(corners(worldBox(scene, node), node.rotation));
}

export function boundsOf(points: readonly Point[]): Box {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  return boundsOf(boxes.flatMap((box) => [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }]));
}

export const intersects = (a: Box, b: Box) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
export const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
export const containsPoint = (box: Box, point: Point) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

export function normalizedBox(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

const edges = (box: Box, axis: "x" | "y") => axis === "x"
  ? [box.x, box.x + box.width / 2, box.x + box.width]
  : [box.y, box.y + box.height / 2, box.y + box.height];

export function snapBox(moving: Box, targets: readonly Box[], threshold: number, axes: { x: boolean; y: boolean } = { x: true, y: true }, only?: { x?: number[]; y?: number[] }) {
  const result = { dx: 0, dy: 0, guides: [] as Guide[] };
  for (const axis of ["x", "y"] as const) {
    if (!axes[axis]) continue;
    const mine = only?.[axis] ? edges(moving, axis).filter((_, index) => only[axis]!.includes(index)) : edges(moving, axis);
    let best = threshold + 1;
    let delta = 0;
    for (const target of targets) for (const line of edges(target, axis)) for (const edge of mine) {
      const distance = Math.abs(line - edge);
      if (distance < best) { best = distance; delta = line - edge; }
    }
    if (best > threshold) continue;
    if (axis === "x") result.dx = delta; else result.dy = delta;
    const snapped = axis === "x" ? { ...moving, x: moving.x + delta } : { ...moving, y: moving.y + delta };
    for (const target of targets) for (const line of edges(target, axis)) {
      if (!edges(snapped, axis).some((edge) => Math.abs(edge - line) < 0.01)) continue;
      const cross = axis === "x" ? [snapped.y, snapped.y + snapped.height, target.y, target.y + target.height] : [snapped.x, snapped.x + snapped.width, target.x, target.x + target.width];
      result.guides.push({ axis, at: line, from: Math.min(...cross), to: Math.max(...cross) });
    }
  }
  return result;
}

export function fitView(box: Box, viewport: { width: number; height: number }, padding = 64, maxZoom = 1): View {
  const zoom = clampZoom(Math.min(maxZoom, (viewport.width - padding * 2) / Math.max(1, box.width), (viewport.height - padding * 2) / Math.max(1, box.height)));
  return { zoom, x: viewport.width / 2 - (box.x + box.width / 2) * zoom, y: viewport.height / 2 - (box.y + box.height / 2) * zoom };
}
