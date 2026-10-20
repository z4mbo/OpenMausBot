import type { CanvasNode } from "../../../../shared/canvas-scene";
import type { Point } from "./geometry";
import { anchorsOf, withAnchors, type Anchor } from "./pen";

export type Segment = { from: number; to: number };

/** Each drawn segment of a path, the closing segment of every closed subpath included. */
export function segmentsOf(node: Pick<CanvasNode, "points" | "breaks" | "closed">): Segment[] {
  const count = Math.floor((node.points?.length ?? 0) / 2);
  const starts = [0, ...(node.breaks ?? []).filter((at) => at > 0 && at < count), count];
  const out: Segment[] = [];
  for (let part = 0; part + 1 < starts.length; part++) {
    const first = starts[part]!;
    const last = starts[part + 1]! - 1;
    for (let at = first; at < last; at++) out.push({ from: at, to: at + 1 });
    if (node.closed && last > first) out.push({ from: last, to: first });
  }
  return out;
}

type Cubic = [Point, Point, Point, Point];

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const at = ([p0, p1, p2, p3]: Cubic, t: number): Point => lerp(lerp(lerp(p0, p1, t), lerp(p1, p2, t), t), lerp(lerp(p1, p2, t), lerp(p2, p3, t), t), t);

export function cubicOf(anchors: readonly Anchor[], segment: Segment): Cubic {
  const a = anchors[segment.from]!;
  const d = anchors[segment.to]!;
  return [a.point, { x: a.point.x + a.out.x, y: a.point.y + a.out.y }, { x: d.point.x + d.in.x, y: d.point.y + d.in.y }, d.point];
}

/** The parameter of the point on a cubic closest to `point`: coarse samples, then a narrowing search around the best. */
export function nearestT(curve: Cubic, point: Point): number {
  const distance = (t: number) => { const p = at(curve, t); return (p.x - point.x) ** 2 + (p.y - point.y) ** 2; };
  let best = 0;
  for (let step = 1; step <= 64; step++) if (distance(step / 64) < distance(best)) best = step / 64;
  let low = Math.max(0, best - 1 / 64);
  let high = Math.min(1, best + 1 / 64);
  for (let round = 0; round < 30; round++) {
    const a = low + (high - low) / 3;
    const b = high - (high - low) / 3;
    if (distance(a) < distance(b)) high = b; else low = a;
  }
  return (low + high) / 2;
}

/** Splits a cubic at `t` (de Casteljau): the two halves share the new point and keep the curve's shape. */
export function splitCubic([p0, p1, p2, p3]: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  const middle = lerp(ab, bc, t);
  return [[p0, a, ab, middle], [middle, bc, c, p3]];
}

const offset = (from: Point, to: Point): Point => ({ x: to.x - from.x, y: to.y - from.y });

/** The path with a new anchor on `segment` nearest to `world`, the curve unchanged; and the new anchor's index. */
export function insertAnchor(node: CanvasNode, origin: Point, segment: Segment, world: Point): { node: CanvasNode; at: number } {
  const anchors = anchorsOf(node, origin);
  const curve = cubicOf(anchors, segment);
  const straight = !anchors[segment.from]!.out.x && !anchors[segment.from]!.out.y && !anchors[segment.to]!.in.x && !anchors[segment.to]!.in.y;
  const t = nearestT(curve, world);
  const [left, right] = splitCubic(curve, t);
  const point = { x: Math.round(left[3].x * 100) / 100, y: Math.round(left[3].y * 100) / 100 };
  const inserted: Anchor = straight ? { at: -1, point, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } } : { at: -1, point, in: offset(left[3], left[2]), out: offset(right[0], right[1]) };
  const index = segment.to === segment.from + 1 ? segment.to : segment.from + 1;
  const next = anchors.map((anchor, position) => {
    if (straight) return anchor;
    if (position === segment.from) return { ...anchor, out: offset(left[0], left[1]) };
    if (position === segment.to) return { ...anchor, in: offset(right[3], right[2]) };
    return anchor;
  });
  next.splice(index, 0, inserted);
  const breaks = node.breaks?.map((start) => (start >= index ? start + 1 : start));
  return { node: withAnchors({ ...node, breaks }, origin, next), at: index };
}

/** A `data-segment` hit ("from:to") turned into the path with the new anchor, its index and its world origin, for dragging it. */
export function addPointAt(node: CanvasNode, origin: Point, hit: string, world: Point): { node: CanvasNode; at: number; origin: Point; anchors: Anchor[] } | null {
  const [from, to] = hit.split(":").map(Number);
  const count = Math.floor((node.points?.length ?? 0) / 2);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from! < 0 || to! < 0 || from! >= count || to! >= count) return null;
  const added = insertAnchor(node, origin, { from: from!, to: to! }, world);
  const moved = { x: origin.x + added.node.x - node.x, y: origin.y + added.node.y - node.y };
  return { ...added, origin: moved, anchors: anchorsOf(added.node, moved) };
}
