import { describe, expect, it } from "vitest";
import type { OriginCloudClient } from "../origin-cloud.ts";
import { broadcastDraft, broadcastList, broadcastSchedule, type BroadcastToolScope } from "./tools.ts";

function scope(posts: Record<string, unknown>[] = []) {
  const mutations: { name: string; args: Record<string, unknown> }[] = [];
  const client: OriginCloudClient = {
    query: async (name) => name === "broadcast:list" ? { posts } : { assets: [{ _id: "a1", name: "Launch clip", type: "other", contentType: "video/mp4" }, { _id: "a2", name: "Cover", type: "image", contentType: "image/png" }] },
    mutation: async (name, args) => {
      mutations.push({ name, args });
      return name === "broadcast:save" ? "post1" : name === "broadcast:schedule" ? Date.UTC(2026, 10, 2, 9, 30) : null;
    },
  };
  const value: BroadcastToolScope = { client, sessionToken: "t", projectId: "proj", projectName: "Launch", caller: { id: "bot-1", name: "Marketer" } };
  return { value, mutations };
}

describe("origin_broadcast_draft", () => {
  it("saves a new draft as the agent, resolving media by asset name, and flags channel problems", async () => {
    const { value, mutations } = scope();
    const result = await broadcastDraft({ channels: ["tiktok", "x"], text: "New release", texts: { x: "New release, link in bio" }, media: ["launch clip"] }, value);
    expect(mutations[0]).toEqual({ name: "broadcast:save", args: {
      sessionToken: "t", projectId: "proj", assetIds: ["a1"], agent: { botId: "bot-1", name: "Marketer" },
      variants: [{ channel: "tiktok", text: "New release" }, { channel: "x", text: "New release, link in bio" }],
    } });
    expect(result.text).toContain("Drafted Publish post post1");
    expect(result.text).toContain("x: 24/280");
    expect(result.text).toContain("approves it");
  });

  it("keeps an existing post's channels, text and media when only part changes", async () => {
    const { value, mutations } = scope([{ _id: "post1", variants: [{ channel: "x", text: "Old" }, { channel: "bluesky", text: "Old" }], media: [{ assetId: "a2", kind: "image" }] }]);
    await broadcastDraft({ post_id: "post1", texts: { bluesky: "New" } }, value);
    expect(mutations[0].args).toMatchObject({ postId: "post1", assetIds: ["a2"], variants: [{ channel: "x", text: "Old" }, { channel: "bluesky", text: "New" }] });
  });

  it("refuses an unknown asset or channel", async () => {
    expect((await broadcastDraft({ channels: ["x"], text: "a", media: ["missing"] }, scope().value)).isError).toBe(true);
    expect((await broadcastDraft({ channels: ["myspace"], text: "a" }, scope().value)).text).toContain("channels must be among");
  });
});

describe("origin_broadcast_schedule", () => {
  it("says a person must approve an agent's post first", async () => {
    const { value, mutations } = scope([{ _id: "post1", needsApproval: true, variants: [] }]);
    const result = await broadcastSchedule({ post_id: "post1" }, value);
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain("needs a person's approval");
    expect(mutations).toEqual([]);
  });

  it("schedules an approved post at the given time", async () => {
    const { value, mutations } = scope([{ _id: "post1", needsApproval: false, variants: [] }]);
    const result = await broadcastSchedule({ post_id: "post1", at: "2026-11-02T10:30:00+01:00" }, value);
    expect(mutations[0].args).toEqual({ sessionToken: "t", postId: "post1", at: Date.UTC(2026, 10, 2, 9, 30) });
    expect(result.text).toContain("2026-11-02 09:30 UTC");
  });
});

describe("origin_broadcast_list", () => {
  it("lists posts with status, approval, links and errors", async () => {
    const { value } = scope([{ _id: "p1", status: "failed", agentName: "Marketer", needsApproval: false, variants: [{ channel: "x", text: "Hello", url: "https://x.com/i/web/status/1" }, { channel: "tiktok", text: "Hello", error: "token expired" }], media: [] }]);
    const { text } = await broadcastList({}, value);
    expect(text).toContain("- p1 [failed, approved] x https://x.com/i/web/status/1; tiktok (failed: token expired) · by Marketer");
  });
});

describe("Broadcast cards", () => {
  it("shows a drafted post on a card waiting for approval, and a list as one card", async () => {
    const post = { _id: "post1", status: "draft", agentName: "Marketer", needsApproval: true, variants: [{ channel: "x", text: "Launch" }], media: [{ name: "Cover", kind: "image", url: "https://cdn.test/c.png" }] };
    const drafted = await broadcastDraft({ channels: ["x"], text: "Launch" }, scope([post]).value);
    expect(drafted.card).toEqual({
      kind: "broadcast", projectId: "proj", projectName: "Launch", heading: "New post",
      posts: [{ id: "post1", status: "draft", needsApproval: true, agentName: "Marketer", channels: [{ channel: "x", text: "Launch" }], media: [{ name: "Cover", kind: "image", url: "https://cdn.test/c.png" }] }],
    });
    const many = Array.from({ length: 10 }, (_, index) => ({ ...post, _id: `p${index}` }));
    const listed = await broadcastList({}, scope(many).value);
    expect(listed.card).toMatchObject({ kind: "broadcast", heading: "10 posts", more: 2 });
    expect(listed.card?.kind === "broadcast" && listed.card.posts).toHaveLength(8);
  });
});
