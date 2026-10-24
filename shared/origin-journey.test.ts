import { describe, expect, it } from "vitest";
import { journeyContextLine, nextJourneyStep, phasesDone, type JourneyFacts } from "./origin-journey.ts";

const empty: JourneyFacts = { name: "Rocket", brief: false, docs: 0, drafts: 0, issuesOpen: 0, issuesDone: 0, shipped: false };

describe("nextJourneyStep", () => {
  it.each([
    [{}, "brief", "plan", "docs"],
    [{ brief: true }, "issues", "plan", "issues"],
    [{ issuesOpen: 3 }, "build", "build", "issues"],
    [{ issuesOpen: 0, issuesDone: 4 }, "ship", "build", "ship"],
    [{ shipped: true }, "feedback", "launch", "feedback"],
  ] as const)("%o leads to %s", (facts, id, phase, section) => {
    expect(nextJourneyStep({ ...empty, ...facts })).toMatchObject({ id, phase, section });
  });

  it("goes by the furthest thing made, so a skipped Brief does not pull a building project back", () => {
    expect(nextJourneyStep({ ...empty, issuesOpen: 2 }).id).toBe("build");
    expect(nextJourneyStep({ ...empty, issuesOpen: 2, issuesDone: 5, shipped: true }).id).toBe("feedback");
  });

  it("names its numbers and briefs the Chief about the project by name", () => {
    expect(nextJourneyStep({ ...empty, issuesOpen: 1 }).title).toBe("Build the MVP · 1 issue open");
    expect(nextJourneyStep({ ...empty, brief: true, drafts: 2 }).detail).toBe("2 Draft issues wait to be moved onto the board.");
    expect(nextJourneyStep(empty).brief).toContain("Brief for Rocket");
  });
});

describe("phasesDone", () => {
  it("marks every phase before the step's own", () => {
    expect(phasesDone({ phase: "plan" })).toEqual({ plan: false, build: false, launch: false, sell: false });
    expect(phasesDone({ phase: "launch" })).toEqual({ plan: true, build: true, launch: false, sell: false });
  });
});

describe("journeyContextLine", () => {
  it("says the phase, what exists and the next step", () => {
    const line = journeyContextLine({ ...empty, brief: true, issuesOpen: 4, issuesDone: 6, drafts: 1 });
    expect(line).toBe("- Journey (Plan → Build → Launch → Sell): Rocket is in Build; Brief written, 4 open / 6 done issues (1 in Draft), not shipped. Next step: Build the MVP · 4 issues open. Hand issues to agents, or take one yourself. Steer plans and suggestions toward it unless the person asks for something else.");
  });
});
