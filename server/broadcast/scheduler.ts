import { isIP } from "node:net";
import { BROADCAST_CHANNELS, BROADCAST_RULES, isBroadcastChannel, type BroadcastChannel } from "../../shared/broadcast.ts";
import { integrationConfigured, type IntegrationId } from "../integration-keys.ts";
import type { OriginCloudClient } from "../origin-cloud.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { defaultPublishEnv, publishChannel, PublishError, type ChannelKeys, type PublishEnv, type PublishMedia } from "./channels.ts";
import { createBroadcastAccounts, type SocialIntegration } from "./accounts.ts";

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const TICK_MS = 30_000;
const MEDIA_MAX_BYTES = 250 * 1024 * 1024;
const REDIRECTS_MAX = 3;

export interface BroadcastSchedulerDeps {
  session(): { url?: string; sessionToken?: string };
  connect(url: string): OriginCloudClient;
  keys?: ChannelKeys;
  accounts?: ReturnType<typeof createBroadcastAccounts>;
  env?: PublishEnv;
  log?(message: string): void;
}

function privateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (!isIP(host)) return false;
  if (host.includes(":")) return host === "::1" || host === "::" || /^(fc|fd|fe80)/.test(host) || host.startsWith("::ffff:");
  const [a, b] = host.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Security: a post's media goes out to a public channel, so it is read only from the Origin deployment the member signed
 * in to or from a public https address, never from this computer or its network (where this server and its owner-trusted
 * loopback routes live), redirects included.
 */
export function mediaAddressAllowed(address: string, deployment: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.origin === new URL(deployment).origin) return true;
  return url.protocol === "https:" && !privateHost(url.hostname);
}

async function download(env: PublishEnv, address: string, deployment: string): Promise<Uint8Array> {
  let current = address;
  for (let hop = 0; hop <= REDIRECTS_MAX; hop += 1) {
    if (!mediaAddressAllowed(current, deployment)) throw new PublishError("A media file's address is not a public https address");
    const response = await env.fetch(current, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      current = new URL(response.headers.get("location")!, current).toString();
      continue;
    }
    if (!response.ok) throw new PublishError(`A media file could not be read (HTTP ${response.status})`);
    if (Number(response.headers.get("content-length")) > MEDIA_MAX_BYTES) throw new PublishError("A media file is over 250 MB");
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > MEDIA_MAX_BYTES) throw new PublishError("A media file is over 250 MB");
    return data;
  }
  throw new PublishError("A media file's address redirects too often");
}

/** A media item the scheduler can hand to a channel, fetched at most once however many channels use it. */
function mediaItem(env: PublishEnv, raw: Json, deployment: string): PublishMedia | null {
  const kind = text(raw.kind);
  const url = text(raw.url);
  if ((kind !== "image" && kind !== "video") || !url) return null;
  let bytes: Promise<Uint8Array> | null = null;
  return {
    name: text(raw.name) || "media", kind, url,
    contentType: text(raw.contentType) || (kind === "video" ? "video/mp4" : "image/jpeg"),
    bytes: () => (bytes ??= download(env, url, deployment)),
  };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 600);

/** Publishes the posts this member scheduled once they are due, while the app runs, with this member's channel keys. */
export class BroadcastScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<number> | null = null;
  private readonly env: PublishEnv;
  private readonly accounts: ReturnType<typeof createBroadcastAccounts>;

  private readonly deps: BroadcastSchedulerDeps;

  constructor(deps: BroadcastSchedulerDeps) {
    this.deps = deps;
    this.env = deps.env ?? defaultPublishEnv;
    this.accounts = deps.accounts ?? createBroadcastAccounts();
  }

  get isTicking(): boolean { return this.running !== null; }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resolves with how many posts this run handled; a run already in progress is joined rather than repeated. */
  tick(): Promise<number> {
    this.running ??= this.run().catch((error: unknown) => {
      this.deps.log?.(`broadcast: ${errorText(error)}`);
      return 0;
    }).finally(() => { this.running = null; });
    return this.running;
  }

  private variantKeys(channel: BroadcastChannel, accountId: string | undefined, projectId: string | undefined): ChannelKeys {
    if (this.deps.keys && (accountId === undefined || accountId === "default")) return this.deps.keys;
    const read = <I extends SocialIntegration>(integration: I) => this.accounts.keys(integration, accountId, projectId);
    if (accountId !== undefined && !read(BROADCAST_RULES[channel].integration as SocialIntegration)) {
      throw new PublishError(`The ${BROADCAST_RULES[channel].label} account chosen for this post is not on this computer`);
    }
    return { x: () => read("x"), bluesky: () => read("bluesky"), linkedin: () => read("linkedin"), meta: () => read("meta"), tiktok: () => read("tiktok") };
  }

  private async run(): Promise<number> {
    const { url, sessionToken } = this.deps.session();
    if (!url || !sessionToken) return 0;
    const client = this.deps.connect(url);
    const due = await client.mutation("broadcast:claimDue", { sessionToken });
    const posts = Array.isArray(due) ? due.map(record) : [];
    for (const post of posts) {
      const media = (Array.isArray(post.media) ? post.media.map(record) : []).map((item) => mediaItem(this.env, item, url)).filter((item): item is PublishMedia => item !== null);
      const results = [];
      for (const variant of Array.isArray(post.variants) ? post.variants.map(record) : []) {
        const channel = text(variant.channel);
        if (!isBroadcastChannel(channel)) continue;
        try {
          const keys = this.variantKeys(channel, typeof variant.accountId === "string" ? variant.accountId : undefined, text(post.projectId) || undefined);
          const reel = record(post.reel);
          const published = await publishChannel(channel, text(variant.text), media, keys, this.env, {
            ...(post.format === "post" || post.format === "reel" ? { format: post.format } : {}),
            ...(typeof reel.coverMs === "number" ? { coverMs: reel.coverMs } : {}),
          });
          results.push({ channel, ok: true, ...(published.url ? { url: published.url } : {}) });
        } catch (error) {
          results.push({ channel, ok: false, error: errorText(error) });
        }
      }
      await client.mutation("broadcast:finish", { sessionToken, postId: text(post.postId), results });
    }
    return posts.length;
  }
}

export function connectedChannels(configured: (id: IntegrationId) => boolean = integrationConfigured): Record<BroadcastChannel, boolean> {
  return Object.fromEntries(BROADCAST_CHANNELS.map((channel) => [channel, configured(BROADCAST_RULES[channel].integration as IntegrationId)])) as Record<BroadcastChannel, boolean>;
}

export function createBroadcastRoutes(deps: { scheduler: BroadcastScheduler; configured?: (id: IntegrationId) => boolean; accounts?: ReturnType<typeof createBroadcastAccounts> }): RouteHandler {
  const accounts = deps.accounts ?? createBroadcastAccounts();
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path === "/api/origin/broadcast/accounts") {
      if (method === "GET") return json(res, 200, { accounts: accounts.list(url.searchParams.get("projectId") ?? undefined) });
      if (method === "POST") {
        if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Changing integration keys needs the admin scope" });
        const saved = accounts.add(await readBody(req));
        return saved.ok ? json(res, 200, { account: saved.account }) : json(res, 400, { error: saved.error });
      }
    }
    const account = /^\/api\/origin\/broadcast\/accounts\/([^/]+)$/.exec(path);
    if (account && method === "DELETE") {
      if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Changing integration keys needs the admin scope" });
      return accounts.remove(account[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: "No such account" });
    }
    if (path === "/api/origin/broadcast/channels" && method === "GET") return json(res, 200, { channels: connectedChannels(deps.configured) });
    if (path === "/api/origin/broadcast/run" && method === "POST") return json(res, 200, { handled: await deps.scheduler.tick() });
    return PASS;
  };
}
