import { describe, expect, it } from "vitest";
import {
  brandColor, brandContextLine, brandContrastChecks, brandPalette, brandVoiceGuide, contrastPasses, contrastRatio, defaultBrandKit, normalizeBrandKit,
} from "./brand-kit.ts";
import { brandFontStack, googleFontsHref } from "./brand-fonts.ts";

const kit = { ...defaultBrandKit("Lumen"), colors: { primary: "#7C3AED", secondary: "#FDE68A", neutrals: ["#111827", "#FFFFFF", "#9CA3AF"] } };

describe("brand kit", () => {
  it("reads colours in any hex form and refuses the rest", () => {
    expect(brandColor("#abc")).toBe("#AABBCC");
    expect(brandColor("7c3aed")).toBe("#7C3AED");
    expect(brandColor("blue")).toBeNull();
    expect(brandColor("#12345")).toBeNull();
  });

  it("measures WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeGreaterThan(4.5);
  });

  it("takes the lightest neutral as background, the darkest as text, and the most legible label for each accent", () => {
    const palette = brandPalette(kit);
    expect(palette).toMatchObject({ background: "#FFFFFF", text: "#111827", onPrimary: "#FFFFFF", onSecondary: "#111827" });
    const checks = brandContrastChecks(kit);
    expect(checks.map((check) => check.id)).toEqual(["text", "primary-label", "primary-text", "secondary-label"]);
    expect(checks.every(contrastPasses)).toBe(true);
    const weak = brandContrastChecks({ colors: { primary: "#FDE68A", secondary: "#FDE68A", neutrals: ["#FFFFFF", "#F3F4F6"] } });
    expect(weak.find((check) => check.id === "primary-text")).toMatchObject({ level: "fail" });
    expect(weak.find((check) => check.id === "text")!.foreground).toBe("#111111");
  });

  it("normalizes untrusted input over a base and names what it refused", () => {
    const { kit: next, problems } = normalizeBrandKit({
      name: "  Lumen   Labs ", voice: { adjectives: "warm, Warm, precise, bold, calm, kind, extra", dont: ["", "jargon"] },
      colors: { primary: "#abc", secondary: "nope", neutrals: ["#fff", "#FFFFFF", "#000"] }, fonts: { heading: "fraunces", body: "papyrus" }, imagery: ["soft light"],
    }, kit);
    expect(next).toMatchObject({
      name: "Lumen Labs", voice: { adjectives: ["warm", "precise", "bold", "calm", "kind"], do: [], dont: ["jargon"] },
      colors: { primary: "#AABBCC", secondary: "#FDE68A", neutrals: ["#FFFFFF", "#000000"] }, fonts: { heading: "fraunces", body: "inter" }, imagery: ["soft light"],
    });
    expect(problems).toEqual([expect.stringMatching(/secondary colour/), expect.stringMatching(/body font/)]);
    expect(normalizeBrandKit({ neutrals: [] }, kit).problems).toEqual([]);
    expect(normalizeBrandKit({ colors: { neutrals: [] } }, kit).problems).toEqual([expect.stringMatching(/Neutrals/)]);
  });

  it("writes the voice for agents and stays quiet without one", () => {
    expect(brandVoiceGuide(kit)).toBe("");
    const voiced = { ...kit, tagline: "Light for night owls", voice: { adjectives: ["warm"], do: ["Short sentences"], dont: ["Jargon"] } };
    expect(brandVoiceGuide(voiced)).toBe(`Lumen ("Light for night owls") voice: sound warm. do: Short sentences. don't: Jargon.`);
    expect(brandContextLine(voiced)).toContain("fonts Inter and Inter");
  });

  it("loads Google faces only, and puts a brand face ahead of its fallback", () => {
    expect(googleFontsHref(["fraunces", "georgia", "fraunces", "inter"])).toBe("https://fonts.googleapis.com/css2?family=Fraunces:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700;800;900&display=swap");
    expect(googleFontsHref(["georgia", "system"])).toBeNull();
    expect(brandFontStack("fraunces", "serif")).toBe("\"Fraunces\", serif");
    expect(brandFontStack("unknown", "serif")).toBe("serif");
  });
});
