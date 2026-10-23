import { describe, expect, it } from "vitest";
import { applyCanvasOps } from "./canvas-ops.ts";
import { SLIDE_LAYOUTS, arrangeSlides, slideSpec, slideY, slidesOf } from "./canvas-deck.ts";

describe("deck specs", () => {
  it("builds every layout as a 1920×1080 slide with brand-bound colours and notes", () => {
    for (const [at, layout] of SLIDE_LAYOUTS.entries()) {
      const result = applyCanvasOps(new Map(), [{ op: "create", node: slideSpec({ layout, title: `T ${layout}`, notes: "Say hi" }, at, { heading: "inter" }) }]);
      const slide = result.changed[0]!;
      expect(slide).toMatchObject({ type: "frame", x: 0, y: slideY(at), width: 1920, height: 1080, notes: "Say hi" });
      expect(slide.fillStyle).toBe(layout === "section" || layout === "closing" ? "primary" : "background");
      expect(result.problems).toEqual([]);
    }
  });

  it("plays slides top to bottom and reorders only what moved", () => {
    const made = applyCanvasOps(new Map(), [0, 1, 2].map((at) => ({ op: "create", node: slideSpec({ title: `S${at}` }, at) })));
    const scene = new Map(made.changed.map((node) => [node.id, node]));
    const slides = slidesOf(scene);
    expect(slides.map((slide) => slide.name)).toEqual(["S0", "S1", "S2"]);
    const ops = arrangeSlides(scene, [slides[0]!.id, slides[2]!.id, slides[1]!.id]);
    expect(ops).toEqual([{ op: "update", id: slides[2]!.id, set: { x: 0, y: slideY(1) } }, { op: "update", id: slides[1]!.id, set: { x: 0, y: slideY(2) } }]);
  });
});
