import { booleanMany, shapeToPath, translateShape, type Shape } from "../../../../shared/canvas-boolean";
import { isBooleanOperand, placedShape } from "../../../../shared/canvas-boolean-group";
import { newNode } from "../../../../shared/canvas-ops";
import { descendants, effectiveParent, worldOrigin, type BooleanOperation, type CanvasNode, type Scene } from "../../../../shared/canvas-scene";
import { topmost, wrapNodes } from "./actions";

type Index = ReadonlyMap<string | null, readonly CanvasNode[]>;

const OPERANDS = new Set(["rect", "ellipse", "path"]);
const operand = (node: CanvasNode) => !node.locked && (OPERANDS.has(node.type) || (node.type === "group" && Boolean(node.boolean)));

/** A shape's outline in world space, or null for anything but rectangles, ellipses, vectors and boolean groups. */
export function worldShape(scene: Scene, index: Index, node: CanvasNode): Shape | null {
  if (!isBooleanOperand(node) || node.type === "frame" || node.type === "image") return null;
  const parent = effectiveParent(scene, node);
  const origin = parent ? worldOrigin(scene, scene.get(parent)!) : { x: 0, y: 0 };
  return translateShape(placedShape(node, index), origin.x, origin.y);
}

export const canBoolean = (scene: Scene, ids: readonly string[]) => {
  const chosen = topmost(scene, ids);
  return chosen.filter(operand).length >= 2 || (chosen.length === 1 && Boolean(chosen[0]!.boolean));
};
export const canFlatten = (scene: Scene, ids: readonly string[]) => topmost(scene, ids).some((node) => operand(node) && node.type !== "path");

const title = (op: string) => `${op[0]!.toUpperCase()}${op.slice(1)}`;

/**
 * Combines the selection into a boolean group whose layers stay editable, styled like its bottom layer; on a selected
 * boolean group it changes the operation.
 */
export function booleanGroup(scene: Scene, ids: readonly string[], op: BooleanOperation): { nodes: CanvasNode[]; id: string } | null {
  const chosen = topmost(scene, ids);
  if (chosen.length === 1 && chosen[0]!.boolean) {
    const group = chosen[0]!;
    return { nodes: [{ ...group, boolean: op, ...(group.name === title(group.boolean!) ? { name: title(op) } : {}) }], id: group.id };
  }
  const shapes = chosen.filter(operand).sort((a, b) => a.z - b.z);
  if (shapes.length < 2) return null;
  const wrapped = wrapNodes(scene, shapes.map((node) => node.id), "group");
  if (!wrapped) return null;
  const bottom = shapes[0]!;
  const [group, ...children] = wrapped.nodes;
  return {
    id: wrapped.id,
    nodes: [{
      ...group!, name: title(op), boolean: op, fill: bottom.fill ?? (bottom.gradient ? null : "#D9D9D9"), gradient: bottom.gradient,
      stroke: bottom.stroke, strokeWidth: bottom.stroke ? bottom.strokeWidth : 0, ...(bottom.parentId === null && bottom.page ? { page: bottom.page } : {}),
    }, ...children],
  };
}

/** The selection (or a boolean group) flattened into one vector that replaces the layers it was made of. */
export function flatten(scene: Scene, index: Index, ids: readonly string[]): { nodes: CanvasNode[]; id: string } | null {
  const chosen = topmost(scene, ids).filter(operand).sort((a, b) => a.z - b.z);
  if (!chosen.length) return null;
  const shapes = chosen.map((node) => worldShape(scene, index, node)!);
  const result = chosen.length === 1 && chosen[0]!.boolean ? shapes[0]! : chosen.length > 1 && chosen.every((node) => node.boolean) ? booleanMany(shapes, "union") : shapes.flat();
  if (!result.length) return null;
  const geometry = shapeToPath(result);
  const bottom = chosen[0]!;
  const parentId = effectiveParent(scene, bottom);
  const parentOrigin = parentId ? worldOrigin(scene, scene.get(parentId)!) : { x: 0, y: 0 };
  const vector = newNode("path", parentId, Math.max(...chosen.map((node) => node.z)), {
    name: bottom.name, x: geometry.x - parentOrigin.x, y: geometry.y - parentOrigin.y, width: geometry.width, height: geometry.height,
    points: geometry.points, ...(geometry.breaks.length ? { breaks: geometry.breaks } : {}), closed: true,
    fill: bottom.fill ?? (bottom.gradient ? null : "#D9D9D9"), gradient: bottom.gradient, stroke: bottom.stroke, strokeWidth: bottom.stroke ? bottom.strokeWidth : 0, opacity: bottom.opacity,
    ...(bottom.parentId === null && bottom.page ? { page: bottom.page } : {}),
  });
  const gone = chosen.flatMap((node) => [node, ...descendants(scene, node.id, index as Map<string | null, CanvasNode[]>)]).map((node) => ({ ...node, deleted: true }));
  return { nodes: [...gone, vector], id: vector.id };
}
