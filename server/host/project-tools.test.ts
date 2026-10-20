import { describe, expect, it } from "vitest";
import { projectChiefForBudget } from "./project-tools.ts";

describe("trusted Pipeline project budget attribution", () => {
  it("uses only the visible linked project Chief", () => {
    expect(projectChiefForBudget([
      { id: "hidden", chiefOfStaff: true, hidden: true },
      { id: "agent", chiefOfStaff: false },
      { id: "other", chiefOfStaff: true },
      { id: "chief", chiefOfStaff: true },
    ], { hidden: "project", agent: "project", other: "other-project", chief: "project" }, "project")).toBe("chief");
  });

  it("refuses ambiguous links instead of choosing an uncapped Chief by list order", () => {
    const bots = [{ id: "uncapped", chiefOfStaff: true }, { id: "capped", chiefOfStaff: true }];
    for (const order of [bots, bots.toReversed()]) {
      expect(() => projectChiefForBudget(order, { uncapped: "project", capped: "project" }, "project")).toThrow("More than one project Chief");
    }
  });

  it("does not select an unrelated agent for a manual operation without a project Chief", () => {
    expect(projectChiefForBudget([{ id: "other", chiefOfStaff: true }], { other: "other-project" }, "project")).toBeUndefined();
  });
});
