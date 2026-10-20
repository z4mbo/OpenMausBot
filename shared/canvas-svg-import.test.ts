import { describe, expect, it } from "vitest";
import { parseSvg, type ImportedSvg, type ImportedVector } from "./canvas-svg-import";

function svg(content: string, attributes = ""): ImportedSvg {
  const result = parseSvg(`<svg ${attributes}>${content}</svg>`);
  expect(result).not.toBeNull();
  return result!;
}

function vector(content: string, attributes = ""): ImportedVector {
  const result = svg(content, attributes);
  expect(result.vectors).toHaveLength(1);
  return result.vectors[0];
}

function absolutePoints(shape: ImportedVector): number[][] {
  const result: number[][] = [];
  for (let index = 0; index < (shape.points?.length ?? 0); index += 2) {
    result.push([shape.points![index] + shape.x, shape.points![index + 1] + shape.y]);
  }
  return result;
}

describe("parseSvg", () => {
  it("imports a rectangle with its name, radius, paint and viewport defaults", () => {
    const result = svg('<rect id="box" x="10" y="20" width="30" height="40" rx="5"/>');
    expect(result).toEqual({
      width: 300,
      height: 150,
      vectors: [{ kind: "rect", name: "box", x: 10, y: 20, width: 30, height: 40, radius: 5, fill: "#000000", stroke: null, strokeWidth: 1, opacity: 1 }],
    });
    expect(vector('<rect width="10" height="20" ry="3"/>')).toMatchObject({ name: "Rectangle", radius: 3 });
  });

  it("imports circles and ellipses", () => {
    expect(vector('<circle cx="30" cy="40" r="10"/>')).toMatchObject({ kind: "ellipse", name: "Ellipse", x: 20, y: 30, width: 20, height: 20 });
    expect(vector('<ellipse id="oval" cx="10" cy="20" rx="3" ry="7"/>')).toMatchObject({ kind: "ellipse", name: "oval", x: 7, y: 13, width: 6, height: 14 });
  });

  it("reads relative and implicit line commands and closes a path", () => {
    expect(vector('<path d="m10 20 10 0 v10 h-10 z"/>')).toMatchObject({
      kind: "path", name: "Path", x: 10, y: 20, width: 10, height: 10,
      points: [0, 0, 10, 0, 10, 10, 0, 10], closed: true,
    });
    expect(vector('<path d="M0 0 L10 0 10 10 H0 V0 Z"/>').points).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
  });

  it("tokenizes compact signed numbers, decimals and exponents", () => {
    const shape = vector('<path d="M1.5.5l-1-2 1e1-2E-1L.5.25"/>');
    const expected = [[1.5, 0.5], [0.5, -1.5], [10.5, -1.7], [0.5, 0.25]];
    absolutePoints(shape).forEach((point, index) => {
      expect(point[0]).toBeCloseTo(expected[index][0]);
      expect(point[1]).toBeCloseTo(expected[index][1]);
    });
  });

  it("converts C, S, Q, T and A to cubic handle offsets", () => {
    const shape = vector('<path d="M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 10 30 0 T40 0 A10 10 0 0 1 50 10"/>');
    expect(shape.curves).toHaveLength(shape.points!.length * 2);
    expect(shape.curves!.slice(0, 10)).toEqual([0, 0, 0, 10, 0, 10, 0, -10, 0, -10]);
    expect(shape.curves![10]).toBeCloseTo(10 / 3);
    expect(shape.curves![11]).toBeCloseTo(20 / 3);
    expect(shape.curves![12]).toBeCloseTo(-10 / 3);
    expect(shape.curves![13]).toBeCloseTo(20 / 3);
    expect(shape.curves![14]).toBeCloseTo(10 / 3);
    expect(shape.curves![15]).toBeCloseTo(-20 / 3);
    expect(shape.curves![17]).toBeCloseTo(-20 / 3);
    expect(shape.curves![18]).toBeCloseTo(10 * 4 / 3 * Math.tan(Math.PI / 8));
    expect(absolutePoints(shape)).toEqual([[0, 0], [10, 0], [20, 0], [30, 0], [40, 0], [50, 10]]);
    expect(shape).toMatchObject({ x: 0, y: -10, width: 50, height: 20, closed: false });
  });

  it("converts relative curves and resets shorthand controls after a line", () => {
    const shape = vector('<path d="m10 20 c0 3 3 3 3 0 s3 -3 3 0 q3 3 6 0 t6 0 l3 0 s3 3 6 0 t6 0"/>');
    expect(absolutePoints(shape)).toEqual([[10, 20], [13, 20], [16, 20], [22, 20], [28, 20], [31, 20], [37, 20], [43, 20]]);
    expect(shape.curves!.slice(0, 8)).toEqual([0, 0, 0, 3, 0, 3, 0, -3]);
    expect(shape.curves!.slice(20, 24)).toEqual([0, 0, 0, 0]);
    expect(shape.curves!.slice(26, 28)).toEqual([0, 0]);
  });

  it("splits large arcs, handles compact flags, and treats degenerate arcs as lines", () => {
    const large = vector('<path d="M10 0 A10 10 0 1 1 0 -10"/>');
    expect(large.points).toHaveLength(8);
    expect(absolutePoints(large).at(-1)).toEqual([0, -10]);
    const compact = vector('<path d="M0 0 a5 5 0 0110 0"/>');
    expect(compact.points).toHaveLength(6);
    expect(absolutePoints(compact).at(-1)).toEqual([10, 0]);
    const degenerate = vector('<path d="M0 0 A0 5 0 0 1 10 0 A5 5 0 0 1 10 0"/>');
    expect(degenerate.points).toEqual([0, 0, 10, 0]);
    expect(degenerate.curves).toBeUndefined();
  });

  it("scales too-small arc radii and supports rotated elliptical arcs", () => {
    const shape = vector('<path d="M0 0 A1 2 45 0 0 100 50"/>');
    expect(shape.curves).toBeDefined();
    expect(shape.points!.length).toBeLessThanOrEqual(10);
    expect([...shape.points!, ...shape.curves!].every(Number.isFinite)).toBe(true);
    const last = absolutePoints(shape).at(-1)!;
    expect(last[0]).toBeCloseTo(100);
    expect(last[1]).toBeCloseTo(50);
  });

  it("preserves an incoming closing handle when merging the repeated first anchor", () => {
    const shape = vector('<path d="M0 0 C0 10 10 10 10 0 C10 -10 0 -10 0 0 Z"/>');
    expect(shape.points).toHaveLength(4);
    expect(shape.curves).toEqual([0, -10, 0, 10, 0, 10, 0, -10]);
    expect(shape).toMatchObject({ x: 0, y: -10, width: 10, height: 20, closed: true });
  });

  it("accumulates nested group transforms in SVG list order", () => {
    const shape = vector('<g transform="translate(10 20) scale(2)"><g transform="translate(3,4)"><rect x="1" y="2" width="5" height="6" stroke="red" stroke-width="3"/></g></g>');
    expect(shape).toMatchObject({ x: 18, y: 32, width: 10, height: 12, strokeWidth: 6 });
  });

  it("transforms anchors, handles and their bounding box together", () => {
    const shape = vector('<path transform="matrix(2 0 0 3 10 20)" d="M0 0 C-5 -10 15 20 10 10 L20 0"/>');
    expect(shape).toMatchObject({ x: 0, y: -10, width: 50, height: 90, strokeWidth: 2.5 });
    expect(absolutePoints(shape)).toEqual([[10, 20], [30, 50], [50, 20]]);
    expect(shape.curves).toEqual([0, 0, -10, -30, 10, 30, 0, 0, 0, 0, 0, 0]);
  });

  it("maps viewBox coordinates with centred uniform scaling by default", () => {
    const result = svg('<rect x="10" y="20" width="100" height="50"/>', 'width="200px" height="200" viewBox="10 20 100 50"');
    expect(result).toMatchObject({ width: 200, height: 200 });
    expect(result.vectors[0]).toMatchObject({ x: 0, y: 50, width: 200, height: 100, strokeWidth: 2 });
    expect(svg("", 'viewBox="5 6 40 30"')).toMatchObject({ width: 40, height: 30 });
    expect(svg("", 'width="12cm" height="9pt"')).toMatchObject({ width: 12, height: 9 });
  });

  it("supports nonuniform viewBox mapping and slice alignment", () => {
    expect(vector('<rect width="100" height="50"/>', 'width="200" height="200" viewBox="0 0 100 50" preserveAspectRatio="none"')).toMatchObject({ x: 0, y: 0, width: 200, height: 200, strokeWidth: 3 });
    expect(vector('<rect width="100" height="50"/>', 'width="200" height="200" viewBox="0 0 100 50" preserveAspectRatio="xMaxYMin slice"')).toMatchObject({ x: -200, y: 0, width: 400, height: 200 });
    expect(vector('<rect width="5" height="5" transform="translate(2 3)"/>', 'width="100" height="100" viewBox="0 0 10 10"')).toMatchObject({ x: 20, y: 30, width: 50, height: 50 });
  });

  it("converts rotated or skewed primitives to closed cubic paths", () => {
    const rotated = vector('<rect x="10" y="10" width="20" height="10" transform="rotate(90 10 10)"/>');
    expect(rotated).toMatchObject({ kind: "path", closed: true });
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(10);
    expect(rotated.width).toBeCloseTo(10);
    expect(rotated.height).toBeCloseTo(20);
    const rounded = vector('<rect width="20" height="10" rx="3" ry="2" transform="skewX(15)"/>');
    expect(rounded).toMatchObject({ kind: "path", closed: true });
    expect(rounded.points).toHaveLength(16);
    expect(rounded.curves).toHaveLength(32);
    const ellipse = vector('<ellipse cx="10" cy="10" rx="8" ry="4" transform="rotate(30) skewY(5)"/>');
    expect(ellipse).toMatchObject({ kind: "path", closed: true });
    expect(ellipse.points).toHaveLength(8);
    expect(ellipse.curves).toHaveLength(16);
    expect(ellipse.curves!.slice(0, 2).some((value) => value !== 0)).toBe(true);
  });

  it("keeps reflected axis-aligned shapes as primitives with positive bounds", () => {
    expect(vector('<rect x="1" y="2" width="3" height="4" rx="1" transform="scale(-2 -3)"/>')).toMatchObject({ kind: "rect", x: -8, y: -18, width: 6, height: 12, radius: 2 });
    expect(vector('<circle r="5" transform="scale(2 3)"/>')).toMatchObject({ kind: "ellipse", x: -10, y: -15, width: 20, height: 30 });
  });

  it("imports lines, polylines and polygons with straight handles", () => {
    const shapes = svg('<line x1="1" y1="2" x2="3" y2="4"/><polyline points="0,0 5,0 5,5"/><polygon points="0,0 5,0 5,5 0,0"/>').vectors;
    expect(shapes).toHaveLength(3);
    expect(absolutePoints(shapes[0])).toEqual([[1, 2], [3, 4]]);
    expect(shapes.map((shape) => shape.closed)).toEqual([false, false, true]);
    expect(shapes[2].points).toHaveLength(6);
    expect(shapes.every((shape) => shape.curves === undefined)).toBe(true);
  });

  it("supports fill none with an inherited stroke and style overrides", () => {
    const shape = vector('<g fill="none" stroke="red" stroke-width="4"><rect width="10" height="20" stroke="blue" style="stroke: #abc; stroke-width:2; fill:none; stroke-opacity:50%"/></g>');
    expect(shape).toMatchObject({ fill: null, stroke: "#AABBCC", strokeWidth: 2, opacity: 0.5 });
  });

  it("normalizes rgb, rgba, named and short/long hexadecimal colours", () => {
    const colors = ["rgb(10,20,30)", "rgb(100%, 0%, 50%)", "rgba(255,0,0,0.5)", "orange", "navy", "#abc", "#abcd", "#11223344", "currentColor", "transparent"];
    const shapes = svg(colors.map((fill) => `<rect width="1" height="1" fill="${fill}"/>`).join("")).vectors;
    expect(shapes.map((shape) => shape.fill)).toEqual(["#0A141E", "#FF0080", "#FF0000", "#FFA500", "#000080", "#AABBCC", "#AABBCC", "#112233", "#000000", null]);
    expect(shapes[2].opacity).toBe(0.5);
    expect(shapes[6].opacity).toBeCloseTo(221 / 255);
    expect(shapes[7].opacity).toBeCloseTo(68 / 255);
    expect(vector('<rect width="1" height="1" fill="rgb(100% 0% 0% / 25%)"/>')).toMatchObject({ fill: "#FF0000", opacity: 0.25 });
  });

  it("folds per-paint alpha into colours when fill and stroke are both painted", () => {
    expect(vector('<rect width="1" height="1" fill="#ff000080" stroke="rgba(0,0,255,.5)" fill-opacity=".5" stroke-opacity=".5" opacity=".5"/>')).toMatchObject({ fill: "#FF000040", stroke: "#0000FF40", opacity: 0.5 });
    expect(vector('<rect width="1" height="1" fill-opacity=".25" opacity=".5"/>')).toMatchObject({ fill: "#000000", stroke: null, opacity: 0.125 });
  });

  it("multiplies nested group opacity while inheriting fill and fill-opacity", () => {
    const shape = vector('<g fill="red" opacity=".5" fill-opacity=".4"><g opacity=".5"><rect width="5" height="5" opacity=".5"/></g></g>', 'opacity=".8"');
    expect(shape.fill).toBe("#FF0000");
    expect(shape.opacity).toBeCloseTo(0.04);
    const overridden = vector('<g fill-opacity=".2"><g><rect width="5" height="5" fill-opacity=".75"/></g></g>');
    expect(overridden.opacity).toBe(0.75);
  });

  it("skips display:none subtrees and hidden elements", () => {
    const shapes = svg('<rect width="1" height="1" display="none"/><g style="display:none"><circle r="3" style="display:inline"/></g><g visibility="hidden"><rect width="2" height="2"/><rect id="visible" width="2" height="2" style="visibility:visible"/></g><path d="M0 0L5 5" style="visibility:hidden"/>').vectors;
    expect(shapes.map((shape) => shape.name)).toEqual(["visible"]);
  });

  it("returns null for non-SVG input", () => {
    for (const source of ["", "plain text", "<!-- svg -->", '<html><svg width="10"/></html>', '<rect width="10" height="20"/>']) {
      expect(parseSvg(source)).toBeNull();
    }
  });

  it("reads text content, entities and the approximate baseline box", () => {
    const shape = vector('<text id="label" x="10" y="30" font-size="20">A<tspan>&amp;B</tspan>&lt;&gt;&quot;&#39;&#65;&#x42;</text>');
    expect(shape).toMatchObject({ kind: "text", name: "label", text: "A&B<>\"'AB", x: 10, y: 14, height: 24, fontSize: 20 });
    expect(shape.width).toBeCloseTo(99);
    expect(vector('<text x="2" y="20">Hi</text>')).toMatchObject({ name: "Text", text: "Hi", y: 7.199999999999999, fontSize: 16 });
    const transformed = vector('<g font-size="10" transform="translate(3 4) scale(2)"><text x="1" y="10">Hi</text></g>');
    expect(transformed).toMatchObject({ x: 5, y: 8, width: 22, height: 24, fontSize: 20 });
  });

  it("ignores XML metadata, comments, CDATA and unsupported element subtrees", () => {
    const result = parseSvg('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY fake "<rect/>">]><!-- <rect/> --><svg><!-- hi --><![CDATA[<circle r="50"/>]]><style>rect { fill:red }</style><defs><rect width="10" height="10"/></defs><mask><rect width="20" height="20"/></mask><clipPath><circle r="50"/></clipPath><filter><rect width="4" height="4"/></filter><image href="x"/><use href="#x"/><rect id="a&gt;b" width="1" height="2"/></svg>');
    expect(result?.vectors).toHaveLength(1);
    expect(result?.vectors[0]).toMatchObject({ name: "a>b", fill: "#000000" });
    expect(vector('<text><![CDATA[ignored]]>kept</text>').text).toBe("kept");
    expect(parseSvg('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:rect width="1" height="1"/></svg:svg>')?.vectors).toHaveLength(1);
  });

  it("resolves first gradient stops even when definitions follow their use", () => {
    const shapes = svg('<rect width="1" height="1" fill="url(#sun)"/><rect width="1" height="1" fill="url(#missing)"/><rect width="1" height="1" fill="url(#faded)"/><defs><linearGradient id="sun"><stop offset="0" style="stop-color:orange"/><stop offset="1" stop-color="red"/></linearGradient><radialGradient id="faded"><stop stop-color="#123" stop-opacity=".5"/></radialGradient><linearGradient><stop stop-color="blue"/></linearGradient></defs>').vectors;
    expect(shapes).toHaveLength(3);
    expect(shapes[0].fill).toBe("#FFA500");
    expect(shapes[1].fill).toBe("#000000");
    expect(shapes[2]).toMatchObject({ fill: "#112233", opacity: 0.5 });
  });

  it("splits mixed open and closed subpaths while preserving uniform subpath breaks", () => {
    const shapes = svg('<path id="mixed" d="M0 0L1 0Z M10 10L11 10 M20 20L21 20 M30 30L31 30Z"/>').vectors;
    expect(shapes).toHaveLength(3);
    expect(shapes.map((shape) => shape.closed)).toEqual([true, false, true]);
    expect(shapes.every((shape) => shape.name === "mixed")).toBe(true);
    expect(shapes[1].breaks).toEqual([2]);
    expect(absolutePoints(shapes[1])).toEqual([[10, 10], [11, 10], [20, 20], [21, 20]]);
    expect(vector('<path d="M0 0L1 0Z M5 5L6 5Z"/>')).toMatchObject({ breaks: [2], closed: true });
  });

  it("starts a subsequent open segment at the closed subpath's first point", () => {
    const shapes = svg('<path d="M5 5L10 5Z l0 10"/>').vectors;
    expect(shapes.map((shape) => shape.closed)).toEqual([true, false]);
    expect(absolutePoints(shapes[1])).toEqual([[5, 5], [5, 15]]);
  });

  it("tolerates incomplete XML and malformed paths without nonfinite geometry", () => {
    expect(parseSvg('<svg><g><rect width="3" height="4"></svg>')?.vectors).toHaveLength(1);
    const result = svg('<path d="M0 0L5 5L2 M10 10L20 20"/><path d="M0 0C1 2x3 4M5 5L6 6"/><path d="M1e999 0L2 3"/><rect width="0" height="4"/><ellipse rx="-1" ry="2"/>');
    expect(result.vectors.length).toBeGreaterThan(0);
    expect(result.vectors.every((shape) => [shape.x, shape.y, shape.width, shape.height, ...(shape.points ?? []), ...(shape.curves ?? [])].every(Number.isFinite))).toBe(true);
  });

  it("limits vectors across elements and split paths", () => {
    const rectangles = svg('<rect width="1" height="1"/>'.repeat(2005));
    expect(rectangles.vectors).toHaveLength(2000);
    const mixed = Array.from({ length: 2100 }, (_, index) => `M${index} 0l1 0${index % 2 ? "" : "Z"}`).join(" ");
    expect(svg(`<path d="${mixed}"/>`).vectors).toHaveLength(2000);
  });

  it("limits total path anchors and skips later anchors while allowing primitives", () => {
    const first = `M0 0 ${Array.from({ length: 14999 }, (_, index) => `L${index + 1} 0`).join(" ")}`;
    const second = `M0 1 ${Array.from({ length: 6000 }, (_, index) => `L${index + 1} 1`).join(" ")}`;
    const result = svg(`<path d="${first}"/><path d="${second}"/><line x2="3"/><path d="M0 0L1 1"/><rect width="2" height="3"/>`);
    expect(result.vectors.reduce((total, shape) => total + (shape.points?.length ?? 0) / 2, 0)).toBe(20000);
    expect(result.vectors.map((shape) => shape.kind)).toEqual(["path", "path", "rect"]);
    expect(result.vectors[1].points).toHaveLength(10000);
  });

  it("applies the anchor cap to polylines and transformed primitive paths", () => {
    const points = Array.from({ length: 19998 }, (_, index) => `${index},0`).join(" ");
    const result = svg(`<polyline points="${points}"/><circle r="2" transform="rotate(20)"/><line x2="3"/><line x2="4"/>`);
    expect(result.vectors.map((shape) => shape.kind)).toEqual(["path", "path"]);
    expect(result.vectors.reduce((total, shape) => total + shape.points!.length / 2, 0)).toBe(20000);
    const oversized = svg(`<polygon points="${"0,0 1,1 ".repeat(11000)}"/>`);
    expect(oversized.vectors[0].points!.length).toBeLessThanOrEqual(40000);
  });
});
