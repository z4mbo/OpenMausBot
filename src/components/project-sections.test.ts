import { describe, expect, it } from "vitest";
import { CHIEF_SECTIONS, sectionEntry, tabSections, toolSections } from "./project-sections";

describe("project sections", () => {
  it("puts the Chief first, then the bar's tabs, then its tools", () => {
    expect(sectionEntry("chat").place).toBe("lead");
    expect(tabSections().map((item) => item.id)).toEqual(["agents", "issues", "team-chat", "call", "studio", "broadcast"]);
    expect(toolSections().map((item) => item.id)).toEqual(["assets", "vault", "repo", "feedback", "settings"]);
    expect(new Set(CHIEF_SECTIONS.map((item) => item.id)).size).toBe(CHIEF_SECTIONS.length);
  });

  it("names the bar's pages as people see them", () => {
    expect(sectionEntry("team-chat").label).toBe("Chat");
    expect(sectionEntry("broadcast").label).toBe("Publish");
  });

  it("keeps Canvas and Sales off the bar", () => {
    const shown = [...tabSections(), ...toolSections()].map((item) => item.id);
    expect(shown).not.toContain("draw");
    expect(shown).not.toContain("pipeline");
  });
});
