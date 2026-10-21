import { describe, expect, it } from "vitest";
import {
  booleanMany,
  booleanShapes,
  ellipseShape,
  flattenPath,
  rectShape,
  shapeToPath,
  translateShape,
  type BooleanOp,
  type Shape,
} from "./canvas-boolean";

const operations: BooleanOp[] = ["union", "subtract", "intersect", "exclude"];

function evenOddArea(shape: Shape): number {
  const xs = [...new Set(shape.flatMap((ring) => ring.map(([x]) => x)))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const x = (xs[i - 1] + xs[i]) / 2;
    const ys: number[] = [];
    for (const ring of shape) {
      for (let j = 0; j < ring.length; j++) {
        const a = ring[j];
        const b = ring[(j + 1) % ring.length];
        if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x)) {
          ys.push(a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0])));
        }
      }
    }
    ys.sort((a, b) => a - b);
    expect(ys.length % 2).toBe(0);
    for (let j = 0; j + 1 < ys.length; j += 2) area += (ys[j + 1] - ys[j]) * (xs[i] - xs[i - 1]);
  }
  return area;
}

function contains(shape: Shape, x: number, y: number): boolean {
  let inside = false;
  for (const ring of shape) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if ((a[1] > y) !== (b[1] > y) && x < a[0] + (b[0] - a[0]) * ((y - a[1]) / (b[1] - a[1]))) inside = !inside;
    }
  }
  return inside;
}

function expectedFill(a: boolean, b: boolean, op: BooleanOp): boolean {
  switch (op) {
    case "union": return a || b;
    case "subtract": return a && !b;
    case "intersect": return a && b;
    case "exclude": return a !== b;
  }
}

function expectSimple(shape: Shape): void {
  const edges = shape.flatMap((ring, ringIndex) => {
    expect(ring.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ring.map((point) => point.join(","))).size).toBe(ring.length);
    return ring.map((a, index) => ({ a, b: ring[(index + 1) % ring.length], index, ringIndex, length: ring.length }));
  });
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i];
      const b = edges[j];
      if (a.ringIndex === b.ringIndex
        && (Math.abs(a.index - b.index) === 1 || Math.abs(a.index - b.index) === a.length - 1)) continue;
      const cross = (p: [number, number], q: [number, number], r: [number, number]): number =>
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      const a1 = cross(a.a, a.b, b.a);
      const a2 = cross(a.a, a.b, b.b);
      const b1 = cross(b.a, b.b, a.a);
      const b2 = cross(b.a, b.b, a.b);
      expect(a1 * a2 < -1e-16 && b1 * b2 < -1e-16).toBe(false);
      if (Math.max(Math.abs(a1), Math.abs(a2), Math.abs(b1), Math.abs(b2)) < 1e-10) {
        const axis = Math.abs(a.a[0] - a.b[0]) >= Math.abs(a.a[1] - a.b[1]) ? 0 : 1;
        const overlap = Math.min(Math.max(a.a[axis], a.b[axis]), Math.max(b.a[axis], b.b[axis]))
          - Math.max(Math.min(a.a[axis], a.b[axis]), Math.min(b.a[axis], b.b[axis]));
        expect(overlap).toBeLessThanOrEqual(1e-9);
      }
    }
  }
}

function expectArea(shape: Shape, expected: number): void {
  expect(evenOddArea(shape)).toBeCloseTo(expected, 7);
  expectSimple(shape);
}

function reverse(shape: Shape): Shape {
  return shape.map((ring) => [...ring].reverse());
}

describe("booleanShapes", () => {
  const a = rectShape(0, 0, 2, 2);
  const b = rectShape(1, 1, 2, 2);

  it.each([
    ["union", 7], ["intersect", 1], ["subtract", 3], ["exclude", 6],
  ] as const)("computes %s for overlapping squares", (op, area) => {
    expectArea(booleanShapes(a, b, op), area);
  });

  it("handles disjoint shapes", () => {
    const other = rectShape(4, 1, 2, 2);
    const union = booleanShapes(a, other, "union");
    expect(union).toHaveLength(2);
    expectArea(union, 8);
    expectArea(booleanShapes(a, other, "subtract"), 4);
    expectArea(booleanShapes(a, other, "intersect"), 0);
    expectArea(booleanShapes(a, other, "exclude"), 8);
  });

  it("makes a hole when subtracting a contained shape", () => {
    const outer = rectShape(0, 0, 6, 6);
    const inner = rectShape(2, 2, 2, 2);
    const difference = booleanShapes(outer, inner, "subtract");
    expect(difference).toHaveLength(2);
    expectArea(difference, 32);
    expectArea(booleanShapes(outer, inner, "intersect"), 4);
    expectArea(booleanShapes(outer, inner, "union"), 36);
    expectArea(booleanShapes(inner, outer, "subtract"), 0);
    expectArea(booleanShapes(outer, inner, "exclude"), 32);
  });

  it("handles identical polygons in either orientation", () => {
    for (const other of [a, reverse(a)]) {
      expectArea(booleanShapes(a, other, "union"), 4);
      expectArea(booleanShapes(a, other, "intersect"), 4);
      expect(booleanShapes(a, other, "subtract")).toEqual([]);
      expect(booleanShapes(a, other, "exclude")).toEqual([]);
    }
  });

  it("merges adjacent squares sharing an edge", () => {
    const other = rectShape(2, 0, 2, 2);
    const union = booleanShapes(a, other, "union");
    expect(union).toHaveLength(1);
    expectArea(union, 8);
    expectArea(booleanShapes(a, other, "exclude"), 8);
    expectArea(booleanShapes(a, other, "subtract"), 4);
    expect(booleanShapes(a, other, "intersect")).toEqual([]);
  });

  it("splits partially overlapping collinear edges", () => {
    const other = rectShape(1, 0, 3, 2);
    expectArea(booleanShapes(a, other, "union"), 8);
    expectArea(booleanShapes(a, other, "intersect"), 2);
    expectArea(booleanShapes(a, other, "subtract"), 2);
    expectArea(booleanShapes(a, other, "exclude"), 6);
    const adjacent = rectShape(2, 0.5, 2, 1);
    expect(booleanShapes(a, adjacent, "union")).toHaveLength(1);
    expectArea(booleanShapes(a, adjacent, "union"), 6);
  });

  it("keeps point-touching boundaries simple", () => {
    const other = rectShape(2, 2, 2, 2);
    const union = booleanShapes(a, other, "union");
    expect(union).toHaveLength(2);
    expectArea(union, 8);
    expect(booleanShapes(a, other, "intersect")).toEqual([]);
    const touchingHole: Shape = [[[0, 1], [1, 0.5], [1.5, 1], [1, 1.5]]];
    expectArea(booleanShapes(a, touchingHole, "subtract"), 3.25);
  });

  it("matches analytic areas for two overlapping circles within one percent", () => {
    const radius = 10;
    const distance = 8;
    const first = ellipseShape(0, 0, radius, radius);
    const second = ellipseShape(distance, 0, radius, radius);
    const lens = 2 * radius ** 2 * Math.acos(distance / (2 * radius))
      - distance / 2 * Math.sqrt(4 * radius ** 2 - distance ** 2);
    const expected = { union: 2 * Math.PI * radius ** 2 - lens, intersect: lens, subtract: Math.PI * radius ** 2 - lens, exclude: 2 * Math.PI * radius ** 2 - 2 * lens };
    for (const op of operations) {
      const result = booleanShapes(first, second, op);
      expect(Math.abs(evenOddArea(result) / expected[op] - 1)).toBeLessThan(0.01);
      expectSimple(result);
    }
  });

  it("clips a shape with a hole independently of ring orientation", () => {
    const donut = [...rectShape(0, 0, 6, 6), ...rectShape(2, 2, 2, 2)];
    const strip = rectShape(3, -1, 4, 8);
    for (const first of [donut, reverse(donut), [donut[1], [...donut[0]].reverse()]]) {
      expectArea(booleanShapes(first, strip, "union"), 48);
      expectArea(booleanShapes(first, strip, "intersect"), 16);
      expectArea(booleanShapes(first, strip, "subtract"), 16);
      expectArea(booleanShapes(first, strip, "exclude"), 32);
    }
  });

  it("preserves an island nested inside a hole", () => {
    const nested = [...rectShape(0, 0, 10, 10), ...rectShape(1, 1, 8, 8), ...rectShape(3, 3, 4, 4)];
    const result = booleanShapes(nested, [], "union");
    expect(result).toHaveLength(3);
    expectArea(result, 52);
    expectArea(booleanShapes(nested, rectShape(4, -1, 2, 12), "intersect"), 12);
  });

  it("applies even-odd fill to overlapping or duplicated input rings", () => {
    const overlap = [...a, ...rectShape(1, 0, 2, 2)];
    expectArea(booleanShapes(overlap, [], "union"), 4);
    expect(booleanShapes([...a, ...a], [], "union")).toEqual([]);
    expectArea(booleanShapes([...a, ...a, ...reverse(a)], [], "union"), 4);
  });

  it("splits self-crossing input rings and multiway crossings", () => {
    const bowtie: Shape = [[[0, 0], [2, 2], [0, 2], [2, 0]]];
    const result = booleanShapes(bowtie, [], "union");
    expect(result).toHaveLength(2);
    expectArea(result, 2);
    expectArea(booleanShapes(bowtie, rectShape(1, -1, 2, 4), "intersect"), 1);
    const touching = [...rectShape(-2, -2, 2, 2), ...rectShape(0, 0, 2, 2)];
    const opposite = [...rectShape(-2, 0, 2, 2), ...rectShape(0, -2, 2, 2)];
    expectArea(booleanShapes(touching, opposite, "union"), 16);
    expectArea(booleanShapes(touching, opposite, "intersect"), 0);
  });

  it("accepts empty operands, duplicate vertices and repeated closing points", () => {
    for (const op of operations) expect(booleanShapes([], [], op)).toEqual([]);
    expectArea(booleanShapes(a, [], "union"), 4);
    expectArea(booleanShapes([], a, "union"), 4);
    expectArea(booleanShapes([], a, "exclude"), 4);
    expect(booleanShapes(a, [], "intersect")).toEqual([]);
    expect(booleanShapes([], a, "subtract")).toEqual([]);
    const repeated: Shape = [[[0, 0], [0, 0], [2, 0], [2, 1], [2, 2], [0, 2], [0, 0]]];
    expectArea(booleanShapes(repeated, b, "union"), 7);
  });

  it("drops degenerate rings without dropping small valid rings", () => {
    const degenerate: Shape = [[], [[0, 0]], [[0, 0], [1, 0]], [[0, 0], [1, 0], [2, 0]]];
    expect(booleanShapes(degenerate, [], "union")).toEqual([]);
    expect(booleanShapes(rectShape(0, 0, 1e-5, 1e-5), [], "union")).toEqual([]);
    expect(evenOddArea(booleanShapes(rectShape(0, 0, 1e-4, 1e-4), [], "union"))).toBeCloseTo(1e-8, 14);
  });

  it("tolerates nearly coincident vertices and large coordinate offsets", () => {
    const near = translateShape(a, 2 + 1e-10, 0);
    const union = booleanShapes(a, near, "union");
    expect(union).toHaveLength(1);
    expectArea(union, 8);
    const offsetA = translateShape(a, 1e9, -1e9);
    const offsetB = translateShape(b, 1e9, -1e9);
    expectArea(booleanShapes(offsetA, offsetB, "union"), 7);
    expectArea(booleanShapes(offsetA, offsetB, "intersect"), 1);
  });

  it("does not mutate or alias either input", () => {
    const first = structuredClone(a);
    const second = structuredClone(b);
    const result = booleanShapes(first, second, "union");
    expect(first).toEqual(a);
    expect(second).toEqual(b);
    result[0][0][0] += 100;
    expect(first).toEqual(a);
    expect(second).toEqual(b);
  });

  it("matches independent cell areas for deterministic overlapping rectangle sets", () => {
    let seed = 123456789;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let trial = 0; trial < 24; trial++) {
      const make = (): Shape => Array.from({ length: 4 }, () => rectShape(
        Math.floor(random() * 6), Math.floor(random() * 6),
        1 + Math.floor(random() * 4), 1 + Math.floor(random() * 4),
      )[0]);
      const first = make();
      const second = make();
      for (const op of operations) {
        let expected = 0;
        for (let x = 0.5; x < 10; x++) {
          for (let y = 0.5; y < 10; y++) {
            if (expectedFill(contains(first, x, y), contains(second, x, y), op)) expected++;
          }
        }
        expectArea(booleanShapes(first, second, op), expected);
      }
    }
  });

  it("matches point membership for deterministic non-axis-aligned polygons", () => {
    for (let trial = 0; trial < 12; trial++) {
      const make = (dx: number, phase: number): Shape => [Array.from({ length: 13 }, (_, i): [number, number] => {
        const angle = i * 2 * Math.PI / 13 + phase;
        const radius = 2 + 0.8 * Math.sin(i * 7.13 + trial);
        return [dx + radius * Math.cos(angle), radius * Math.sin(angle)];
      })];
      const first = make(0, 0.13);
      const second = make(1, 0.31);
      for (const op of operations) {
        const result = booleanShapes(first, second, op);
        expectSimple(result);
        for (let x = -3.123; x < 4; x += 0.61) {
          for (let y = -3.217; y < 3; y += 0.67) {
            expect(contains(result, x, y)).toBe(expectedFill(contains(first, x, y), contains(second, x, y), op));
          }
        }
      }
    }
  });

  it("keeps near-vertical crossings stable across scales and distant origins", () => {
    const first: Shape = [[
      [3906076.9882053137, 5159472.178202122], [2788101.6163155437, 7203577.358741313],
      [6963738.612830639, 9375201.64763555], [9883210.291154683, 2970563.976559788],
      [363762.9095464945, 4817692.607175559], [2147638.6254653335, 543732.4126251042],
      [8554804.529994726, 8370969.200041145], [9868378.21546942, 4609783.964697272],
      [3014517.454430461, 2026515.5914239585],
    ]];
    const second: Shape = [[
      [8225494.693033397, 3914601.143915206], [3829755.187034607, 5613378.507550806],
      [1220960.7334807515, 2025576.7763592303], [5544349.076226354, 6785.399746149778],
      [6828192.1884045005, 8963083.729613572], [9305714.759975672, 7221528.23349461],
      [6643537.343479693, 6357335.264328867], [5841536.736115813, 6296362.902503461],
      [5820969.301275909, 1286886.0107846558],
    ]];
    for (const [scale, offset] of [[1, 0], [1e-6, 1e8], [1e-4, 1e12]]) {
      const transform = (shape: Shape): Shape => shape.map((ring) => ring.map(([x, y]) => [x * scale + offset, y * scale - offset]));
      const a = transform(first);
      const b = transform(second);
      for (const op of operations) {
        const result = booleanShapes(a, b, op);
        for (let x = 123456; x < 10000000; x += 611111) {
          for (let y = 217384; y < 10000000; y += 677777) {
            const px = x * scale + offset;
            const py = y * scale - offset;
            expect(contains(result, px, py)).toBe(expectedFill(contains(a, px, py), contains(b, px, py), op));
          }
        }
      }
    }
  });

  it.each(["circles", "parallel strips"])("clips 3,000 vertices per operand (%s) in under 100 ms", (kind) => {
    const circle = (cx: number): Shape => [Array.from({ length: 3000 }, (_, i): [number, number] => {
      const angle = i * 2 * Math.PI / 3000;
      return [cx + 100 * Math.cos(angle), 100 * Math.sin(angle)];
    })];
    const strips = (offset: number): Shape => Array.from({ length: 750 }, (_, i) => {
      const y = i * 4 + offset;
      return [[0, y], [10000, 10000 + y], [10000, 10001 + y], [0, y + 1]];
    });
    const first = kind === "circles" ? circle(0) : strips(0);
    const second = kind === "circles" ? circle(50) : strips(2);
    booleanShapes(first, second, "union");
    const times: number[] = [];
    let result: Shape = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      result = booleanShapes(first, second, "union");
      times.push(performance.now() - start);
    }
    expect(result).toHaveLength(kind === "circles" ? 1 : 1500);
    expect(Math.min(...times)).toBeLessThan(100);
  });
});

describe("booleanMany", () => {
  const shapes = [rectShape(0, 0, 4, 2), rectShape(1, 0, 2, 2), rectShape(2, 0, 4, 2)];

  it.each([["union", 12], ["subtract", 2], ["intersect", 2], ["exclude", 8]] as const)("folds %s over three shapes", (op, area) => {
    expectArea(booleanMany(shapes, op), area);
  });

  it("handles empty and single-element lists without aliasing", () => {
    expect(booleanMany([], "union")).toEqual([]);
    const result = booleanMany([shapes[0]], "subtract");
    expectArea(result, 8);
    expect(result).not.toBe(shapes[0]);
    expect(result[0][0]).not.toBe(shapes[0][0][0]);
  });
});

describe("flattenPath", () => {
  it("flattens a closed cubic circle including its closing handles", () => {
    const k = 4 * (Math.sqrt(2) - 1) / 3;
    const path = {
      points: [1, 0, 0, 1, -1, 0, 0, -1],
      curves: [0, -k, 0, k, k, 0, -k, 0, 0, k, 0, -k, -k, 0, k, 0],
      closed: true,
    };
    const coarse = flattenPath(path, 0.1);
    const fine = flattenPath(path, 0.001);
    expect(fine).toHaveLength(1);
    expect(fine[0].length).toBeGreaterThan(coarse[0].length);
    expect(Math.abs(evenOddArea(fine) / Math.PI - 1)).toBeLessThan(0.01);
    expectSimple(fine);
    expect(fine[0][0]).toEqual([1, 0]);
    expect(fine[0][fine[0].length - 1]).not.toEqual([1, 0]);
    expect(contains(fine, 0.7, -0.7)).toBe(true);
  });

  it("closes open subpaths and respects anchor-index breaks", () => {
    const path = { points: [0, 0, 2, 0, 2, 2, 0, 2, 4, 0, 6, 0, 6, 2, 4, 2], breaks: [4], closed: false };
    const shape = flattenPath(path);
    expect(shape).toHaveLength(2);
    expectArea(shape, 8);
    expect(shape[0]).toHaveLength(4);
    expect(shape[1][0]).toEqual([4, 0]);
  });

  it("retains collinear cubic excursions and single-anchor cubic loops", () => {
    const excursion = flattenPath({ points: [0, 0, 1, 0, 1, 1], curves: [0, 0, 4, 0, 4, 0, 0, 0, 0, 0, 0, 0] }, 0.001);
    expect(Math.max(...excursion[0].map(([x]) => x))).toBeGreaterThan(3);
    const loop = flattenPath({ points: [0, 0], curves: [-2, 2, 2, 2] }, 0.01);
    expect(loop).toHaveLength(1);
    expect(evenOddArea(loop)).toBeGreaterThan(1);
  });

  it("handles empty geometry, zero handles and repeated closing anchors", () => {
    expect(flattenPath({ points: [] })).toEqual([]);
    expect(flattenPath({ points: [1, 1] })).toEqual([]);
    expect(flattenPath({ points: [0, 0, 2, 0, 2, 2, 0, 0], curves: Array(16).fill(0) })).toEqual([[[0, 0], [2, 0], [2, 2]]]);
  });
});

describe("shape constructors and transforms", () => {
  it("samples rounded rectangle areas within one percent of the analytic area", () => {
    for (const [width, height, radius] of [[10, 6, 2], [2, 2, 1], [20, 10, 100], [10000, 6000, 2000]]) {
      const r = Math.min(radius, width / 2, height / 2);
      const expected = width * height - (4 - Math.PI) * r * r;
      const shape = rectShape(-3, 7, width, height, radius);
      expect(Math.abs(evenOddArea(shape) / expected - 1)).toBeLessThan(0.01);
      expect(shape).toHaveLength(1);
    }
  });

  it("normalizes negative rectangle dimensions and handles zero dimensions", () => {
    expect(rectShape(3, 4, -2, -3)).toEqual(rectShape(1, 1, 2, 3));
    expect(rectShape(0, 0, 0, 2)).toEqual([]);
    expectArea(rectShape(0, 0, 2, 2, -3), 4);
  });

  it("samples ellipses with at least 48 segments and finer large-radius sampling", () => {
    const small = ellipseShape(3, 4, 2, 1);
    expect(small[0].length).toBeGreaterThanOrEqual(48);
    expect(Math.abs(evenOddArea(small) / (2 * Math.PI) - 1)).toBeLessThan(0.01);
    expect(ellipseShape(0, 0, 10000, 1000)[0].length).toBeGreaterThan(small[0].length);
    expect(ellipseShape(0, 0, 0, 1)).toEqual([]);
  });

  it("offsets shapeToPath coordinates and records each later ring start", () => {
    const shape = [...rectShape(-3, 5, 10, 8), ...rectShape(-1, 7, 2, 3)];
    const result = shapeToPath(shape);
    expect(result).toEqual({
      points: [0, 0, 10, 0, 10, 8, 0, 8, 2, 2, 4, 2, 4, 5, 2, 5],
      breaks: [4], x: -3, y: 5, width: 10, height: 8,
    });
    expect(translateShape(flattenPath(result), result.x, result.y)).toEqual(shape);
    expect(shapeToPath([[], ...shape, []])).toEqual(result);
    expect(shapeToPath([])).toEqual({ points: [], breaks: [], x: 0, y: 0, width: 0, height: 0 });
  });

  it("translates every ring without mutating or sharing points", () => {
    const shape = rectShape(1, 2, 2, 3);
    const translated = translateShape(shape, -5, 7);
    expect(translated).toEqual(rectShape(-4, 9, 2, 3));
    expect(shape).toEqual(rectShape(1, 2, 2, 3));
    expect(translated[0][0]).not.toBe(shape[0][0]);
    expect(translateShape([], 1, 2)).toEqual([]);
  });
});
