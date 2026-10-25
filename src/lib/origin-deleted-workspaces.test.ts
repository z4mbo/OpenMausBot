// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { deletedNoticeText, localCopyOf, removeDeletedWorkspaces, takeUnnoticed, type DeletedWorkspace } from "./origin-deleted-workspaces";

const bots = [
  { id: "studio", name: "Studio", chiefOfStaff: true, section: "Workspace: Studio", managedSections: ["Walkies", "Agents"] },
  { id: "shop", name: "Shop", chiefOfStaff: true, section: "Workspace: Shop", managedSections: ["Bakery"] },
  { id: "walkies", name: "Walkies", chiefOfStaff: true, section: "Walkies" },
  { id: "nova", name: "Nova", section: "Walkies" },
  { id: "bea", name: "Bea", section: "Bakery" },
  { id: "sync", name: "Sync", section: "Agents", shared: { teamId: "team-studio" } },
  { id: "scout", name: "Scout", section: "Agents" },
];
const groups = [{ id: "standup", name: "Standup", section: "Walkies" }];
const links = { studio: "team-studio", shop: "team-shop" };
const studio: DeletedWorkspace = { teamId: "team-studio", name: "Studio", deletedBy: "Ada", byYou: false, deletedAt: 1 };

const recorder = (fail?: (path: string) => Error | undefined) => {
  const calls: string[] = [];
  return { calls, call: async (path: string, init: { method: string }) => {
    calls.push(`${init.method} ${path}`);
    const error = fail?.(path);
    if (error) throw error;
  } };
};

beforeEach(() => { localStorage.clear(); });

describe("this computer's copy of a deleted workspace", () => {
  it("is everything under its linked head, including standalone agents shared through it", () => {
    const copy = localCopyOf("team-studio", links, bots, groups)!;
    expect(copy.headId).toBe("studio");
    expect(copy.bots.map((bot) => bot.id)).toEqual(["nova", "sync", "walkies"]);
    expect(copy.groups.map((group) => group.id)).toEqual(["standup"]);
  });

  it("is the agents shared through it when its head is already gone, and nothing when neither is here", () => {
    expect(localCopyOf("team-studio", { shop: "team-shop" }, bots, groups)).toEqual({ headId: null, bots: [bots[5]], groups: [], teams: [] });
    expect(localCopyOf("team-other", links, bots, groups)).toBeNull();
  });

  it("ignores a link whose bot no longer heads a workspace", () => {
    expect(localCopyOf("team-studio", { nova: "team-studio" }, bots, groups)?.headId).toBeNull();
  });
});

describe("removing deleted workspaces from this computer", () => {
  it("removes chats, agents, Chiefs and teams through the usual routes, head last, and leaves other workspaces", async () => {
    const { calls, call } = recorder();
    const outcome = await removeDeletedWorkspaces({ deleted: [studio], listed: new Set(["team-shop"]), workspaceLinks: links, bots, groups, call });
    expect(calls).toEqual([
      "DELETE /api/groups/standup", "DELETE /api/bots/nova", "DELETE /api/bots/sync", "DELETE /api/bots/walkies",
      "DELETE /api/sidebar-sections?section=Walkies", "DELETE /api/bots/studio",
    ]);
    expect(outcome.found).toEqual([studio]);
    expect([...outcome.removedBotIds].sort()).toEqual(["nova", "studio", "sync", "walkies"]);
    expect(outcome.failures).toEqual([]);
  });

  it("never touches a workspace the account still lists, or one it was merely removed from", async () => {
    const { calls, call } = recorder();
    const listed = await removeDeletedWorkspaces({ deleted: [studio], listed: new Set(["team-studio"]), workspaceLinks: links, bots, groups, call });
    const removed = await removeDeletedWorkspaces({ deleted: [], listed: new Set(["team-shop"]), workspaceLinks: links, bots, groups, call });
    expect(calls).toEqual([]);
    expect([listed.found, removed.found]).toEqual([[], []]);
  });

  it("keeps the head when an agent cannot go yet, and the next round finishes, skipping what is gone", async () => {
    const gone = new Set<string>();
    let busy = true;
    const { calls, call } = recorder((path) => {
      if (gone.has(path)) return Object.assign(new Error("no such bot"), { status: 404 });
      if (busy && path === "/api/bots/walkies") return Object.assign(new Error("Stop this bot's work first"), { status: 409 });
      gone.add(path);
      return undefined;
    });
    const first = await removeDeletedWorkspaces({ deleted: [studio], listed: new Set(), workspaceLinks: links, bots, groups, call });
    expect(first.failures).toEqual([{ workspace: studio, error: expect.stringContaining("Walkies: Stop this bot's work first") }]);
    expect(calls).not.toContain("DELETE /api/bots/studio");
    busy = false;
    calls.length = 0;
    const second = await removeDeletedWorkspaces({ deleted: [studio], listed: new Set(), workspaceLinks: links, bots, groups, call });
    expect(second.failures).toEqual([]);
    expect(calls.at(-1)).toBe("DELETE /api/bots/studio");
    expect(gone.has("/api/bots/studio")).toBe(true);
  });
});

describe("telling the person", () => {
  it("reports each deleted workspace once, and forgets the ones Origin stops reporting", () => {
    const shop = { ...studio, teamId: "team-shop", name: "Shop" };
    expect(takeUnnoticed([studio], [studio, shop])).toEqual([studio]);
    expect(takeUnnoticed([studio, shop], [studio, shop])).toEqual([shop]);
    expect(takeUnnoticed([], [shop])).toEqual([]);
    expect(takeUnnoticed([studio], [studio])).toEqual([studio]);
  });

  it("names who deleted it, and says when part of the copy is still here", () => {
    expect(deletedNoticeText(studio, true)).toBe("Studio was deleted by Ada. Its agents, chats and teams on this computer were removed too.");
    expect(deletedNoticeText({ ...studio, byYou: true }, false)).toMatch(/^Studio was deleted by you\. Some of its agents/);
  });
});
