import { describe, expect, it } from "vitest";
import { applyCanvasOps } from "./canvas-ops.ts";
import { connectorSpec, simplify, stickySpec, strokeSpec } from "./canvas-board.ts";

describe("board specs", () => {
  it("makes a sticky note a coloured frame holding its text", () => {
    const result = applyCanvasOps(new Map(), [{ op: "create", node: stickySpec({ text: "Idea", color: "blue", x: 10.4, y: 20 }) }]);
    const [frame, text] = result.changed;
    expect(frame).toMatchObject({ type: "frame", name: "Sticky", x: 10, y: 20, width: 240, height: 240, fill: "#BFDBFF" });
    expect(text).toMatchObject({ type: "text", text: "Idea", parentId: frame!.id });
  });

  it("simplifies and smooths a freehand stroke into a path relative to its box", () => {
    const line = Array.from({ length: 50 }, (_, at): [number, number] => [100 + at, 200]);
    expect(simplify(line, 0.5)).toEqual([[100, 200], [149, 200]]);
    const spec = strokeSpec([[100, 100], [150, 140], [200, 100]], { color: "#1971C2", width: 4 })!;
    expect(spec).toMatchObject({ type: "path", x: 100, y: 100, points: [[0, 0], [50, 40], [100, 0]], stroke: "#1971C2", strokeWidth: 4 });
    expect(spec.curves).toEqual([0, 0, 0, 0, -16.7, 0, 16.7, 0, 0, 0, 0, 0]);
    expect(strokeSpec([], {})).toBeNull();
  });

  it("joins two boxes with an arrow from edge to edge", () => {
    const spec = connectorSpec({ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 0, width: 100, height: 100 });
    expect(spec).toMatchObject({ type: "arrow", x: 100, y: 50, points: [[0, 0], [200, 0]] });
  });
});
