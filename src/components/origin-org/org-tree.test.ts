import { describe, expect, it } from "vitest";
import { formatTokens, groupOrg, type OrgNode } from "./org-tree";

const node = (fields: Partial<OrgNode> & Pick<OrgNode, "_id" | "kind" | "name">): OrgNode =>
  ({ color: "#888", engine: "claude", model: "opus", phase: "idle", liveRuns: 0, runs: 0, tokens: 0, costUsd: 0, ...fields });

describe("org tree", () => {
  it("puts heads on top, Chiefs before their agents, and busy projects and agents first", () => {
    const org = groupOrg({
      truncated: false,
      projects: [{ _id: "p1", name: "Alpha", accent: "#f00" }, { _id: "p2", name: "Beta", accent: "#0f0" }],
      agents: [
        node({ _id: "h", kind: "head", name: "Boss" }),
        node({ _id: "a1", kind: "agent", name: "Zed", projectId: "p1" }),
        node({ _id: "c1", kind: "chief", name: "Ada", projectId: "p1" }),
        node({ _id: "a2", kind: "agent", name: "Yan", projectId: "p2", phase: "working" }),
        node({ _id: "a3", kind: "agent", name: "Bea", projectId: "p2", phase: "waiting_approval" }),
        node({ _id: "w", kind: "agent", name: "Scout" }),
        node({ _id: "x", kind: "chief", name: "Hidden", projectId: "p9" }),
      ],
    });
    expect(org.heads.map((n) => n.name)).toEqual(["Boss"]);
    expect(org.unplaced.map((n) => n.name)).toEqual(["Scout"]);
    expect(org.projects.map((group) => group.project.name)).toEqual(["Beta", "Alpha"]);
    expect(org.projects[0]!.agents.map((n) => n.name)).toEqual(["Bea", "Yan"]);
    expect(org.projects[1]!.chiefs.map((n) => n.name)).toEqual(["Ada"]);
  });

  it("writes token counts short", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_340)).toBe("12.3k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});
