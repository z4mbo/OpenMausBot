import { describe, expect, it } from "vitest";
import { deleteLocalWorkspace, localWorkspaceContents } from "./origin-workspace-deletion";

const bots = [
  { id: "studio", name: "Studio", chiefOfStaff: true, section: "Workspace: Studio", managedSections: ["Walkies", "Agents", "Launch kit"] },
  { id: "shop", name: "Shop", chiefOfStaff: true, section: "Workspace: Shop", managedSections: ["Bakery"] },
  { id: "walkies", name: "Walkies", chiefOfStaff: true, section: "Walkies" },
  { id: "nova", name: "Nova", section: "Walkies" },
  { id: "kit", name: "Kit", section: "Launch kit" },
  { id: "bakery", name: "Bakery", chiefOfStaff: true, section: "Bakery" },
  { id: "bea", name: "Bea", section: "Bakery" },
  { id: "scout", name: "Scout", section: "Agents" },
  { id: "sync", name: "Sync", section: "Agents", shared: { teamId: "team-studio" } },
  { id: "elsewhere", name: "Elsewhere", section: "Agents", shared: { teamId: "team-shop" } },
];
const groups = [{ id: "standup", name: "Standup", section: "Walkies" }, { id: "bake-off", name: "Bake-off", section: "Bakery" }];

describe("what deleting a workspace removes from this computer", () => {
  it("takes its head's teams and the agents shared through it, and leaves other workspaces and standalone agents", () => {
    const contents = localWorkspaceContents("studio", bots, groups, "team-studio");
    expect(contents.bots.map((bot) => bot.id)).toEqual(["nova", "kit", "sync", "walkies"]);
    expect(contents.groups.map((group) => group.id)).toEqual(["standup"]);
    expect(contents.teams).toEqual(["Walkies", "Launch kit"]);
  });

  it("never takes a team another head also manages", () => {
    const shared = bots.map((bot) => bot.id === "shop" ? { ...bot, managedSections: ["Bakery", "Walkies"] } : bot);
    expect(localWorkspaceContents("studio", shared, groups).bots.map((bot) => bot.id)).toEqual(["kit"]);
  });
});

describe("deleting a workspace on this computer", () => {
  const contents = localWorkspaceContents("studio", bots, groups, "team-studio");

  it("deletes chats, agents, Chiefs and emptied teams before the cloud step and the head", async () => {
    const calls: string[] = [];
    await deleteLocalWorkspace(contents, async (path) => { calls.push(path); }, async () => { calls.push("origin"); });
    expect(calls).toEqual([
      "/api/groups/standup", "/api/bots/nova", "/api/bots/kit", "/api/bots/sync", "/api/bots/walkies",
      "/api/sidebar-sections?section=Walkies", "/api/sidebar-sections?section=Launch%20kit", "origin", "/api/bots/studio",
    ]);
  });

  it("keeps the head and skips the cloud step when an agent cannot go yet, and a retry skips what is already gone", async () => {
    const gone = new Set<string>();
    let busy = true;
    const calls: string[] = [];
    const call = async (path: string) => {
      calls.push(path);
      if (gone.has(path)) throw Object.assign(new Error("no such bot"), { status: 404 });
      if (busy && path === "/api/bots/kit") throw Object.assign(new Error("Stop this bot's work first"), { status: 409 });
      gone.add(path);
    };
    let origin = 0;
    await expect(deleteLocalWorkspace(contents, call, async () => { origin += 1; })).rejects.toThrow("Kit: Stop this bot's work first");
    expect(origin).toBe(0);
    expect(gone.has("/api/bots/studio")).toBe(false);
    busy = false;
    calls.length = 0;
    await deleteLocalWorkspace(contents, call, async () => { origin += 1; });
    expect(origin).toBe(1);
    expect(gone.has("/api/bots/studio")).toBe(true);
  });

  it("keeps the head when the cloud step fails, so the deletion can be retried from it", async () => {
    const calls: string[] = [];
    await expect(deleteLocalWorkspace(contents, async (path) => { calls.push(path); }, async () => { throw new Error("Admin role required"); })).rejects.toThrow("Admin role required");
    expect(calls).not.toContain("/api/bots/studio");
  });
});
