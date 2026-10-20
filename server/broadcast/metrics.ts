import { integrationKey, type IntegrationValues } from "../integration-keys.ts";
import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, type OriginCloudClient } from "../origin-cloud.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { defaultPublishEnv, type PublishEnv } from "./channels.ts";
import { oauth1Header } from "./oauth1.ts";

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

export type PostNumbers = { likes: number; reposts: number; replies: number; impressions?: number };

/** Bluesky's public AppView answers reads without an account. */
const BLUESKY_PUBLIC = "https://public.api.bsky.app/xrpc";
const X_TWEETS = "https://api.x.com/2/tweets";
/** X's tweet lookup takes up to 100 ids per request. */
const X_IDS_MAX = 100;
/** getPosts takes up to 25 AT URIs per request. */
const BLUESKY_URIS_MAX = 25;

export class MetricsError extends Error {}

async function readJson(label: string, response: Response): Promise<Json> {
  const body = record(await response.json().catch(() => ({})));
  if (!response.ok) {
    const detail = text(body.detail) || text(body.message) || text(body.title) || text(record(list(body.errors)[0]).message);
    throw new MetricsError(`${label} answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return body;
}

export function xTweetId(url: string): string | null {
  return /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:i\/web|[^/]+)\/status\/(\d{1,25})(?:[/?#]|$)/i.exec(url)?.[1] ?? null;
}

export function blueskyPostRef(url: string): { actor: string; rkey: string } | null {
  const match = /^https:\/\/bsky\.app\/profile\/([^/?#]+)\/post\/([a-z0-9]{1,64})(?:[/?#]|$)/i.exec(url);
  return match ? { actor: decodeURIComponent(match[1]), rkey: match[2] } : null;
}

/** Likes, reposts, replies and views of X posts by URL, read with the member's own X keys. */
export async function xMetrics(credentials: IntegrationValues<"x">, urls: readonly string[], env: PublishEnv = defaultPublishEnv): Promise<Map<string, PostNumbers>> {
  const ids = new Map<string, string>();
  for (const url of urls) {
    const id = xTweetId(url);
    if (id) ids.set(id, url);
  }
  const out = new Map<string, PostNumbers>();
  const all = [...ids.keys()];
  for (let start = 0; start < all.length; start += X_IDS_MAX) {
    const address = `${X_TWEETS}?ids=${all.slice(start, start + X_IDS_MAX).join(",")}&tweet.fields=public_metrics`;
    const response = await env.fetch(address, { headers: { Authorization: oauth1Header("GET", address, credentials, { nonce: env.nonce(), timestamp: Math.floor(env.now() / 1000) }) } });
    for (const tweet of list((await readJson("X", response)).data)) {
      const url = ids.get(text(tweet.id));
      const metrics = record(tweet.public_metrics);
      if (!url) continue;
      out.set(url, {
        likes: count(metrics.like_count), reposts: count(metrics.retweet_count) + count(metrics.quote_count), replies: count(metrics.reply_count),
        ...(typeof metrics.impression_count === "number" ? { impressions: count(metrics.impression_count) } : {}),
      });
    }
  }
  return out;
}

/** Likes, reposts and replies of Bluesky posts by URL, from the public AppView. */
export async function blueskyMetrics(urls: readonly string[], env: PublishEnv = defaultPublishEnv): Promise<Map<string, PostNumbers>> {
  const dids = new Map<string, string>();
  const uris = new Map<string, string>();
  for (const url of urls) {
    const ref = blueskyPostRef(url);
    if (!ref) continue;
    let did = ref.actor.startsWith("did:") ? ref.actor : dids.get(ref.actor);
    if (!did) {
      const resolved = await readJson("Bluesky", await env.fetch(`${BLUESKY_PUBLIC}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(ref.actor)}`));
      did = text(resolved.did);
      if (!did) continue;
      dids.set(ref.actor, did);
    }
    uris.set(`at://${did}/app.bsky.feed.post/${ref.rkey}`, url);
  }
  const out = new Map<string, PostNumbers>();
  const all = [...uris.keys()];
  for (let start = 0; start < all.length; start += BLUESKY_URIS_MAX) {
    const query = all.slice(start, start + BLUESKY_URIS_MAX).map((uri) => `uris=${encodeURIComponent(uri)}`).join("&");
    for (const post of list((await readJson("Bluesky", await env.fetch(`${BLUESKY_PUBLIC}/app.bsky.feed.getPosts?${query}`))).posts)) {
      const url = uris.get(text(post.uri));
      if (url) out.set(url, { likes: count(post.likeCount), reposts: count(post.repostCount) + count(post.quoteCount), replies: count(post.replyCount) });
    }
  }
  return out;
}

export interface CampaignMetricsDeps {
  session(): { url?: string; sessionToken?: string };
  connect(url: string): OriginCloudClient;
  xKeys(): IntegrationValues<"x"> | null;
  env?: PublishEnv;
}

export type MetricsRefresh = { read: number; notes: string[] };

/** Reads the numbers of a campaign's published X and Bluesky posts and stores them on the campaign. */
export async function refreshCampaignMetrics(deps: CampaignMetricsDeps, projectId: string, campaignId: string): Promise<MetricsRefresh> {
  const { url, sessionToken } = deps.session();
  if (!url || !sessionToken) throw new MetricsError("Sign in to Origin first.");
  const client = deps.connect(url);
  const detail = record(await client.query("campaigns:get", { sessionToken, projectId, campaignId }));
  if (!detail._id) throw new MetricsError("Campaign not found");
  const published = list(detail.posts).flatMap((post) => list(post.variants)
    .filter((variant) => variant.result === "published" && text(variant.url))
    .map((variant) => ({ postId: text(post._id), channel: text(variant.channel), url: text(variant.url) })));
  const env = deps.env ?? defaultPublishEnv;
  const notes: string[] = [];
  const numbers = new Map<string, PostNumbers>();
  const xUrls = published.filter((item) => item.channel === "x").map((item) => item.url);
  if (xUrls.length) {
    const keys = deps.xKeys();
    if (!keys) notes.push("Connect X in Settings to read its numbers.");
    else await xMetrics(keys, xUrls, env).then((found) => found.forEach((value, key) => numbers.set(key, value)), (error: unknown) => { notes.push(error instanceof Error ? error.message : String(error)); });
  }
  const blueskyUrls = published.filter((item) => item.channel === "bluesky").map((item) => item.url);
  if (blueskyUrls.length) {
    await blueskyMetrics(blueskyUrls, env).then((found) => found.forEach((value, key) => numbers.set(key, value)), (error: unknown) => { notes.push(error instanceof Error ? error.message : String(error)); });
  }
  const at = env.now();
  const metrics = published.flatMap((item) => {
    const found = numbers.get(item.url);
    return found ? [{ postId: item.postId, channel: item.channel, ...found, at }] : [];
  });
  if (metrics.length) await client.mutation("campaigns:recordMetrics", { sessionToken, projectId, campaignId, metrics });
  return { read: metrics.length, notes };
}

export function createCampaignRoutes(deps: Partial<CampaignMetricsDeps> = {}): RouteHandler {
  const resolved: CampaignMetricsDeps = {
    session: deps.session ?? (() => readOriginCloud(defaultOriginCloudFile())),
    connect: deps.connect ?? ((url) => convexOriginClient(url)),
    xKeys: deps.xKeys ?? (() => integrationKey("x")),
    ...(deps.env ? { env: deps.env } : {}),
  };
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/origin/campaigns/metrics" || method !== "POST") return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Reading post metrics uses this app's own keys and needs the admin scope" });
    const body = record(await readBody(req));
    const projectId = text(body.projectId);
    const campaignId = text(body.campaignId);
    if (!projectId || !campaignId) return json(res, 400, { error: "projectId and campaignId are required" });
    try {
      return json(res, 200, await refreshCampaignMetrics(resolved, projectId, campaignId));
    } catch (error) {
      return json(res, error instanceof MetricsError ? 409 : 502, { error: (error instanceof Error ? error.message : String(error)).slice(0, 400) });
    }
  };
}
