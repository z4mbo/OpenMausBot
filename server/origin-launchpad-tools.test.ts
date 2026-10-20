import { describe, expect, it } from "vitest";
import type { OriginCloudClient } from "./origin-cloud.ts";
import { launchpadTools, type LaunchpadToolScope } from "./origin-launchpad-tools.ts";

type Row = Record<string, unknown>;

function harness() {
  const milestones: Row[] = [{ _id: "m1", title: "MVP", description: "", targetDate: "2026-11-10", status: "planned", done: 1, total: 2 }];
  const tasks: Row[] = [
    { _id: "task0001", title: "Sign-up", done: true, milestoneId: "m1" },
    { _id: "task0002", title: "Billing", done: false, milestoneId: "m1" },
    { _id: "task00ab", title: "Landing page", done: false },
  ];
  const mutations: { name: string; args: Row }[] = [];
  const client: OriginCloudClient = {
    query: async (name) => {
      if (name === "projectMilestones:list") return { canEdit: true, milestones };
      if (name === "tasks:board") return { columns: [], tasks, assignees: [] };
      throw new Error(`unexpected ${name}`);
    },
    mutation: async (name, args) => {
      mutations.push({ name, args });
      if (name === "projectMilestones:save") {
        if (args.milestoneId) return args.milestoneId;
        milestones.push({ _id: "m2", title: args.title, description: "", targetDate: args.targetDate ?? "", status: "planned", done: 0, total: 0 });
        return "m2";
      }
      return null;
    },
  };
  const scope: LaunchpadToolScope = { client, sessionToken: "t", projectId: "proj", projectName: "Idea", caller: { id: "bot-1", name: "Atlas" } };
  return { tools: launchpadTools(async () => scope), mutations };
}

describe("milestone tools", () => {
  it("creates a milestone by a new name and puts issues in it by id or ORI key", async () => {
    const { tools, mutations } = harness();
    const result = await tools.origin_milestone_set({ milestone: "Launch", target_date: "2026-12-01", issues: ["ORI-00AB", "nope"] }, null);
    expect(mutations[0]).toEqual({ name: "projectMilestones:save", args: { sessionToken: "t", projectId: "proj", title: "Launch", targetDate: "2026-12-01" } });
    expect(mutations[1]).toEqual({ name: "projectMilestones:assign", args: { sessionToken: "t", projectId: "proj", milestoneId: "m2", taskIds: ["task00ab"] } });
    expect(result.text).toContain("Created milestone");
    expect(result.text).toContain("no issue nope");
  });

  it("lists milestones with progress and their issues, and takes an issue out", async () => {
    const { tools, mutations } = harness();
    const listed = await tools.origin_milestone_list({}, null);
    expect(listed.text).toContain('"MVP" [planned] target 2026-11-10 · 1/2 issues done (50%)');
    expect(listed.text).toContain("task0002 (ORI-0002) [open] Billing");
    expect(listed.text).toContain("1 open issue(s) are in no milestone.");
    await tools.origin_milestone_set({ milestone: "mvp", remove_issues: ["task0002", "task00ab"] }, null);
    expect(mutations.at(-1)).toEqual({ name: "projectMilestones:assign", args: { sessionToken: "t", projectId: "proj", milestoneId: null, taskIds: ["task0002"] } });
  });
});
