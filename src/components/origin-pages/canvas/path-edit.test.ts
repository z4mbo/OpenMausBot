import { describe, expect, it } from "vitest";
import { newNode } from "../../../../shared/canvas-ops";
import { addPointAt, cubicOf, segmentsOf, splitCubic } from "./path-edit";
import { anchorsOf } from "./pen";
import { panCrop } from "./image-crop";

describe("adding points on a path segment", () => {
  it("splits a straight segment where it was clicked and keeps it straight", () => {
    const path = newNode("path", null, 1, { x: 10, y: 10, points: [0, 0, 100, 0, 100, 50], width: 100, height: 50 });
    expect(segmentsOf(path)).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }]);
    const added = addPointAt(path, { x: 10, y: 10 }, "0:1", { x: 40, y: 13 })!;
    expect(added.at).toBe(1);
    expect(added.node.points).toEqual([0, 0, 30, 0, 100, 0, 100, 50]);
    expect(added.node.curves).toBeUndefined();
  });

  it("splits a curve without changing its shape and inserts on the closing segment of a closed path", () => {
    const curve = newNode("path", null, 1, { points: [0, 0, 100, 0], curves: [0, 0, 30, -40, -30, -40, 0, 0], width: 100, height: 0 });
    const added = addPointAt(curve, { x: 0, y: 0 }, "0:1", { x: 50, y: -30 })!;
    const before = cubicOf(anchorsOf(curve, { x: 0, y: 0 }), { from: 0, to: 1 });
    const [left] = splitCubic(before, 0.5);
    const anchors = anchorsOf(added.node, added.origin);
    expect(anchors).toHaveLength(3);
    expect(anchors[1]!.point.x).toBeCloseTo(left[3].x, 1);
    expect(anchors[1]!.point.y).toBeCloseTo(left[3].y, 1);
    const closed = newNode("path", null, 1, { points: [0, 0, 100, 0, 100, 100, 0, 100], closed: true, breaks: [2], width: 100, height: 100 });
    expect(segmentsOf(closed).map((item) => `${item.from}:${item.to}`)).toEqual(["0:1", "1:0", "2:3", "3:2"]);
    expect(addPointAt(closed, { x: 0, y: 0 }, "1:0", { x: 50, y: 0 })!.node.breaks).toEqual([3]);
    expect(addPointAt(closed, { x: 0, y: 0 }, "9:0", { x: 0, y: 0 })).toBeNull();
  });
});

describe("moving a crop", () => {
  it("drags the picture and keeps it covering the box", () => {
    const image = newNode("image", null, 1, { width: 200, height: 100, imageFit: "crop", crop: { scale: 2, x: -0.5, y: -0.5 } });
    expect(panCrop(image, { x: 0, y: 0 }, { x: 20, y: 10 }).crop).toEqual({ scale: 2, x: -0.4, y: -0.4 });
    expect(panCrop(image, { x: 0, y: 0 }, { x: 500, y: -500 }).crop).toEqual({ scale: 2, x: 0, y: -1 });
  });
});
