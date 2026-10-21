import { booleanMany, ellipseShape, flattenPath, rectShape, type Ring, type Shape } from "./canvas-boolean.ts";
import { cornerRadii, unevenCorners } from "./canvas-paint.ts";
import type { CanvasNode, CornerRadii } from "./canvas-scene.ts";

type Index = ReadonlyMap<string | null, readonly CanvasNode[]>;

const OPERANDS = new Set(["rect", "ellipse", "path", "frame", "image"]);

/** Whether a node can be an operand of a boolean group: a filled shape, a vector or another boolean group. */
export const isBooleanOperand = (node: CanvasNode) => OPERANDS.has(node.type) || (node.type === "group" && Boolean(node.boolean));

function roundedRectShape(width: number, height: number, radii: CornerRadii): Shape {
  const [tl, tr, br, bl] = radii;
  const corners: [number, number, number, number][] = [[width - tr, tr, tr, -0.5], [width - br, height - br, br, 0], [bl, height - bl, bl, 0.5], [tl, tl, tl, 1]];
  const ring: Ring = [];
  for (const [cx, cy, r, start] of corners) {
    if (!r) { ring.push([cx, cy]); continue; }
    const steps = Math.max(6, Math.ceil(r / 2));
    for (let step = 0; step <= steps; step++) {
      const angle = (start + step / steps / 2) * Math.PI;
      ring.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
  }
  return [ring];
}

/** A node's own outline in its own coordinates, before its position and rotation. */
function ownShape(node: CanvasNode, index: Index): Shape {
  if (node.type === "group") return booleanGroupShape(node, index);
  if (node.type === "ellipse") return ellipseShape(node.width / 2, node.height / 2, node.width / 2, node.height / 2);
  if (node.type === "path") return flattenPath({ points: node.points ?? [], curves: node.curves, breaks: node.breaks, closed: true });
  const radii = cornerRadii(node);
  return radii && unevenCorners(radii) ? roundedRectShape(node.width, node.height, radii) : rectShape(0, 0, node.width, node.height, radii?.[0] ?? 0);
}

/** A node's outline in its parent's coordinates: moved to its position and turned around its centre. */
export function placedShape(node: CanvasNode, index: Index): Shape {
  const angle = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = node.width / 2;
  const cy = node.height / 2;
  return ownShape(node, index).map((ring) => ring.map(([x, y]) => [node.x + cx + (x - cx) * cos - (y - cy) * sin, node.y + cy + (x - cx) * sin + (y - cy) * cos] as [number, number]));
}

const cache = new WeakMap<CanvasNode, { children: readonly CanvasNode[]; shape: Shape }>();

/** The combined outline of a boolean group's visible operands, bottom layer first, in the group's coordinates. */
export function booleanGroupShape(group: CanvasNode, index: Index): Shape {
  const children = (index.get(group.id) ?? []).filter((child) => !child.hidden && !child.deleted && isBooleanOperand(child));
  const cached = cache.get(group);
  if (cached && cached.children.length === children.length && cached.children.every((child, at) => child === children[at])) return cached.shape;
  const shape = !children.length ? [] : group.boolean ? booleanMany(children.map((child) => placedShape(child, index)), group.boolean) : children.flatMap((child) => placedShape(child, index));
  cache.set(group, { children, shape });
  return shape;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** SVG path data of a shape, each ring a closed subpath; fill it with the even-odd rule. */
export function shapePathData(shape: Shape): string {
  return shape.filter((ring) => ring.length >= 3).map((ring) => `M${ring.map(([x, y]) => `${round(x)} ${round(y)}`).join("L")}Z`).join("");
}

export const booleanGroupPath = (group: CanvasNode, index: Index) => shapePathData(booleanGroupShape(group, index));
