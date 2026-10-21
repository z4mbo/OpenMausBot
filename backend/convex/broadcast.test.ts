/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const user = async (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const sessionToken = await user("owner@test.dev");
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Broadcast" });
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Launch" });
  const asset = (name: string, contentType: string) => t.run((ctx) => ctx.db.insert("designAssets", { projectId, type: "image", name, url: `https://cdn.test/${name}`, contentType, createdAt: 1, updatedAt: 1 }));
  return { t, sessionToken, projectId, asset, user };
}

describe("broadcast posts", () => {
  test("an agent's draft cannot be scheduled until a person approves it", async () => {
    const f = await fixture();
    const postId = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, variants: [{ channel: "x", text: "Launch day" }], assetIds: [], agent: { botId: "bot-1", name: "Marketer" } });
    await expect(f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId })).rejects.toThrow(/approve/);
    await f.t.mutation(api.broadcast.approve, { sessionToken: f.sessionToken, postId });
    await f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId });
    const { posts } = await f.t.query(api.broadcast.list, { sessionToken: f.sessionToken, projectId: f.projectId });
    expect(posts[0]).toMatchObject({ status: "scheduled", needsApproval: false });
  });

  test("an agent's edit clears the approval and unschedules the post", async () => {
    const f = await fixture();
    const postId = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, variants: [{ channel: "x", text: "One" }], assetIds: [], agent: { botId: "bot-1", name: "Marketer" } });
    await f.t.mutation(api.broadcast.approve, { sessionToken: f.sessionToken, postId });
    await f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId, at: Date.now() + 3_600_000 });
    await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, postId, variants: [{ channel: "x", text: "Two" }], assetIds: [], agent: { botId: "bot-1", name: "Marketer" } });
    const { posts } = await f.t.query(api.broadcast.list, { sessionToken: f.sessionToken, projectId: f.projectId });
    expect(posts[0]).toMatchObject({ status: "draft", needsApproval: true });
    expect(posts[0].scheduledAt).toBeUndefined();
  });

  test("scheduling refuses text and media a channel would reject", async () => {
    const f = await fixture();
    const long = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, variants: [{ channel: "x", text: "a".repeat(281) }], assetIds: [] });
    await expect(f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId: long })).rejects.toThrow(/280 characters/);
    const image = await f.asset("cover.png", "image/png");
    const tiktok = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, variants: [{ channel: "tiktok", text: "Clip" }], assetIds: [image] });
    await expect(f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId: tiktok })).rejects.toThrow(/exactly one video/);
  });

  test("due posts are claimed once by their publisher and finish with per-channel results", async () => {
    const f = await fixture();
    const image = await f.asset("cover.png", "image/png");
    const postId = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, variants: [{ channel: "bluesky", text: "Hi" }, { channel: "x", text: "Hi" }], assetIds: [image] });
    await f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId });
    const other = await f.user("other@test.dev");
    expect(await f.t.mutation(api.broadcast.claimDue, { sessionToken: other })).toEqual([]);
    const claimed = await f.t.mutation(api.broadcast.claimDue, { sessionToken: f.sessionToken });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].media[0]).toMatchObject({ url: "https://cdn.test/cover.png", kind: "image" });
    expect(await f.t.mutation(api.broadcast.claimDue, { sessionToken: f.sessionToken })).toEqual([]);
    await f.t.mutation(api.broadcast.finish, { sessionToken: f.sessionToken, postId, results: [{ channel: "bluesky", ok: true, url: "https://bsky.app/profile/a/post/1" }, { channel: "x", ok: false, error: "401" }] });
    let { posts } = await f.t.query(api.broadcast.list, { sessionToken: f.sessionToken, projectId: f.projectId });
    expect(posts[0].status).toBe("failed");
    await f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId });
    const retry = await f.t.mutation(api.broadcast.claimDue, { sessionToken: f.sessionToken });
    expect(retry[0].variants.map((variant: { channel: string }) => variant.channel)).toEqual(["x"]);
    await f.t.mutation(api.broadcast.finish, { sessionToken: f.sessionToken, postId: postId as Id<"broadcastPosts">, results: [{ channel: "x", ok: true, url: "https://x.com/i/web/status/1" }] });
    ({ posts } = await f.t.query(api.broadcast.list, { sessionToken: f.sessionToken, projectId: f.projectId }));
    expect(posts[0].status).toBe("published");
    await expect(f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, postId, variants: [{ channel: "x", text: "edit" }], assetIds: [] })).rejects.toThrow(/already published/);
  });

  test("a reel needs one video on reel channels and carries its cover and account to the publisher", async () => {
    const f = await fixture();
    const video = await f.asset("reel.mp4", "video/mp4");
    const image = await f.asset("cover.png", "image/png");
    const bad = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, format: "reel", variants: [{ channel: "linkedin", text: "Reel" }], assetIds: [image] });
    await expect(f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId: bad })).rejects.toThrow(/LinkedIn does not take reels; A reel is exactly one video/);
    const postId = await f.t.mutation(api.broadcast.save, {
      sessionToken: f.sessionToken, projectId: f.projectId, format: "reel", reel: { coverMs: 2_480.4, music: "  Nightcall  " }, assetIds: [video],
      variants: [{ channel: "instagram", text: "Reel" }, { channel: "tiktok", text: "Reel", accountId: "acct-1", accountLabel: "Founder" }],
    });
    await f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId });
    const [claimed] = await f.t.mutation(api.broadcast.claimDue, { sessionToken: f.sessionToken });
    expect(claimed).toMatchObject({ format: "reel", reel: { coverMs: 2_480, music: "Nightcall" } });
    expect(claimed.variants).toEqual([{ channel: "instagram", text: "Reel" }, { channel: "tiktok", text: "Reel", accountId: "acct-1" }]);
    await f.t.mutation(api.broadcast.finish, { sessionToken: f.sessionToken, postId, results: [{ channel: "instagram", ok: true }, { channel: "tiktok", ok: false, error: "401" }] });
    const { posts } = await f.t.query(api.broadcast.list, { sessionToken: f.sessionToken, projectId: f.projectId });
    expect(posts.find((post) => post._id === postId)!.variants[1]).toMatchObject({ accountId: "acct-1", accountLabel: "Founder", result: "failed" });
  });

  test("a scheduled post moves to a later time and keeps its publisher", async () => {
    const f = await fixture();
    const postId = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, variants: [{ channel: "x", text: "Move me" }], assetIds: [] });
    await expect(f.t.mutation(api.broadcast.reschedule, { sessionToken: f.sessionToken, postId, at: Date.now() + 3_600_000 })).rejects.toThrow(/scheduled/);
    await f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId, at: Date.now() + 3_600_000 });
    await expect(f.t.mutation(api.broadcast.reschedule, { sessionToken: f.sessionToken, postId, at: Date.now() - 1 })).rejects.toThrow(/future/);
    const later = Date.now() + 2 * 86_400_000;
    await f.t.mutation(api.broadcast.reschedule, { sessionToken: f.sessionToken, postId, at: later });
    const { posts } = await f.t.query(api.broadcast.list, { sessionToken: f.sessionToken, projectId: f.projectId });
    expect(posts[0]).toMatchObject({ status: "scheduled", scheduledAt: later });
  });

  test("engagement is recorded only on this project's published channels", async () => {
    const f = await fixture();
    const postId = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, variants: [{ channel: "x", text: "Hi" }, { channel: "bluesky", text: "Hi" }], assetIds: [] });
    await f.t.mutation(api.broadcast.schedule, { sessionToken: f.sessionToken, postId });
    await f.t.mutation(api.broadcast.claimDue, { sessionToken: f.sessionToken });
    await f.t.mutation(api.broadcast.finish, { sessionToken: f.sessionToken, postId, results: [{ channel: "x", ok: true, url: "https://x.com/i/web/status/1" }, { channel: "bluesky", ok: false, error: "down" }] });
    const recorded = await f.t.mutation(api.broadcast.recordMetrics, {
      sessionToken: f.sessionToken, projectId: f.projectId,
      metrics: [{ postId, channel: "x", likes: 12.4, reposts: -3, replies: 2, impressions: 900 }, { postId, channel: "bluesky", likes: 1, reposts: 0, replies: 0 }],
    });
    expect(recorded).toBe(1);
    const { posts } = await f.t.query(api.broadcast.list, { sessionToken: f.sessionToken, projectId: f.projectId });
    expect(posts[0].variants[0].metrics).toMatchObject({ likes: 12, reposts: 0, replies: 2, impressions: 900 });
    expect(posts[0].variants[1].metrics).toBeUndefined();
  });
});
