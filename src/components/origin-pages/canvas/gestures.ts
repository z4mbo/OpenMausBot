import { descendants, effectiveParent, worldOrigin, type CanvasNode, type Scene } from "../../../../shared/canvas-scene";
import { rotatePoint, worldBox, type Box, type Point } from "./geometry";
import type { Handle } from "./Overlay";

const SIDES: Record<Handle, [number, number]> = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };

export function resizeBox(box: Box, handle: Handle, pointer: Point, keepRatio: boolean, fromCentre: boolean): Box {
  const [sx, sy] = SIDES[handle];
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const ax = fromCentre || !sx ? cx : sx === 1 ? box.x : box.x + box.width;
  const ay = fromCentre || !sy ? cy : sy === 1 ? box.y : box.y + box.height;
  const reach = fromCentre ? 2 : 1;
  let width = sx ? (pointer.x - ax) * sx * reach : box.width;
  let height = sy ? (pointer.y - ay) * sy * reach : box.height;
  if (keepRatio && box.width > 0 && box.height > 0) {
    const ratio = box.width / box.height;
    if (!sx) width = Math.abs(height) * ratio;
    else if (!sy) height = Math.abs(width) / ratio;
    else if (Math.abs(width) / ratio > Math.abs(height)) height = Math.sign(height || 1) * Math.abs(width) / ratio;
    else width = Math.sign(width || 1) * Math.abs(height) * ratio;
  }
  const start = (anchor: number, centre: number, side: number, size: number) => {
    if (fromCentre || !side) return centre - Math.abs(size) / 2;
    if (side === 1) return size >= 0 ? anchor : anchor + size;
    return size >= 0 ? anchor - size : anchor;
  };
  return {
    x: start(ax, cx, sx, width), y: start(ay, cy, sy, height),
    width: Math.max(1, Math.abs(width)), height: Math.max(1, Math.abs(height)),
  };
}

function scaled(node: CanvasNode, fx: number, fy: number, x: number, y: number): CanvasNode {
  const next = { ...node, x, y, width: Math.max(1, node.width * fx), height: Math.max(node.type === "line" || node.type === "arrow" ? 0 : 1, node.height * fy) };
  if (node.points) next.points = node.points.map((value, index) => value * (index % 2 === 0 ? fx : fy));
  if (node.type === "text") next.autoWidth = false;
  return next;
}

function withoutHug(node: CanvasNode, width: boolean, height: boolean): CanvasNode {
  if (!node.layout?.hug) return node;
  const hugWidth = (node.layout.hug === "width" || node.layout.hug === "both") && !width;
  const hugHeight = (node.layout.hug === "height" || node.layout.hug === "both") && !height;
  const hug = hugWidth && hugHeight ? "both" : hugWidth ? "width" : hugHeight ? "height" : undefined;
  const { hug: _old, ...layout } = node.layout;
  return { ...node, layout: hug ? { ...layout, hug } : layout };
}

export function resizeSingle(scene: Scene, index: Map<string | null, CanvasNode[]>, node: CanvasNode, handle: Handle, pointer: Point, keepRatio: boolean, fromCentre: boolean): CanvasNode[] {
  const box = worldBox(scene, node);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const local = rotatePoint(pointer, centre, -node.rotation);
  const next = resizeBox(box, handle, local, keepRatio || (node.type === "image" && handle.length === 2), fromCentre);
  const shift = rotatePoint({ x: next.x + next.width / 2, y: next.y + next.height / 2 }, centre, node.rotation);
  const world = { x: shift.x - next.width / 2, y: shift.y - next.height / 2 };
  const origin = { x: box.x - node.x, y: box.y - node.y };
  const fx = next.width / Math.max(1, box.width);
  const fy = next.height / Math.max(1, box.height);
  if (node.type === "text") {
    const sideways = handle !== "n" && handle !== "s";
    return [{ ...node, x: sideways ? world.x - origin.x : node.x, width: sideways ? next.width : node.width, autoWidth: sideways ? false : node.autoWidth }];
  }
  const resized = withoutHug({ ...scaled(node, fx, fy, world.x - origin.x, world.y - origin.y), width: next.width, height: node.type === "line" || node.type === "arrow" ? node.height * fy : next.height }, handle !== "n" && handle !== "s", handle !== "e" && handle !== "w");
  if (node.type !== "group") return [resized];
  return [resized, ...descendants(scene, node.id, index).map((child) => scaled(child, fx, fy, child.x * fx, child.y * fy))];
}

export function resizeMany(scene: Scene, index: Map<string | null, CanvasNode[]>, nodes: readonly CanvasNode[], from: Box, to: Box): CanvasNode[] {
  const fx = to.width / Math.max(1, from.width);
  const fy = to.height / Math.max(1, from.height);
  return nodes.flatMap((node) => {
    const parent = effectiveParent(scene, node);
    const origin = parent ? worldOrigin(scene, scene.get(parent)!) : { x: 0, y: 0 };
    const box = worldBox(scene, node);
    const x = to.x + (box.x - from.x) * fx - origin.x;
    const y = to.y + (box.y - from.y) * fy - origin.y;
    const own = scaled(node, fx, fy, x, y);
    return node.type === "group" ? [own, ...descendants(scene, node.id, index).map((child) => scaled(child, fx, fy, child.x * fx, child.y * fy))] : [own];
  });
}

export function moveEndpoint(scene: Scene, node: CanvasNode, end: 0 | 1, pointer: Point): CanvasNode {
  const box = worldBox(scene, node);
  const points = [...(node.points ?? [0, 0, node.width, node.height])];
  const at = end === 0 ? 0 : points.length - 2;
  points[at] = pointer.x - box.x;
  points[at + 1] = pointer.y - box.y;
  return refitPoints(node, points);
}

export function refitPoints(node: CanvasNode, points: number[]): CanvasNode {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    ...node, x: node.x + minX, y: node.y + minY,
    width: Math.max(...xs) - minX, height: Math.max(...ys) - minY,
    points: points.map((value, index) => value - (index % 2 === 0 ? minX : minY)),
  };
}

export function angleOf(centre: Point, point: Point): number {
  return (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI;
}
