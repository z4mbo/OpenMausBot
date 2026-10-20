// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newNode } from "../../../../shared/canvas-ops";
import { encodeNode, type CanvasNode } from "../../../../shared/canvas-scene";
import { useCanvasScene, type CanvasScene } from "./use-canvas-scene";

type Sent = CanvasNode & { format: string };
let sent: Sent[][];
let root: Root;
let host: HTMLDivElement;
let canvas: CanvasScene;
const outbox = { enqueue: (rows: Sent[]) => { sent.push(rows); }, elements: () => [] } as unknown as Parameters<typeof useCanvasScene>[1];
const rect = newNode("rect", null, 1, { x: 0, y: 0, width: 100, height: 100 });

function Probe({ rows }: { rows: string[] }) {
  canvas = useCanvasScene(rows, outbox, false);
  return null;
}
const render = (rows: string[]) => flushSync(() => root.render(createElement(Probe, { rows })));
const at = (x: number): CanvasNode => ({ ...canvas.scene.get(rect.id)!, x });

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  host = document.createElement("div");
  root = createRoot(host);
  render([encodeNode(rect)]);
});
afterEach(() => { flushSync(() => root.unmount()); vi.useRealTimers(); });

it("streams a drag to collaborators while it happens and commits once at the end", () => {
  flushSync(() => canvas.preview([at(10)], { share: true }));
  expect(sent.map((rows) => rows[0].x)).toEqual([10]);
  flushSync(() => { canvas.preview([at(20)], { share: true }); canvas.preview([at(30)], { share: true }); });
  expect(sent).toHaveLength(1);
  vi.advanceTimersByTime(100);
  expect(sent.map((rows) => rows[0].x)).toEqual([10, 30]);

  render([encodeNode(rect), encodeNode(sent[1][0])]);
  expect(canvas.scene.get(rect.id)!.x).toBe(30);
  flushSync(() => canvas.commit([at(40)]));
  const final = sent.at(-1)![0];
  expect(final.x).toBe(40);
  expect(final.version).toBeGreaterThan(sent[1][0].version);

  flushSync(() => canvas.undo());
  expect(canvas.scene.get(rect.id)!.x).toBe(0);
  expect(canvas.canUndo).toBe(false);
});

it("puts collaborators back where they were when a shared drag is cancelled", () => {
  flushSync(() => canvas.preview([at(50)], { share: true }));
  flushSync(() => canvas.preview(null));
  const restored = sent.at(-1)![0];
  expect(restored.x).toBe(0);
  expect(restored.version).toBeGreaterThan(sent[0][0].version);
  vi.advanceTimersByTime(200);
  expect(sent).toHaveLength(2);
});
