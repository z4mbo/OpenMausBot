import { newNode } from "../../../../shared/canvas-ops";
import { parseSvg } from "../../../../shared/canvas-svg-import";
import type { CanvasNode } from "../../../../shared/canvas-scene";
import type { Point } from "./geometry";

/** SVG markup as editable vectors inside one frame centred on `centre` (world), or null when it holds no vectors. */
export function svgNodes(markup: string, name: string, centre: Point, parentId: string | null, origin: Point, z: number): CanvasNode[] | null {
  const parsed = parseSvg(markup);
  if (!parsed || !parsed.vectors.length) return null;
  const frame = newNode("frame", parentId, z, {
    name: name.replace(/\.svg$/i, "").slice(0, 80) || "Vector", fill: null, clip: false,
    x: Math.round(centre.x - parsed.width / 2 - origin.x), y: Math.round(centre.y - parsed.height / 2 - origin.y), width: Math.max(1, parsed.width), height: Math.max(1, parsed.height),
  });
  const children = parsed.vectors.map((vector, order) => {
    const common = { name: vector.name, x: vector.x, y: vector.y, width: Math.max(vector.kind === "path" ? 0 : 1, vector.width), height: Math.max(vector.kind === "path" ? 0 : 1, vector.height), opacity: vector.opacity, fill: vector.fill, stroke: vector.stroke, strokeWidth: vector.stroke ? vector.strokeWidth : 0 };
    if (vector.kind === "rect") return newNode("rect", frame.id, order + 1, { ...common, radius: vector.radius ?? 0 });
    if (vector.kind === "ellipse") return newNode("ellipse", frame.id, order + 1, common);
    if (vector.kind === "text") return newNode("text", frame.id, order + 1, { ...common, text: vector.text ?? "", fontSize: vector.fontSize ?? 16, autoWidth: true, fill: vector.fill ?? "#000000", stroke: null, strokeWidth: 0 });
    return newNode("path", frame.id, order + 1, { ...common, points: vector.points, ...(vector.curves ? { curves: vector.curves } : {}), ...(vector.breaks ? { breaks: vector.breaks } : {}), closed: vector.closed });
  });
  return [frame, ...children];
}
