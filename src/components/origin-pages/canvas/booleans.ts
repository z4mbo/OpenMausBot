import { booleanMany, ellipseShape, flattenPath, rectShape, shapeToPath, type BooleanOp, type Shape } from "../../../../shared/canvas-boolean";
import { newNode } from "../../../../shared/canvas-ops";
import { descendants, effectiveParent, worldOrigin, type CanvasNode, type Scene } from "../../../../shared/canvas-scene";
import { topmost } from "./actions";

type Index = ReadonlyMap<string | null, readonly CanvasNode[]>;

const BOOLEAN_TYPES = new Set(["rect", "ellipse", "path"]);

/** A shape's outline in world space, or null for anything but rectangles, ellipses and vectors. */
export function worldShape(scene: Scene, node: CanvasNode): Shape | null {
  if (!BOOLEAN_TYPES.has(node.type)) return null;
  const origin = worldOrigin(scene, node);
  let shape: Shape;
  if (node.type === "ellipse") shape = ellipseShape(node.width / 2, node.height / 2, node.width / 2, node.height / 2);
  else if (node.type === "path") shape = flattenPath({ points: node.points ?? [], curves: node.curves, breaks: node.breaks, closed: true });
  else shape = rectShape(0, 0, node.width, node.height, Math.min(node.radius, node.width / 2, node.height / 2));
  const angle = (node.rotation * Math.PI) / 180;
  const cx = node.width / 2;
  const cy = node.height / 2;
  return shape.map((ring) => ring.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [origin.x + cx + dx * Math.cos(angle) - dy * Math.sin(angle), origin.y + cy + dx * Math.sin(angle) + dy * Math.cos(angle)] as [number, number];
  }));
}

export const canBoolean = (scene: Scene, ids: readonly string[]) => topmost(scene, ids).filter((node) => BOOLEAN_TYPES.has(node.type) && !node.locked).length >= 2;
export const canFlatten = (scene: Scene, ids: readonly string[]) => topmost(scene, ids).some((node) => BOOLEAN_TYPES.has(node.type) && node.type !== "path" && !node.locked);

/** The selection combined into one vector, styled like its bottom layer, replacing the layers it was made of. */
export function combine(scene: Scene, index: Index, ids: readonly string[], op: BooleanOp | "flatten"): { nodes: CanvasNode[]; id: string } | null {
  const chosen = topmost(scene, ids).filter((node) => BOOLEAN_TYPES.has(node.type) && !node.locked).sort((a, b) => a.z - b.z);
  if (!chosen.length || (op !== "flatten" && chosen.length < 2)) return null;
  const shapes = chosen.map((node) => worldShape(scene, node)!);
  const result = op === "flatten" ? shapes.flat() : booleanMany(shapes, op);
  if (!result.length) return null;
  const geometry = shapeToPath(result);
  const bottom = chosen[0]!;
  const parentId = effectiveParent(scene, bottom);
  const parentOrigin = parentId ? worldOrigin(scene, scene.get(parentId)!) : { x: 0, y: 0 };
  const name = op === "flatten" ? bottom.name : `${op[0]!.toUpperCase()}${op.slice(1)}`;
  const vector = newNode("path", parentId, Math.max(...chosen.map((node) => node.z)), {
    name, x: geometry.x - parentOrigin.x, y: geometry.y - parentOrigin.y, width: geometry.width, height: geometry.height,
    points: geometry.points, ...(geometry.breaks.length ? { breaks: geometry.breaks } : {}), closed: true,
    fill: bottom.fill ?? "#D9D9D9", stroke: bottom.stroke, strokeWidth: bottom.stroke ? bottom.strokeWidth : 0, opacity: bottom.opacity,
    ...(bottom.parentId === null && bottom.page ? { page: bottom.page } : {}),
  });
  const gone = chosen.flatMap((node) => [node, ...descendants(scene, node.id, index as Map<string | null, CanvasNode[]>)]).map((node) => ({ ...node, deleted: true }));
  return { nodes: [...gone, vector], id: vector.id };
}
