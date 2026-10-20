import type { CanvasNode } from "../../../../shared/canvas-scene";
import type { Point } from "./geometry";

/** A cropped image with its picture dragged by `from` to `to` (world points), kept covering the box. */
export function panCrop(node: CanvasNode, from: Point, to: Point): CanvasNode {
  const crop = node.crop ?? { scale: 1, x: 0, y: 0 };
  const clamp = (value: number) => Math.min(0, Math.max(1 - crop.scale, value));
  const x = clamp(crop.x + (to.x - from.x) / Math.max(1, node.width));
  const y = clamp(crop.y + (to.y - from.y) / Math.max(1, node.height));
  return { ...node, crop: { ...crop, x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 } };
}

export const isCropped = (node: CanvasNode | undefined): node is CanvasNode & { imageFit: "crop" } => Boolean(node && node.type === "image" && node.imageFit === "crop" && !node.locked);
