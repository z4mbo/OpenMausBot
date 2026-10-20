import { describe, expect, it } from "vitest";
import { applyCanvasOps } from "./canvas-ops.ts";
import { defaultBrandKit } from "./brand-kit.ts";
import { componentSets } from "./canvas-components.ts";

describe("the design_system op", () => {
  it("builds colour swatches, type specimens and base components bound to the brand kit", () => {
    const kit = { ...defaultBrandKit("Lumen"), colors: { primary: "#E4572E", secondary: "#17BEBB", neutrals: ["#FFFFFF", "#F2F2F2", "#6B6B6B", "#141414"] } };
    const result = applyCanvasOps(new Map(), [{ op: "design_system" }], { kit });
    expect(result.problems).toEqual([]);
    const nodes = new Map(result.changed.map((node) => [node.id, node]));
    const root = result.changed.find((node) => node.name === "Design system" && !node.parentId)!;
    expect(root.layout?.hug).toBe("height");
    expect(result.changed.find((node) => node.type === "text" && node.text === "Lumen design system")?.textStyle).toBe("h1");
    const swatches = result.changed.filter((node) => node.name === "Swatch");
    expect(swatches.map((node) => node.fillStyle)).toContain("primary");
    expect(swatches.find((node) => node.fillStyle === "primary")?.fill).toBe("#E4572E");
    expect(result.changed.filter((node) => node.type === "text" && node.textStyle === "display")).toHaveLength(1);
    const sets = componentSets(nodes).map((set) => `${set.set}:${set.components.length}`).sort();
    expect(sets).toEqual(["Button:2", "Card:1", "Input:1", "Nav:1"]);
  });
});
