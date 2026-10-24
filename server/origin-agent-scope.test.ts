import { afterEach, describe, expect, it } from "vitest";
import { ORIGIN_SERVER_TOOL_NAMES, runOriginTool, type OriginCloudClient, type OriginToolDeps } from "./origin-cloud.ts";
import { cloudProjectFor, projectPeerTeams, reachableCloudProjects } from "./origin-project-links.ts";
import { canReachPeer, coordinatorSupervises, setPeerProjectTeams } from "./peer-roster.ts";

const bots = [
  { id: "head", name: "Head", section: "Workspace: One", chiefOfStaff: true, managedSections: ["Alpha", "Beta"] },
  { id: "alpha", name: "Alpha Chief", section: "Alpha", chiefOfStaff: true, managedSections: ["Beta", "Other"] },
  { id: "worker", name: "Alpha Worker", section: "Alpha" },
  { id: "beta", name: "Beta Chief", section: "Beta", chiefOfStaff: true },
  { id: "other", name: "Other Chief", section: "Other", chiefOfStaff: true },
  { id: "hidden", name: "Hidden Chief", section: "Hidden", chiefOfStaff: true, hidden: true },
];
const projects = { alpha: "p1", beta: "p2", other: "p3", hidden: "p4", head: "forged" };
type Args = Record<string, unknown>;
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((close) => close()));

function fixture() {
  const calls: { name: string; args: Args; mutation: boolean }[] = [];
  const query = async (name: string, args: Args): Promise<unknown> => {
    calls.push({ name, args, mutation: false });
    if (name === "projects:get") return { name: args.projectId, teamId: "team", memberRole: "owner" };
    if (name === "tasks:board") return { columns: [{ _id: "draft", title: "Draft" }], tasks: [{ _id: `${String(args.projectId)}task`, title: "Own task", columnId: "draft" }] };
    if (name === "tasks:details") {
      if (args.taskId !== `${String(args.projectId)}task`) throw new Error("Task not found");
      return { task: { _id: args.taskId, title: "Own task" }, columns: [], comments: [], assets: [] };
    }
    if (name === "issueRelations:list") return { labels: [], relations: [
      { taskId: "own", projectId: "p1", title: "Alpha relation", kind: "blocks", outgoing: true },
      { taskId: "foreign", projectId: "p2", title: "Beta private title", kind: "blocks", outgoing: true },
      { taskId: "outside", projectId: "p3", title: "Other private title", kind: "blocks", outgoing: true },
    ] };
    return [];
  };
  const client: OriginCloudClient = { query, mutation: async (name, args) => { calls.push({ name, args, mutation: true }); return "saved"; } };
  const deps: OriginToolDeps = { bots, state: { url: "http://scope.invalid", sessionToken: "synthetic", projects }, connect: () => client };
  return { calls, deps, run: (name: string, args: Args, botId = "alpha") => runOriginTool(name, args, botId, deps) };
}

describe("Origin project authority", () => {
  it("ignores a project Chief's managed grants and a workspace head's direct link", () => {
    expect(reachableCloudProjects(bots, projects, "alpha").map((p) => p.projectId)).toEqual(["p1"]);
    expect(reachableCloudProjects(bots, projects, "head").map((p) => p.projectId)).toEqual(["p1", "p2"]);
    expect(cloudProjectFor(bots, projects, "head")).toBeNull();
    expect(cloudProjectFor(bots, projects, "hidden")).toBeNull();
    expect(cloudProjectFor([...bots, { id: "orphan", name: "Orphan", section: "Hidden" }], projects, "orphan")).toBeNull();
  });

  it("narrows peer coordination without widening workspace, peer or audience grants", () => {
    cleanups.push(setPeerProjectTeams((id) => projectPeerTeams(bots, projects, id)));
    expect(canReachPeer(bots[1]!, bots[2]!)).toBe(true);
    expect(canReachPeer(bots[1]!, bots[3]!)).toBe(false);
    expect(coordinatorSupervises(bots[1]!, bots[3]!)).toBe(false);
    expect(canReachPeer(bots[0]!, bots[1]!)).toBe(true);
    expect(canReachPeer(bots[0]!, bots[3]!)).toBe(true);
    expect(canReachPeer(bots[0]!, bots[4]!)).toBe(false);
    expect(canReachPeer({ ...bots[0]!, peers: [] }, bots[1]!)).toBe(false);
    expect(canReachPeer(bots[0]!, { ...bots[1]!, visibility: "admins" })).toBe(false);
  });

  it("does not let explicit links in a shared section cross project boundaries", () => {
    const fleet = [...bots, { id: "split", name: "Split", section: "Alpha" }];
    cleanups.push(setPeerProjectTeams((id) => projectPeerTeams(fleet, { ...projects, split: "p2" }, id)));
    expect(canReachPeer(fleet[1]!, fleet[6]!)).toBe(false);
  });

  it.each([...ORIGIN_SERVER_TOOL_NAMES])("%s cannot select a foreign project", async (name) => {
    const { run, calls } = fixture();
    const result = await run(name, { project: "p2", issue_id: "p2task", title: "Draft", text: "Hello", summary: "Done", name: "Asset", url: "https://example.test/asset", bot_id: "beta" });
    expect(calls.some((call) => call.args.projectId === "p2" || call.args.taskId === "p2task"), name).toBe(false);
    expect(calls.some((call) => call.mutation), name).toBe(false);
    if (name !== "origin_list_projects") expect(result.isError, name).toBe(true);
    expect(result.text).not.toContain("Beta Chief");
  });

  it.each(["origin_get_issue", "origin_update_issue", "origin_delete_issue", "origin_comment_issue", "origin_assign_issue", "origin_complete_issue"])("%s cannot bypass project picking with a bare issue id", async (name) => {
    const { run, calls } = fixture();
    expect((await run(name, { issue_id: "p2task", title: "Changed", text: "Comment", summary: "Done", bot_id: "worker" })).isError).toBe(true);
    expect(calls.filter((call) => call.mutation)).toEqual([]);
    expect(calls.every((call) => !call.args.projectId || call.args.projectId === "p1")).toBe(true);
  });

  it("filters related issues by project authority while allowing a workspace head's managed projects", async () => {
    const { run } = fixture();
    const own = await run("origin_get_issue", { issue_id: "p1task" });
    expect(own.text).toContain("Alpha relation");
    expect(own.text).not.toContain("Beta private title");
    const head = await run("origin_get_issue", { issue_id: "p1task", project: "p1" }, "head");
    expect(head.text).toContain("Beta private title");
    expect(head.text).not.toContain("Other private title");
  });

  it("does not disclose a foreign agent's name through assignment or a shared section roster", async () => {
    const { run, deps } = fixture();
    const refused = await run("origin_assign_issue", { issue_id: "p1task", bot_id: "beta" });
    expect(refused.isError).toBe(true);
    expect(refused.text).not.toContain("Beta Chief");
    const roster = await runOriginTool("origin_list_projects", {}, "alpha", { ...deps, bots: [...bots, { id: "foreign", name: "Private Bot Name", section: "Alpha" }], state: { ...deps.state, projects: { ...projects, foreign: "p2" } } });
    expect(roster.text).not.toContain("Private Bot Name");
  });

  it("deletes only resolved issues and lets the workspace head select another managed project", async () => {
    const { run, calls } = fixture();
    expect((await run("origin_delete_issue", { issue_id: "p1task" })).isError).toBeUndefined();
    expect((await run("origin_delete_issue", { issue_id: "p2task", project: "p2" }, "head")).isError).toBeUndefined();
    expect(calls.filter((call) => call.mutation).map((call) => [call.name, call.args.projectId, call.args.taskId])).toEqual([["tasks:deleteTask", "p1", "p1task"], ["tasks:deleteTask", "p2", "p2task"]]);
  });

  it("stores encrypted Vault payloads without granting agent use, and refuses plaintext", async () => {
    const { deps, calls } = fixture();
    const payload: Args = { ciphertext: Buffer.alloc(32, 1).toString("base64"), iv: Buffer.alloc(12, 2).toString("base64"), salt: Buffer.alloc(16, 3).toString("base64"), iterations: 210_000, kdf: "PBKDF2-SHA256/AES-256-GCM" };
    const file = async () => ({ data: Buffer.from(JSON.stringify(payload)), name: "key.json", contentType: "application/json" });
    const result = await runOriginTool("origin_vault_store", { title: "Service API", path: "key.json" }, "alpha", { ...deps, file });
    expect(result.isError).toBeUndefined();
    expect(calls.find((call) => call.mutation)).toEqual({ name: "credentials:create", mutation: true, args: { projectId: "p1", sessionToken: "synthetic", kind: "api_key", title: "Service API", ...payload } });
    calls.length = 0;
    payload.value = "never-store-plaintext";
    expect((await runOriginTool("origin_vault_store", { title: "Service API", path: "key.json" }, "alpha", { ...deps, file })).isError).toBe(true);
    expect(calls.filter((call) => call.mutation)).toEqual([]);
  });
});
