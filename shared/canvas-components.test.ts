import { describe, expect, it } from "vitest";
import { applyCanvasOps } from "./canvas-ops.ts";
import { componentSets, constrain, detach, pickVariant, settleComponents, swapVariant, masterTree, variantProps } from "./canvas-components.ts";
import { childrenIndex, layoutStacks, sanitizeNode, type CanvasNode } from "./canvas-scene.ts";
import { colorStyles, restyle } from "./canvas-styles.ts";

const sceneOf = (nodes: readonly CanvasNode[]) => new Map(nodes.map((node) => [node.id, node]));
const fixed = (text: string) => text.length * 10;

function button() {
  const made = applyCanvasOps(new Map(), [{ op: "create", node: {
    type: "frame", key: "button", name: "Button", w: 160, h: 44, fill: "#111111", component: { set: "Button", props: { Size: "Large" } },
    children: [{ type: "text", key: "label", name: "Label", text: "Buy", x: 16, y: 12, fill: "#FFFFFF" }],
  } }], { measure: fixed });
  return { scene: sceneOf(made.changed), master: made.created[0]!.id, label: made.created[1]!.id };
}

describe("components and instances", () => {
  it("instantiates a component and pushes component edits to the instance, keeping overrides", () => {
    const { scene, master, label } = button();
    const placed = applyCanvasOps(scene, [{ op: "instance", component: "Button", key: "copy", set: { x: 400, y: 0 } }], { measure: fixed });
    const work = sceneOf([...scene.values(), ...placed.changed]);
    const root = placed.created[0]!.id;
    const copyLabel = [...work.values()].find((node) => node.sourceId === label)!;
    expect(work.get(root)).toMatchObject({ instanceOf: master, x: 400, width: 160 });

    const overridden = applyCanvasOps(work, [{ op: "update", id: copyLabel.id, set: { text: "Sign up" } }], { measure: fixed });
    const afterOverride = sceneOf([...work.values(), ...overridden.changed]);
    expect(afterOverride.get(copyLabel.id)!.overrides).toEqual(expect.arrayContaining(["text"]));

    const edited = applyCanvasOps(afterOverride, [{ op: "update", id: master, set: { fill: "#7C3AED" } }, { op: "update", id: label, set: { text: "Purchase", fill: "#EEEEEE" } }], { measure: fixed });
    const result = sceneOf([...afterOverride.values(), ...edited.changed]);
    expect(result.get(root)!.fill).toBe("#7C3AED");
    expect(result.get(copyLabel.id)!.text).toBe("Sign up");
    expect(result.get(copyLabel.id)!.fill).toBe("#EEEEEE");
  });

  it("adds and removes instance nodes as the component gains and loses layers", () => {
    const { scene, master, label } = button();
    const placed = applyCanvasOps(scene, [{ op: "instance", component: master }], { measure: fixed });
    let work = sceneOf([...scene.values(), ...placed.changed]);
    const grown = applyCanvasOps(work, [{ op: "create", parent: master, node: { type: "ellipse", name: "Dot", w: 8, h: 8 } }, { op: "delete", id: label }], { measure: fixed });
    work = sceneOf([...work.values(), ...grown.changed]);
    const kids = childrenIndex(work).get(placed.created[0]!.id)!;
    expect(kids.map((node) => node.name)).toEqual(["Dot"]);
  });

  it("detaches an instance into plain layers", () => {
    const { scene } = button();
    const placed = applyCanvasOps(scene, [{ op: "instance", component: "button" }], { measure: fixed });
    const work = sceneOf([...scene.values(), ...placed.changed]);
    const loose = detach(work, childrenIndex(work), placed.created[0]!.id);
    expect(loose.every((node) => !node.instanceOf && !node.sourceId)).toBe(true);
  });

  it("swaps variants and keeps overrides on layers with the same name", () => {
    const { scene, master } = button();
    const small = applyCanvasOps(scene, [{ op: "create", node: {
      type: "frame", name: "Button small", w: 100, h: 32, fill: "#222222", component: { set: "Button", props: { Size: "Small" } },
      children: [{ type: "text", name: "Label", text: "Buy", fill: "#FFFFFF" }],
    } }, { op: "instance", component: master, key: "copy" }], { measure: fixed });
    let work = sceneOf([...scene.values(), ...small.changed]);
    const root = small.created.find((node) => node.key === "copy")!.id;
    const label = childrenIndex(work).get(root)![0]!;
    work = sceneOf([...work.values(), ...applyCanvasOps(work, [{ op: "update", id: label.id, set: { text: "Go" } }], { measure: fixed }).changed]);
    const set = componentSets(work)[0]!;
    expect(variantProps(set.components).get("Size")).toEqual(expect.arrayContaining(["Large", "Small"]));
    const target = pickVariant(set.components, work.get(master)!, "Size", "Small")!;
    const index = childrenIndex(work);
    const swapped = sceneOf([...work.values(), ...swapVariant(work, index, root, masterTree(work, index, master), masterTree(work, index, target.id))]);
    expect(swapped.get(root)).toMatchObject({ instanceOf: target.id, width: 100, fill: "#222222" });
    expect(childrenIndex(swapped).get(root)![0]!.text).toBe("Go");
  });

  it("records overrides only for what a person changed", () => {
    const { scene, master } = button();
    const placed = applyCanvasOps(scene, [{ op: "instance", component: master }], { measure: fixed });
    const work = sceneOf([...scene.values(), ...placed.changed]);
    const root = work.get(placed.created[0]!.id)!;
    const moved = { ...root, x: 999, width: 200 };
    work.set(root.id, moved);
    const touched = new Set([root.id]);
    settleComponents(work, touched, new Map([[root.id, root]]));
    expect(work.get(root.id)!.overrides).toEqual(["width"]);
  });
});

describe("constraints", () => {
  it("moves, centres, stretches and scales children with their frame", () => {
    const from = { width: 100, height: 100 };
    const to = { width: 200, height: 150 };
    expect(constrain({ x: 80, y: 10, width: 10, height: 10, constraints: { h: "right", v: "bottom" } }, from, to)).toEqual({ x: 180, y: 60, width: 10, height: 10 });
    expect(constrain({ x: 45, y: 0, width: 10, height: 10, constraints: { h: "center", v: "top" } }, from, to)).toMatchObject({ x: 95 });
    expect(constrain({ x: 10, y: 0, width: 80, height: 10, constraints: { h: "stretch", v: "top" } }, from, to)).toMatchObject({ x: 10, width: 180 });
    expect(constrain({ x: 10, y: 0, width: 80, height: 10, constraints: { h: "scale", v: "top" } }, from, to)).toMatchObject({ x: 20, width: 160 });
  });

  it("applies constraints when an agent resizes a frame", () => {
    const made = applyCanvasOps(new Map(), [{ op: "create", node: { type: "frame", key: "f", w: 100, h: 100, children: [{ type: "rect", key: "r", x: 80, y: 80, w: 10, h: 10, constraints: { h: "right", v: "bottom" } }] } }]);
    const scene = sceneOf(made.changed);
    const frame = made.created[0]!.id;
    const resized = applyCanvasOps(scene, [{ op: "update", id: frame, set: { w: 300, h: 200 } }]);
    expect(resized.changed.find((node) => node.id === made.created[1]!.id)).toMatchObject({ x: 280, y: 180 });
  });
});

describe("auto layout extras", () => {
  const node = (raw: Record<string, unknown>) => sanitizeNode({ version: 1, versionNonce: 1, ...raw })!;
  it("wraps rows, skips absolute children and clamps sizes", () => {
    const frame = node({ id: "f", type: "frame", parentId: null, width: 250, height: 10, layout: { direction: "row", gap: 10, padding: 0, wrap: true, crossGap: 4, hug: "height" } });
    const kids = [1, 2, 3].map((at) => node({ id: `c${at}`, type: "rect", parentId: "f", z: at, width: 100, height: 20 }));
    const pinned = node({ id: "abs", type: "rect", parentId: "f", z: 9, width: 10, height: 10, x: 5, y: 5, absolute: true });
    const grow = node({ id: "g", type: "rect", parentId: "f", z: 10, width: 10, height: 20, grow: true, maxW: 60 });
    const scene = sceneOf([frame, ...kids, pinned, grow]);
    const out = sceneOf(layoutStacks(scene, ["f"], fixed));
    const read = (id: string) => out.get(id) ?? scene.get(id)!;
    expect(read("c1")).toMatchObject({ x: 0, y: 0 });
    expect(read("c2")).toMatchObject({ x: 110, y: 0 });
    expect(read("c3")).toMatchObject({ x: 0, y: 24 });
    expect(read("abs")).toMatchObject({ x: 5, y: 5 });
    expect(read("g").width).toBe(60);
    expect(read("f").height).toBe(44);
  });
});

describe("styles", () => {
  it("restyles nodes bound to colour and text styles when the kit changes", () => {
    const kit = { colors: { primary: "#FF0000", secondary: "#00FF00", neutrals: ["#FFFFFF", "#000000"] }, fonts: { heading: "inter" as const, body: "inter" as const } };
    const made = applyCanvasOps(new Map(), [{ op: "create", node: { type: "rect", fillStyle: "primary" } }, { op: "create", node: { type: "text", text: "Hi", textStyle: "h1" } }], { kit });
    const scene = sceneOf(made.changed);
    expect(made.changed[0]!.fill).toBe("#FF0000");
    expect(made.changed[1]).toMatchObject({ fontSize: 44, textStyle: "h1", family: "inter" });
    const changed = restyle(scene, { ...kit, colors: { ...kit.colors, primary: "#123456" } });
    expect(changed.map((node) => node.fill)).toContain("#123456");
    expect(colorStyles(null).length).toBeGreaterThan(4);
  });
});
