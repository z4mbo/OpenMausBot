import { expect, it } from "vitest";
import { newNode } from "../../../../shared/canvas-ops";
import { childrenIndex, type CanvasNode } from "../../../../shared/canvas-scene";
import { dropMoved, duplicateNodes } from "./actions";

function autoLayoutRow() {
  const row = newNode("frame", null, 1, { name: "Row", width: 700, height: 168, layout: { direction: "row", gap: 24, padding: [24, 24, 24, 24], align: "start", justify: "start" } });
  const card = (name: string, x: number, z: number) => newNode("frame", row.id, z, { name, x, y: 24, width: 200, height: 120, layout: { direction: "column", gap: 8, padding: [16, 16, 16, 16], align: "start", justify: "start" } });
  const cards = [card("A", 24, 1), card("B", 248, 2), card("C", 472, 3)];
  const label = newNode("text", cards[1].id, 1, { text: "B", x: 16, y: 16, width: 20, height: 24 });
  const scene = new Map<string, CanvasNode>([row, ...cards, label].map((node) => [node.id, node]));
  return { scene, index: childrenIndex(scene), row, cards };
}

it("puts an Alt-drag copy of an auto-layout child into the frame's flow, not inside its original", () => {
  const { scene, index, row, cards: [, b, c] } = autoLayoutRow();
  const copy = duplicateNodes(scene, index, [b.id], 0);
  const root = copy.nodes.find((node) => node.id === copy.roots[0])!;
  const dragged = { ...root, x: root.x + 40 };
  const pointer = { x: b.x + b.width / 2 + 40, y: b.y + b.height - 10 };
  const [placed] = dropMoved(scene, index, [dragged], pointer, [b.id]);
  expect(placed.parentId).toBe(row.id);
  expect(placed.z).toBeGreaterThan(b.z);
  expect(placed.z).toBeLessThan(c.z);
});

it("reorders a moved auto-layout child among its siblings", () => {
  const { scene, index, row, cards: [a, b] } = autoLayoutRow();
  const [placed] = dropMoved(scene, index, [{ ...a, x: 300 }], { x: b.x + b.width + 12, y: 60 });
  expect(placed.parentId).toBe(row.id);
  expect(placed.z).toBeGreaterThan(b.z);
});
