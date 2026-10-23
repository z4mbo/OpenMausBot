import { describe, expect, it } from "vitest";
import { CHIEF_SECTIONS, tabSections, toolSections } from "./project-sections";

const label = (id: string) => CHIEF_SECTIONS.find((item) => item.id === id)?.label;

describe("project sections", () => {
  it("puts the Chief first, then the bar's tabs, then its tools", () => {
    expect(CHIEF_SECTIONS[0]).toMatchObject({ id: "chat", place: "lead" });
    expect(tabSections().map((item) => item.id)).toEqual(["issues", "team-chat", "call", "studio", "design", "broadcast"]);
    expect(toolSections().map((item) => item.id)).toEqual(["assets", "vault", "repo", "feedback", "settings"]);
    expect(new Set(CHIEF_SECTIONS.map((item) => item.id)).size).toBe(CHIEF_SECTIONS.length);
  });

  it("names the bar's pages as people see them", () => {
    expect(label("team-chat")).toBe("Chat");
    expect(label("broadcast")).toBe("Publish");
  });

  it("keeps Canvas off the bar", () => {
    const shown = [...tabSections(), ...toolSections()].map((item) => item.id);
    expect(shown).not.toContain("draw");
  });
});
