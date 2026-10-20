import { describe, expect, it } from "vitest";
import { CHIEF_SECTIONS, phaseLanding, phaseOf, phaseSections, rememberSection, toolSections } from "./project-sections";
import { stepOrigin } from "@/lib/origin-journey";

describe("project sections by phase", () => {
  it("puts every section in one place, Pulse at home and Vault and Settings as tools", () => {
    expect(phaseSections("plan").map((item) => item.id)).toEqual(["chat", "team-chat", "call", "docs", "draw"]);
    expect(phaseSections("build").map((item) => item.id)).toEqual(["issues", "agents", "repo", "ship"]);
    expect(phaseSections("launch").map((item) => item.id)).toEqual(["studio", "broadcast", "assets"]);
    expect(phaseSections("sell").map((item) => item.id)).toEqual(["pipeline", "feedback"]);
    expect(toolSections().map((item) => item.id)).toEqual(["vault", "settings"]);
    expect(new Set(CHIEF_SECTIONS.map((item) => item.id)).size).toBe(CHIEF_SECTIONS.length);
    expect(phaseOf("pulse")).toBeNull();
    expect(phaseOf("vault")).toBeNull();
    expect(phaseOf("pipeline")).toBe("sell");
  });

  it("opens a phase on the section last seen in it, per project", () => {
    expect(phaseLanding("a", "build")).toBe("issues");
    rememberSection("a", "ship");
    rememberSection("a", "settings");
    expect(phaseLanding("a", "build")).toBe("ship");
    expect(phaseLanding("b", "build")).toBe("issues");
  });

  it("points a step from the section whose work leads to it", () => {
    expect(stepOrigin({ id: "sketch" })).toBe("docs");
    expect(stepOrigin({ id: "ship" })).toBe("issues");
    expect(stepOrigin({ id: "sell" })).toBe("broadcast");
    expect(stepOrigin({ id: "brief" })).toBeUndefined();
  });
});
