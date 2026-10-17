import { describe, expect, it } from "vitest";
import { planImport, planIsEmpty, runImport } from "./origin-import";

const cloud = {
  workspaces: [{ _id: "ggs", name: "GGs" }, { _id: "weeh", name: "weeh" }],
  projects: [{ _id: "kai", teamId: "ggs", name: "Kai" }, { _id: "yuki", teamId: "ggs", name: "Yuki" }],
};
const LEAD = { title: "Project lead", description: "d", soul: "s" };

describe("planImport", () => {
  it("brings the workspace of a chosen project, reuses a linked head and skips linked projects", () => {
    const empty = planImport(cloud, { bots: [], links: { workspaces: {}, projects: {} } }, { workspaces: [], projects: ["kai", "yuki"] });
    expect(empty.workspaces).toEqual([{ cloudTeamId: "ggs", name: "GGs" }]);
    expect(empty.projects.map((step) => step.name)).toEqual(["Kai", "Yuki"]);

    const bots = [{ id: "h", name: "GGs", section: "Workspace: GGs", chiefOfStaff: true }, { id: "c", name: "Kai", section: "Kai", chiefOfStaff: true }];
    const linked = planImport(cloud, { bots, links: { workspaces: { h: "ggs" }, projects: { c: "kai" } } }, { workspaces: [], projects: ["kai", "yuki"] });
    expect(linked.workspaces).toEqual([{ cloudTeamId: "ggs", name: "GGs", headId: "h", headName: "GGs" }]);
    expect(linked.projects.map((step) => step.name)).toEqual(["Yuki"]);
    expect(linked.alreadyLinked).toEqual([{ cloudProjectId: "kai", name: "Kai", localName: "Kai" }]);
    expect(planIsEmpty(planImport(cloud, { bots, links: { workspaces: { h: "ggs" }, projects: {} } }, { workspaces: ["ggs"], projects: [] }))).toBe(true);
  });
});

describe("runImport", () => {
  it("creates the head, then each project with its team, linking each one", async () => {
    const calls: [string, string | undefined, unknown][] = [];
    let next = 0;
    const call = async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
      calls.push([path, init?.method, init?.body ? JSON.parse(init.body) : undefined]);
      if (path === "/api/workspaces" || path === "/api/bots") {
        const body = JSON.parse(init!.body!) as { name: string };
        return { bot: { id: `b${++next}`, name: body.name } } as T;
      }
      if (path.endsWith("/default-team")) return { members: [1, 2, 3, 4, 5, 6] } as T;
      return {} as T;
    };
    const plan = planImport(cloud, { bots: [], links: { workspaces: {}, projects: {} } }, { workspaces: [], projects: ["kai"] });
    const result = await runImport(plan, { call, lead: LEAD });
    expect(result).toEqual({
      createdWorkspaces: [{ name: "GGs", botId: "b1" }],
      createdProjects: [{ name: "Kai", botId: "b2", agents: 6, workspace: "GGs" }],
      failures: [],
    });
    expect(calls).toEqual([
      ["/api/workspaces", "POST", { name: "GGs" }],
      ["/api/origin/cloud-links", "PUT", { workspaces: { b1: "ggs" } }],
      ["/api/bots", "POST", { name: "Kai", ...LEAD }],
      ["/api/bots/b2/default-team", "POST", { workspaceId: "b1" }],
      ["/api/origin/cloud-links", "PUT", { projects: { b2: "kai" } }],
    ]);
  });
});
