import { describe, expect, it } from "vitest";
import { booleanGroupPath, booleanGroupShape } from "./canvas-boolean-group.ts";
import { cornerRadii, gradientCss, gradientLine, imagePlacement, roundedRectPath } from "./canvas-paint.ts";
import { newNode } from "./canvas-ops.ts";
import { childrenIndex, sanitizeNode, type CanvasNode } from "./canvas-scene.ts";
import { sceneSvg } from "./canvas-svg.ts";
import { renderCanvasPage } from "./canvas-page.ts";

const area = (ring: [number, number][]) => Math.abs(ring.reduce((sum, [x, y], at) => { const [nx, ny] = ring[(at + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0) / 2);

function scene(...nodes: CanvasNode[]) { return new Map(nodes.map((node) => [node.id, node])); }

describe("boolean groups", () => {
  const group = newNode("group", null, 1, { boolean: "subtract", fill: "#112233", width: 150, height: 100 });
  const base = newNode("rect", group.id, 1, { width: 100, height: 100 });
  const hole = newNode("rect", group.id, 2, { x: 50, width: 100, height: 100 });

  it("draws the operation of its children and recomputes when one moves", () => {
    const shape = booleanGroupShape(group, childrenIndex(scene(group, base, hole)));
    expect(shape.reduce((sum, ring) => sum + area(ring), 0)).toBeCloseTo(5000, 3);
    const moved = { ...hole, x: 80 };
    const again = booleanGroupShape(group, childrenIndex(scene(group, base, moved)));
    expect(again.reduce((sum, ring) => sum + area(ring), 0)).toBeCloseTo(8000, 3);
    expect(booleanGroupPath({ ...group, boolean: "union" }, childrenIndex(scene(group, base, hole)))).toMatch(/^M.*Z$/);
  });

  it("keeps the operation through sanitizing, exports it as one path, and publishes it as inline SVG", () => {
    expect(sanitizeNode({ ...group, boolean: "bogus" })?.boolean).toBeUndefined();
    expect(sanitizeNode(group)?.boolean).toBe("subtract");
    const svg = sceneSvg(scene(group, base, hole), [group.id])!.svg;
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg.match(/<rect /g)).toBeNull();
    const frame = newNode("frame", null, 1, { width: 400, height: 300 });
    const inside = { ...group, parentId: frame.id };
    expect(renderCanvasPage(scene(frame, inside, base, hole), frame.id, new Map())!.body).toMatch(/<svg[^>]*><path d="M/);
  });
});

describe("paint", () => {
  it("rounds each corner on its own", () => {
    const rect = sanitizeNode({ ...newNode("rect", null, 1, { width: 100, height: 40 }), radii: [0, 8, 30, 4] })!;
    expect(rect.radii).toEqual([0, 8, 30, 4]);
    expect(cornerRadii(rect)).toEqual([0, 8, 20, 4]);
    expect(roundedRectPath(100, 40, [0, 8, 20, 4])).toBe("M0 0H92A8 8 0 0 1 100 8V20A20 20 0 0 1 80 40H4A4 4 0 0 1 0 36V0Z");
    expect(sanitizeNode({ ...rect, radii: [6, 6, 6] })!.radii).toBeUndefined();
  });

  it("runs a linear gradient like CSS and writes it for pages", () => {
    const gradient = { kind: "linear" as const, angle: 0, stops: [{ at: 0, color: "#000000" }, { at: 1, color: "#FFFFFF80" }] };
    expect(gradientLine(gradient, 200, 100)).toEqual({ x1: 0, y1: 50, x2: 200, y2: 50 });
    expect(gradientCss(gradient)).toBe("linear-gradient(90deg, #000000 0%, #FFFFFF80 100%)");
    expect(sanitizeNode({ ...newNode("rect", null, 1), gradient: { stops: [{ at: 0, color: "#000" }] } })!.gradient).toBeUndefined();
  });

  it("places a cropped image inside its box and clamps the crop", () => {
    const image = sanitizeNode({ ...newNode("image", null, 1, { width: 200, height: 100 }), imageFit: "crop", crop: { scale: 2, x: -1.5, y: 0.5 } })!;
    expect(image.crop).toEqual({ scale: 2, x: -1, y: 0 });
    expect(imagePlacement(image)).toEqual({ kind: "crop", x: -200, y: 0, width: 400, height: 200 });
    expect(imagePlacement({ ...image, imageFit: "tile", crop: { scale: 0.25, x: 0, y: 0 } })).toEqual({ kind: "tile", width: 50, height: 25 });
  });
});
