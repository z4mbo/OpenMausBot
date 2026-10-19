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

  it("trusts the server's links while the local bot list has not loaded them yet", () => {
    const plan = planImport(cloud, { bots: [], links: { workspaces: { h: "ggs" }, projects: { c: "kai" } } }, { workspaces: [], projects: ["kai"] });
    expect(plan.workspaces).toEqual([{ cloudTeamId: "ggs", name: "GGs", headId: "h", headName: "GGs" }]);
    expect(plan.projects).toEqual([]);
    expect(planIsEmpty(plan)).toBe(true);
  });
});

describe("runImport", () => {
  it("does not leave another unlinked bot on every retry when the default team exceeds capacity", async () => {
    const local = [{ id: "head", name: "GGs", chiefOfStaff: true, section: "Workspace: GGs" }];
    const links = { workspaces: { head: "ggs" }, projects: {} };
    const call = async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
      if (path === "/api/bots") {
        const bot = { id: `orphan${local.length}`, name: JSON.parse(init!.body!).name, chiefOfStaff: false, section: "" };
        local.push(bot);
        return { bot } as T;
      }
      if (path.endsWith("/default-team") || path === "/api/origin/import/projects") throw new Error("this workspace is limited to 7 bots");
      throw new Error(`unexpected ${path}`);
    };
    for (let round = 0; round < 3; round++) {
      const plan = planImport(cloud, { bots: local, links }, { workspaces: [], projects: ["kai"] });
      expect((await runImport(plan, { call, lead: LEAD })).failures).toEqual([{ name: "Kai", error: "this workspace is limited to 7 bots" }]);
    }
    expect(local.map((bot) => bot.id)).toEqual(["head"]);
  });

  it("creates the head, then each project with its team, linking each one", async () => {
    const calls: [string, string | undefined, unknown][] = [];
    let next = 0;
    const call = async <T,>(path: string, init?: { method?: string; body?: string }): Promise<T> => {
      calls.push([path, init?.method, init?.body ? JSON.parse(init.body) : undefined]);
      if (path === "/api/origin/import/workspaces") return { bot: { id: `b${++next}`, name: "GGs" } } as T;
      if (path === "/api/origin/import/projects") return { bot: { id: `b${++next}`, name: "Kai" }, members: [1, 2, 3, 4, 5, 6] } as T;
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
      ["/api/origin/import/workspaces", "POST", { cloudTeamId: "ggs" }],
      ["/api/origin/import/projects", "POST", { cloudProjectId: "kai", cloudTeamId: "ggs", workspaceId: "b1", ...LEAD }],
    ]);
  });
});
