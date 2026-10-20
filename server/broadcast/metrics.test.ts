import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { json, readBody } from "../harness/http.ts";
import type { OriginCloudClient } from "../origin-cloud.ts";
import type { RequestAuth } from "../request-auth.ts";
import { dispatchRoutes } from "../routes/table.ts";
import type { PublishEnv } from "./channels.ts";
import { blueskyPostRef, createCampaignRoutes, MetricsError, refreshBroadcastMetrics, refreshCampaignMetrics, xTweetId, type CampaignMetricsDeps } from "./metrics.ts";

const keys = { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "a" };

function env(answers: Record<string, unknown>, seen: { url: string; auth?: string }[] = []): PublishEnv {
  return {
    fetch: async (input, init) => {
      const url = String(input);
      seen.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      const key = Object.keys(answers).find((prefix) => url.startsWith(prefix));
      return key ? Response.json(answers[key]) : new Response("{}", { status: 404 });
    },
    sleep: async () => undefined,
    nonce: () => "n",
    now: () => 1_000,
  };
}

function cloud(posts: unknown[]) {
  const queries: { name: string; args: Record<string, unknown> }[] = [];
  const mutations: { name: string; args: Record<string, unknown> }[] = [];
  const client: OriginCloudClient = {
    query: async (name, args) => { queries.push({ name, args }); return { _id: "c1", posts }; },
    mutation: async (name, args) => { mutations.push({ name, args }); return null; },
  };
  return { client, mutations, queries };
}

describe("post links", () => {
  it("reads X and Bluesky post ids from published links", () => {
    expect(xTweetId("https://x.com/i/web/status/1849")).toBe("1849");
    expect(xTweetId("https://twitter.com/origin/status/77?s=20")).toBe("77");
    expect(xTweetId("https://x.com/origin")).toBeNull();
    expect(blueskyPostRef("https://bsky.app/profile/origin.bsky.social/post/3kabc")).toEqual({ actor: "origin.bsky.social", rkey: "3kabc" });
  });
});

describe("refreshBroadcastMetrics", () => {
  const x = { channel: "x", result: "published", url: "https://x.com/i/web/status/42" };
  const bluesky = { channel: "bluesky", result: "published", url: "https://bsky.app/profile/did:plc:abc/post/abc" };
  const session = () => ({ url: "https://cloud.test", sessionToken: "s" });
  const answers = {
    "https://api.x.com/2/tweets": { data: [{ id: "42", public_metrics: { like_count: 5, retweet_count: 2, quote_count: 1, reply_count: 3, impression_count: 800 } }] },
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts": { posts: [{ uri: "at://did:plc:abc/app.bsky.feed.post/abc", likeCount: 7, repostCount: 1, quoteCount: 2, replyCount: 4 }] },
  };

  it("reads project posts and records only published X and Bluesky variants, without at", async () => {
    const { client, queries, mutations } = cloud([
      { _id: "p1", variants: [x, bluesky] },
      { _id: "p2", variants: [{ ...x, result: "failed" }, { ...bluesky, result: undefined }, { ...x, channel: "linkedin" }] },
    ]);
    const seen: { url: string; auth?: string }[] = [];
    expect(await refreshBroadcastMetrics({ session, connect: () => client, xKeys: () => keys, env: env(answers, seen) }, "proj")).toEqual({ read: 2, notes: [] });
    expect(queries).toEqual([{ name: "broadcast:list", args: { sessionToken: "s", projectId: "proj" } }]);
    expect(seen[0].auth).toMatch(/^OAuth /);
    expect(seen[1].auth).toBeUndefined();
    expect(mutations).toEqual([{ name: "broadcast:recordMetrics", args: { sessionToken: "s", projectId: "proj", metrics: [
      { postId: "p1", channel: "x", likes: 5, reposts: 3, replies: 3, impressions: 800 },
      { postId: "p1", channel: "bluesky", likes: 7, reposts: 3, replies: 4 },
    ] } }]);
  });

  it("reports missing X keys while still recording Bluesky", async () => {
    const { client, mutations } = cloud([{ _id: "p1", variants: [x, bluesky] }]);
    const seen: { url: string }[] = [];
    expect(await refreshBroadcastMetrics({ session, connect: () => client, xKeys: () => null, env: env(answers, seen) }, "proj")).toEqual({ read: 1, notes: ["Connect X in Settings to read its numbers."] });
    expect(seen.every((call) => call.url.startsWith("https://public.api.bsky.app/"))).toBe(true);
    expect(mutations[0].args.metrics).toHaveLength(1);
  });

  it("keeps successful metrics when another channel errors", async () => {
    const { client, mutations } = cloud([{ _id: "p1", variants: [x, bluesky] }]);
    const result = await refreshBroadcastMetrics({
      session, connect: () => client, xKeys: () => keys,
      env: env({ "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts": answers["https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts"] }),
    }, "proj");
    expect(result).toEqual({ read: 1, notes: ["X answered 404"] });
    expect(mutations[0].args.metrics).toEqual([{ postId: "p1", channel: "bluesky", likes: 7, reposts: 3, replies: 4 }]);
  });

  it("does not write or fetch without readable published URLs", async () => {
    const { client, mutations } = cloud([{ _id: "p1", variants: [{ ...x, url: "" }, { ...bluesky, result: "failed" }] }]);
    const seen: { url: string }[] = [];
    expect(await refreshBroadcastMetrics({ session, connect: () => client, xKeys: () => keys, env: env({}, seen) }, "proj")).toEqual({ read: 0, notes: [] });
    expect(mutations).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("batches metrics within the backend's limit", async () => {
    const { client, mutations } = cloud(Array.from({ length: 201 }, (_, index) => ({ _id: `p${index}`, variants: [x] })));
    expect(await refreshBroadcastMetrics({ session, connect: () => client, xKeys: () => keys, env: env(answers) }, "proj")).toEqual({ read: 201, notes: [] });
    expect(mutations.map((call) => (call.args.metrics as unknown[]).length)).toEqual([200, 1]);
  });

  it("requires an Origin session before connecting", async () => {
    await expect(refreshBroadcastMetrics({ session: () => ({}), connect: () => { throw new Error("Should not connect"); }, xKeys: () => null }, "proj")).rejects.toThrow(MetricsError);
  });
});

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });

async function serve(deps: CampaignMetricsDeps, admin = true) {
  const route = createCampaignRoutes(deps);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const auth: RequestAuth = { kind: "loopback", scopes: admin ? ["admin"] : ["client"] };
    if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/origin`;
}

describe("metrics routes", () => {
  const deps = (): CampaignMetricsDeps => ({ session: () => ({ url: "https://cloud.test", sessionToken: "s" }), connect: () => cloud([]).client, xKeys: () => null });

  it.each(["broadcast", "campaigns"])("requires admin scope for %s metrics", async (path) => {
    const url = await serve(deps(), false);
    const response = await fetch(`${url}/${path}/metrics`, { method: "POST", body: JSON.stringify({ projectId: "proj", campaignId: "c1" }) });
    expect(response.status).toBe(403);
  });

  it("requires projectId for Broadcast and campaignId for campaigns", async () => {
    const url = await serve(deps());
    for (const [path, body] of [["broadcast", {}], ["campaigns", { projectId: "proj" }]] as const) {
      const response = await fetch(`${url}/${path}/metrics`, { method: "POST", body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
    expect((await fetch(`${url}/broadcast/metrics`)).status).toBe(404);
  });

  it("returns a Broadcast refresh without requiring a campaignId", async () => {
    const { client, queries } = cloud([]);
    const url = await serve({ ...deps(), connect: () => client });
    const response = await fetch(`${url}/broadcast/metrics`, { method: "POST", body: JSON.stringify({ projectId: "proj" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ read: 0, notes: [] });
    expect(queries[0]).toEqual({ name: "broadcast:list", args: { sessionToken: "s", projectId: "proj" } });
  });

  it.each([[new MetricsError("Sign in first"), 409], [new Error("Backend unavailable"), 502]] as const)("maps refresh error %# to its HTTP status", async (error, status) => {
    const url = await serve({ ...deps(), connect: () => ({ query: async () => { throw error; }, mutation: async () => null }) });
    const response = await fetch(`${url}/broadcast/metrics`, { method: "POST", body: JSON.stringify({ projectId: "proj" }) });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: error.message });
  });
});

describe("refreshCampaignMetrics", () => {
  it("reads X with the member's keys and Bluesky publicly, and stores the numbers", async () => {
    const { client, mutations } = cloud([
      { _id: "p1", variants: [{ channel: "x", result: "published", url: "https://x.com/i/web/status/42" }, { channel: "bluesky", result: "published", url: "https://bsky.app/profile/origin.test/post/abc" }] },
      { _id: "p2", variants: [{ channel: "linkedin", result: "published", url: "https://www.linkedin.com/feed/update/1" }, { channel: "x", result: "failed" }] },
    ]);
    const seen: { url: string; auth?: string }[] = [];
    const result = await refreshCampaignMetrics({
      session: () => ({ url: "https://cloud.test", sessionToken: "s" }), connect: () => client, xKeys: () => keys,
      env: env({
        "https://api.x.com/2/tweets": { data: [{ id: "42", public_metrics: { like_count: 5, retweet_count: 2, quote_count: 1, reply_count: 3, impression_count: 800 } }] },
        "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle": { did: "did:plc:abc" },
        "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts": { posts: [{ uri: "at://did:plc:abc/app.bsky.feed.post/abc", likeCount: 7, repostCount: 1, quoteCount: 0, replyCount: 2 }] },
      }, seen),
    }, "proj", "c1");
    expect(result).toEqual({ read: 2, notes: [] });
    expect(seen.find((call) => call.url.startsWith("https://api.x.com"))?.auth).toMatch(/^OAuth /);
    expect(seen.some((call) => call.url.includes("linkedin"))).toBe(false);
    expect(mutations[0]).toEqual({ name: "campaigns:recordMetrics", args: { sessionToken: "s", projectId: "proj", campaignId: "c1", metrics: [
      { postId: "p1", channel: "x", likes: 5, reposts: 3, replies: 3, impressions: 800, at: 1_000 },
      { postId: "p1", channel: "bluesky", likes: 7, reposts: 1, replies: 2, at: 1_000 },
    ] } });
  });

  it("skips X without keys and reports a channel error without losing the rest", async () => {
    const { client, mutations } = cloud([{ _id: "p1", variants: [{ channel: "x", result: "published", url: "https://x.com/i/web/status/42" }, { channel: "bluesky", result: "published", url: "https://bsky.app/profile/did:plc:abc/post/abc" }] }]);
    const result = await refreshCampaignMetrics({
      session: () => ({ url: "https://cloud.test", sessionToken: "s" }), connect: () => client, xKeys: () => null,
      env: env({ "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts": { posts: [{ uri: "at://did:plc:abc/app.bsky.feed.post/abc", likeCount: 1 }] } }),
    }, "proj", "c1");
    expect(result.read).toBe(1);
    expect(result.notes).toEqual(["Connect X in Settings to read its numbers."]);
    expect((mutations[0].args.metrics as unknown[]).length).toBe(1);
  });

  it("writes nothing when no channel it reads has a published post", async () => {
    const { client, mutations } = cloud([{ _id: "p1", variants: [{ channel: "linkedin", result: "published", url: "https://www.linkedin.com/feed/update/1" }] }]);
    const seen: { url: string }[] = [];
    const result = await refreshCampaignMetrics({ session: () => ({ url: "https://cloud.test", sessionToken: "s" }), connect: () => client, xKeys: () => keys, env: env({}, seen) }, "proj", "c1");
    expect(result).toEqual({ read: 0, notes: [] });
    expect(seen).toEqual([]);
    expect(mutations).toEqual([]);
  });

  it("refuses without an Origin session", async () => {
    await expect(refreshCampaignMetrics({ session: () => ({}), connect: () => cloud([]).client, xKeys: () => null }, "proj", "c1")).rejects.toThrow(/Sign in/);
  });
});
