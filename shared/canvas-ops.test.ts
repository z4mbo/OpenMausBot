import { describe, expect, it } from "vitest";
import { applyCanvasOps, compactScene } from "./canvas-ops.ts";
import { childrenIndex, decodeScene, encodeNode, sanitizeNode, wrapText, type CanvasNode } from "./canvas-scene.ts";

const sceneOf = (nodes: readonly CanvasNode[]) => new Map(nodes.map((node) => [node.id, node]));
const fixedWidth = (text: string) => text.length * 10;

describe("canvas scene rows", () => {
  it("sanitizes untrusted nodes and drops unknown fields", () => {
    const node = sanitizeNode({ id: "a", type: "rect", version: 2, versionNonce: 1, x: 5, y: Infinity, width: -3, fill: "red", stroke: "#abc", evil: "<script>", opacity: 4 });
    expect(node).toMatchObject({ id: "a", x: 5, y: 0, width: 0, fill: null, stroke: "#ABC", opacity: 1, name: "Rectangle" });
    expect(node).not.toHaveProperty("evil");
    expect(sanitizeNode({ id: "a", type: "script", version: 1, versionNonce: 1 })).toBeNull();
    expect(sanitizeNode({ id: "a", type: "rect", version: 0, versionNonce: 1 })).toBeNull();
  });

  it("reads Excalidraw rows as Canvas nodes, frame children relative to their frame, deleted ones as tombstones", () => {
    const rows = [
      JSON.stringify({ id: "f", type: "frame", name: "Board", version: 1, versionNonce: 1, index: "a0", x: 100, y: 50, width: 400, height: 300 }),
      JSON.stringify({ id: "t", type: "text", text: "Hi", frameId: "f", version: 1, versionNonce: 1, index: "a1", x: 120, y: 70, width: 20, height: 20, strokeColor: "#1e1e1e" }),
      JSON.stringify({ id: "l", type: "arrow", version: 1, versionNonce: 1, index: "a2", x: 10, y: 10, width: 50, height: 20, points: [[0, 0], [-50, 20]], strokeColor: "#e03131" }),
      JSON.stringify({ id: "gone", type: "rectangle", isDeleted: true, version: 3, versionNonce: 1, index: "a3", x: 0, y: 0, width: 1, height: 1 }),
      encodeNode(sanitizeNode({ id: "n", type: "ellipse", version: 1, versionNonce: 1, x: 0, y: 0, width: 10, height: 10 })!),
      "{broken",
    ];
    const nodes = sceneOf(decodeScene(rows));
    expect(nodes.get("f")).toMatchObject({ type: "frame", name: "Board" });
    expect(nodes.get("t")).toMatchObject({ type: "text", parentId: "f", x: 20, y: 20, text: "Hi", fill: "#9CA3AF" });
    expect(nodes.get("l")).toMatchObject({ type: "arrow", x: -40, y: 10, points: [50, 0, 0, 20], stroke: "#E03131" });
    expect(nodes.get("gone")?.deleted).toBe(true);
    expect(nodes.get("n")?.type).toBe("ellipse");
  });

  it("wraps text at a width and keeps explicit lines", () => {
    expect(wrapText("one two three\nfour", 80, {}, fixedWidth)).toEqual(["one two", "three", "four"]);
    expect(wrapText("abcdefghijkl", 50, {}, fixedWidth)).toEqual(["abcde", "fghij", "kl"]);
  });
});

describe("agent operations", () => {
  const pricing = {
    op: "create", node: {
      type: "frame", key: "section", name: "Pricing", w: 1000, layout: { direction: "column", gap: 20, padding: [40, 50], align: "center", hug: "height" },
      children: [
        { type: "text", text: "Pricing", fontSize: 40 },
        { type: "frame", key: "row", name: "Plans", w: 900, fill: null, layout: { direction: "row", gap: 30, align: "stretch", hug: "height" }, children: [
          { type: "frame", name: "Basic", grow: true, h: 200 },
          { type: "frame", name: "Pro", grow: true, h: 260 },
        ] },
      ],
    },
  };

  it("builds a laid-out section from a nested spec", () => {
    const result = applyCanvasOps(new Map(), [pricing], { measure: fixedWidth });
    expect(result.problems).toEqual([]);
    const scene = sceneOf(result.changed);
    const byName = (name: string) => result.changed.find((node) => node.name === name)!;
    const section = byName("Pricing");
    expect(section.type === "frame" && section.parentId).toBe(null);
    const title = result.changed.find((node) => node.type === "text")!;
    expect(title).toMatchObject({ name: "Pricing", autoWidth: true, unmeasured: true, width: 70, y: 40 });
    expect(title.x).toBe((1000 - 70) / 2);
    const row = byName("Plans");
    expect(row).toMatchObject({ x: 50, y: 40 + title.height + 20, height: 260 });
    expect(byName("Basic")).toMatchObject({ x: 0, width: 435, height: 260 });
    expect(byName("Pro")).toMatchObject({ x: 465, width: 435 });
    expect(section.height).toBe(40 + title.height + 20 + 260 + 40);
    expect(childrenIndex(scene).get(row.id)?.map((node) => node.name)).toEqual(["Basic", "Pro"]);
    expect(result.created.find((node) => node.key === "row")?.id).toBe(row.id);
  });

  it("places a new top-level frame beside the existing ones and reads back as compact specs", () => {
    const first = applyCanvasOps(new Map(), [pricing], { measure: fixedWidth });
    const scene = sceneOf(first.changed);
    const second = applyCanvasOps(scene, [{ op: "create", node: { type: "frame", name: "Next", w: 390, h: 844 } }]);
    expect(second.changed[0]).toMatchObject({ x: 1000 + 100, y: 0, version: 1 });
    const compact = compactScene(scene);
    expect(compact.total).toBe(first.changed.length);
    expect(compact.nodes[0]).toMatchObject({ type: "frame", name: "Pricing", w: 1000, layout: { direction: "column" } });
    expect(compact.nodes[0].children?.[1].children?.map((child) => child.name)).toEqual(["Basic", "Pro"]);
  });

  it("updates, reparents and deletes with bumped versions, refusing what it cannot do", () => {
    const first = applyCanvasOps(new Map(), [pricing], { measure: fixedWidth });
    const scene = sceneOf(first.changed);
    const pro = first.changed.find((node) => node.name === "Pro")!;
    const row = first.changed.find((node) => node.name === "Plans")!;
    const result = applyCanvasOps(scene, [
      { op: "update", id: pro.id, set: { fill: "#111827", name: "Pro plan" } },
      { op: "delete", id: row.id },
      { op: "update", id: "missing", set: {} },
      { op: "create", parent: pro.id, node: { type: "rect" } },
      { op: "create", node: { type: "image", asset: "Logo" } },
      { op: "launch" },
    ], { assets: new Map([["Logo", "asset-1"]]) });
    const updated = result.changed.find((node) => node.id === pro.id)!;
    expect(updated).toMatchObject({ name: "Pro plan", fill: "#111827", deleted: true, version: pro.version + 1 });
    expect(result.changed.filter((node) => node.deleted).map((node) => node.name).sort()).toEqual(["Basic", "Plans", "Pro plan"]);
    expect(result.changed.find((node) => node.type === "image")?.fileId).toBe("asset-1");
    expect(result.problems).toEqual([
      "ops[2]: no node missing.",
      `ops[3]: parent ${pro.id} is not a frame or group on this canvas.`,
      "ops[5]: op must be create, update, delete or instance.",
    ]);
  });

  it("re-lays a stack after an update and leaves the input scene untouched", () => {
    const first = applyCanvasOps(new Map(), [pricing], { measure: fixedWidth });
    const scene = sceneOf(first.changed);
    const row = first.changed.find((node) => node.name === "Plans")!;
    const result = applyCanvasOps(scene, [{ op: "update", id: row.id, set: { layout: { gap: 100 } } }], { measure: fixedWidth });
    expect(result.changed.find((node) => node.name === "Pro")).toMatchObject({ x: 500, width: 400 });
    expect(scene.get(row.id)?.layout?.gap).toBe(30);
  });
});
