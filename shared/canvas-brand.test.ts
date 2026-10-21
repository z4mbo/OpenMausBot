import { describe, expect, it } from "vitest";
import { applyBrandToFrame, brandSwatches, textRole } from "./canvas-brand.ts";
import { defaultBrandKit } from "./brand-kit.ts";
import { renderCanvasPage, pageDocument } from "./canvas-page.ts";
import { sanitizeNode, type CanvasNode } from "./canvas-scene.ts";

const kit = { ...defaultBrandKit("Lumen"), colors: { primary: "#7C3AED", secondary: "#F59E0B", neutrals: ["#FFFFFF", "#111827"] }, fonts: { heading: "fraunces" as const, body: "dm-sans" as const } };

let z = 0;
const node = (patch: Partial<CanvasNode> & Pick<CanvasNode, "id" | "type">): CanvasNode => sanitizeNode({
  version: 1, versionNonce: 1, parentId: null, z: ++z, name: patch.id, x: 0, y: 0, width: 100, height: 40, rotation: 0, opacity: 1, fill: null, stroke: null, strokeWidth: 0, radius: 0, ...patch,
})!;

function hero() {
  const nodes = [
    node({ id: "hero", type: "frame", width: 1200, height: 800, fill: "#0B0B0F" }),
    node({ id: "title", type: "text", parentId: "hero", text: "Ship faster", fontSize: 56, fontWeight: 700, fill: "#FFFFFF" }),
    node({ id: "copy", type: "text", parentId: "hero", y: 80, text: "For teams", fontSize: 18, fill: "#D1D5DB" }),
    node({ id: "button", type: "rect", parentId: "hero", x: 0, y: 200, width: 200, height: 56, fill: "#2563EB" }),
    node({ id: "label", type: "text", parentId: "hero", x: 20, y: 214, width: 160, text: "Start", fontSize: 16, fill: "#FFFFFF" }),
    node({ id: "badge", type: "ellipse", parentId: "hero", x: 600, y: 600, width: 20, height: 20, fill: "#16A34A" }),
    node({ id: "form", type: "frame", parentId: "hero", y: 300, width: 300, height: 200, fill: null, leadForm: { fields: ["email"], button: "Join", accent: "#2563EB" } }),
  ];
  return new Map(nodes.map((item) => [item.id, item]));
}

describe("brand on Canvas", () => {
  it("reads large or bold text as headings", () => {
    expect(textRole({ fontSize: 32 })).toBe("heading");
    expect(textRole({ fontSize: 20, fontWeight: 700 })).toBe("heading");
    expect(textRole({ fontSize: 16, fontWeight: 700 })).toBe("body");
  });

  it("restyles a frame: neutrals to the kit's, accents by area to primary then secondary, text in the kit's faces and legible colours", () => {
    const scene = hero();
    const changed = new Map(applyBrandToFrame(scene, "hero", kit).map((item) => [item.id, item]));
    expect(changed.get("hero")!.fill).toBe("#111827");
    expect(changed.get("button")!.fill).toBe("#7C3AED");
    expect(changed.get("badge")!.fill).toBe("#F59E0B");
    expect(changed.get("form")!.leadForm!.accent).toBe("#7C3AED");
    expect(changed.get("title")).toMatchObject({ family: "fraunces", font: "serif", fill: "#FFFFFF" });
    expect(changed.get("copy")).toMatchObject({ family: "dm-sans", font: "sans", fill: "#FFFFFF" });
    expect(changed.get("label")).toMatchObject({ family: "dm-sans", fill: "#FFFFFF" });
    const again = new Map(scene);
    for (const item of changed.values()) again.set(item.id, item);
    expect(applyBrandToFrame(again, "hero", kit)).toEqual([]);
  });

  it("gives an unfilled frame the kit's background and leaves non-frames alone", () => {
    const scene = new Map([["blank", node({ id: "blank", type: "frame", fill: null })], ["text", node({ id: "text", type: "text", parentId: "blank", text: "Hi", fill: "#000000" })]]);
    const changed = applyBrandToFrame(scene, "blank", kit);
    expect(changed.find((item) => item.id === "blank")!.fill).toBe("#FFFFFF");
    expect(changed.find((item) => item.id === "text")!.fill).toBe("#111827");
    expect(applyBrandToFrame(scene, "text", kit)).toEqual([]);
  });

  it("lists each kit colour once as a swatch", () => {
    expect(brandSwatches(kit).map((swatch) => swatch.label)).toEqual(["Primary", "Secondary", "Background", "Text"]);
  });

  it("publishes brand faces and loads them from Google Fonts", () => {
    const scene = hero();
    for (const item of applyBrandToFrame(scene, "hero", kit)) scene.set(item.id, item);
    const page = renderCanvasPage(scene, "hero", new Map())!;
    expect(page.fonts.sort()).toEqual(["dm-sans", "fraunces"]);
    expect(page.body).toContain("font-family:&quot;Fraunces&quot;, Georgia");
    const html = pageDocument({ title: "Lumen", description: "", page });
    expect(html).toContain("family=DM+Sans:wght@");
    expect(html).toContain("family=Fraunces:wght@");
    expect(sanitizeNode({ ...scene.get("title"), family: "comic-sans" })!.family).toBeUndefined();
  });
});
