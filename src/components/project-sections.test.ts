import { describe, expect, it } from "vitest";
import { CHIEF_SECTIONS, tabSections, teamAgents, toolSections } from "./project-sections";
import type { Bot } from "@/state/store";

const label = (id: string) => CHIEF_SECTIONS.find((item) => item.id === id)?.label;

describe("project sections", () => {
  it("puts the Chief first, then the bar's tabs, then its tools", () => {
    expect(CHIEF_SECTIONS[0]).toMatchObject({ id: "chat", place: "lead" });
    expect(tabSections().map((item) => item.id)).toEqual(["issues", "team-chat", "call"]);
    expect(toolSections().map((item) => item.id)).toEqual(["assets", "vault", "repo", "feedback", "settings"]);
    expect(new Set(CHIEF_SECTIONS.map((item) => item.id)).size).toBe(CHIEF_SECTIONS.length);
  });

  it("names the bar's pages as people see them", () => {
    expect(label("team-chat")).toBe("Chat");
    expect(label("chat")).toBe("Chief");
  });

  it("lists only visible specialists from the project's team", () => {
    const chief = { id: "chief", chiefOfStaff: true, section: " Project " } as Bot;
    const specialist = { id: "researcher", section: "Project" } as Bot;
    const bots = [chief, specialist, { id: "other-chief", chiefOfStaff: true, section: "Project" },
      { id: "hidden", hidden: true, section: "Project" }, { id: "unrelated", section: "Other" }] as Bot[];
    expect(teamAgents(bots, chief)).toEqual([specialist]);
    expect(teamAgents(bots, { ...chief, section: "" })).toEqual([]);
  });
});
