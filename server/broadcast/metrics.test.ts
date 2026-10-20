import { describe, expect, it } from "vitest";
import type { OriginCloudClient } from "../origin-cloud.ts";
import type { PublishEnv } from "./channels.ts";
import { blueskyPostRef, refreshCampaignMetrics, xTweetId } from "./metrics.ts";

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
  const mutations: { name: string; args: Record<string, unknown> }[] = [];
  const client: OriginCloudClient = {
    query: async () => ({ _id: "c1", posts }),
    mutation: async (name, args) => { mutations.push({ name, args }); return null; },
  };
  return { client, mutations };
}

describe("post links", () => {
  it("reads X and Bluesky post ids from published links", () => {
    expect(xTweetId("https://x.com/i/web/status/1849")).toBe("1849");
    expect(xTweetId("https://twitter.com/origin/status/77?s=20")).toBe("77");
    expect(xTweetId("https://x.com/origin")).toBeNull();
    expect(blueskyPostRef("https://bsky.app/profile/origin.bsky.social/post/3kabc")).toEqual({ actor: "origin.bsky.social", rkey: "3kabc" });
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
