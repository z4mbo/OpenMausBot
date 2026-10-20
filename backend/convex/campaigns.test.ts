/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Campaigns" });
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Launch" });
  return { t, sessionToken, projectId, user };
}

describe("campaigns", () => {
  test("a new campaign gets a unique utm slug and starts in planning", async () => {
    const f = await fixture();
    const first = await f.t.mutation(api.campaigns.create, { sessionToken: f.sessionToken, projectId: f.projectId, name: "Spring Launch!", channels: ["x", "bluesky"] });
    const second = await f.t.mutation(api.campaigns.create, { sessionToken: f.sessionToken, projectId: f.projectId, name: "Spring launch" });
    const { campaigns } = await f.t.query(api.campaigns.list, { sessionToken: f.sessionToken, projectId: f.projectId });
    const byId = new Map(campaigns.map((campaign) => [campaign._id, campaign]));
    expect(byId.get(first)).toMatchObject({ slug: "spring-launch", status: "planning", channels: ["x", "bluesky"] });
    expect(byId.get(second)?.slug).toBe("spring-launch-2");
  });

  test("links only items of the same project and unlinks them", async () => {
    const f = await fixture();
    const campaignId = await f.t.mutation(api.campaigns.create, { sessionToken: f.sessionToken, projectId: f.projectId, name: "Launch" });
    const postId = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, variants: [{ channel: "x", text: "We are live" }], assetIds: [] });
    await f.t.mutation(api.campaigns.link, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId, kind: "post", itemId: postId });
    await f.t.mutation(api.campaigns.link, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId, kind: "post", itemId: postId });
    let detail = await f.t.query(api.campaigns.get, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId });
    expect(detail?.posts.map((post) => post._id)).toEqual([postId]);
    expect(detail?.posts[0]?.excerpt).toBe("We are live");

    const { teamId } = await f.t.mutation(api.workspaces.create, { sessionToken: f.sessionToken, name: "Other" });
    const otherProject = await f.t.mutation(api.projects.create, { sessionToken: f.sessionToken, teamId, name: "Elsewhere" });
    const foreign = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: otherProject, variants: [{ channel: "x", text: "No" }], assetIds: [] });
    await expect(f.t.mutation(api.campaigns.link, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId, kind: "post", itemId: foreign })).rejects.toThrow(/No such post/);

    await f.t.mutation(api.campaigns.link, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId, kind: "post", itemId: postId, remove: true });
    detail = await f.t.query(api.campaigns.get, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId });
    expect(detail?.posts).toEqual([]);
  });

  test("attributes leads by capture source and by the page's utm_campaign", async () => {
    const f = await fixture();
    const campaignId = await f.t.mutation(api.campaigns.create, { sessionToken: f.sessionToken, projectId: f.projectId, name: "Black Friday" });
    await f.t.mutation(api.pipeline.configure, { sessionToken: f.sessionToken, projectId: f.projectId, captureEnabled: true });
    const token = await f.t.run(async (ctx) => (await ctx.db.query("pipelineSettings").first())!.captureToken);
    await f.t.mutation(internal.pipeline.capture, { token, name: "Ada", email: "ada@test.dev", source: "black-friday" });
    await f.t.mutation(internal.pipeline.capture, { token, name: "Bob", email: "bob@test.dev", page: "https://site.test/?utm_source=x&utm_campaign=Black-Friday" });
    await f.t.mutation(internal.pipeline.capture, { token, name: "Cy", email: "cy@test.dev", page: "https://site.test/?utm_campaign=other" });
    const detail = await f.t.query(api.campaigns.get, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId });
    expect(detail?.leads.map((lead) => lead.name).sort()).toEqual(["Ada", "Bob"]);
    expect(detail?.stages.find((row) => row.stage === "New")?.count).toBe(2);
    expect(detail?.counts.leads).toBe(2);
  });

  test("viewers cannot change a campaign, and dates must be in order", async () => {
    const f = await fixture();
    const campaignId = await f.t.mutation(api.campaigns.create, { sessionToken: f.sessionToken, projectId: f.projectId, name: "Launch", startDate: "2026-11-10" });
    await expect(f.t.mutation(api.campaigns.update, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId, endDate: "2026-11-01" })).rejects.toThrow(/before the start/);
    await f.t.mutation(api.campaigns.update, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId, endDate: "2026-11-30", status: "running" });
    const outsider = await f.user("outsider@test.dev");
    await expect(f.t.mutation(api.campaigns.update, { sessionToken: outsider, projectId: f.projectId, campaignId, status: "done" })).rejects.toThrow();
    const { campaigns } = await f.t.query(api.campaigns.list, { sessionToken: f.sessionToken, projectId: f.projectId });
    expect(campaigns[0]).toMatchObject({ status: "running", startDate: "2026-11-10", endDate: "2026-11-30" });
  });

  test("metrics are kept only for linked posts and replace the previous reading", async () => {
    const f = await fixture();
    const campaignId = await f.t.mutation(api.campaigns.create, { sessionToken: f.sessionToken, projectId: f.projectId, name: "Launch" });
    const postId = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, variants: [{ channel: "bluesky", text: "Hi" }], assetIds: [] });
    const stray = await f.t.mutation(api.broadcast.save, { sessionToken: f.sessionToken, projectId: f.projectId, variants: [{ channel: "x", text: "Hi" }], assetIds: [] });
    await f.t.mutation(api.campaigns.link, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId, kind: "post", itemId: postId });
    const reading = (likes: number) => ({ postId, channel: "bluesky" as const, likes, reposts: 1, replies: 0, at: 1 });
    await f.t.mutation(api.campaigns.recordMetrics, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId, metrics: [reading(3), { ...reading(9), postId: stray }] });
    await f.t.mutation(api.campaigns.recordMetrics, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId, metrics: [reading(5)] });
    const detail = await f.t.query(api.campaigns.get, { sessionToken: f.sessionToken, projectId: f.projectId, campaignId });
    expect(detail?.metrics).toEqual([reading(5)]);
  });
});
