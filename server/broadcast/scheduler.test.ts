import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "../config.ts";
import { json, readBody } from "../harness/http.ts";
import type { OriginCloudClient } from "../origin-cloud.ts";
import type { RequestAuth } from "../request-auth.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { createBroadcastAccounts } from "./accounts.ts";
import type { PublishEnv } from "./channels.ts";
import { BroadcastScheduler, connectedChannels, createBroadcastRoutes, mediaAddressAllowed, type BroadcastSchedulerDeps } from "./scheduler.ts";

const DEPLOYMENT = "http://127.0.0.1:3210";
const folders: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function accountsStore() {
  const folder = mkdtempSync(join(tmpdir(), "omb-broadcast-scheduler-"));
  folders.push(folder);
  return createBroadcastAccounts(join(folder, "accounts.json"), () => null);
}

describe("mediaAddressAllowed", () => {
  it("reads media only from the deployment or a public https address", () => {
    expect(mediaAddressAllowed(`${DEPLOYMENT}/api/storage/abc`, DEPLOYMENT)).toBe(true);
    expect(mediaAddressAllowed("https://cdn.example.com/a.png", DEPLOYMENT)).toBe(true);
    for (const address of ["http://cdn.example.com/a.png", "https://localhost/a.png", "https://127.0.0.1/a", "https://10.0.0.4/a", "https://192.168.1.2/a", "https://[::1]/a", "http://127.0.0.1:4000/api/bots", "https://user:pw@cdn.example.com/a", "not a url"]) {
      expect(mediaAddressAllowed(address, DEPLOYMENT), address).toBe(false);
    }
  });
});

describe("connectedChannels", () => {
  it("maps each channel to its integration, Instagram and Facebook sharing Meta's", () => {
    expect(connectedChannels((id) => id === "meta")).toEqual({ x: false, bluesky: false, linkedin: false, facebook: true, instagram: true, tiktok: false });
  });
});

describe("BroadcastScheduler", () => {
  function setup(claimed: unknown[], deps: Partial<BroadcastSchedulerDeps> = {}) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const client: OriginCloudClient = {
      query: async () => null,
      mutation: async (name, args) => {
        calls.push({ name, args });
        return name === "broadcast:claimDue" ? claimed.splice(0) : null;
      },
    };
    const fetched: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    const env: PublishEnv = {
      sleep: async () => undefined, nonce: () => "n", now: () => 0,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        fetched.push(url);
        if (init?.body && url.endsWith("createSession")) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (url.endsWith("/a.png")) return new Response(new Uint8Array([1]), { status: 200 });
        if (url.endsWith("createSession")) return Response.json({ accessJwt: "j", did: "did:plc:a", handle: "me.test" });
        if (url.endsWith("uploadBlob")) return Response.json({ blob: {} });
        if (url.endsWith("createRecord")) return Response.json({ uri: "at://did:plc:a/app.bsky.feed.post/r1" });
        return new Response("{}", { status: 500 });
      }) as typeof fetch,
    };
    const scheduler = new BroadcastScheduler({
      session: () => ({ url: DEPLOYMENT, sessionToken: "token" }), connect: () => client, env,
      keys: { x: () => null, bluesky: () => ({ handle: "me.test", appPassword: "p" }), linkedin: () => null, meta: () => null, tiktok: () => null },
      ...deps,
    });
    return { scheduler, calls, fetched, bodies };
  }

  it("publishes each claimed channel and reports every result once", async () => {
    const { scheduler, calls, fetched } = setup([{
      postId: "p1", variants: [{ channel: "bluesky", text: "Hi" }, { channel: "x", text: "Hi" }],
      media: [{ name: "a.png", kind: "image", contentType: "image/png", url: `${DEPLOYMENT}/a.png` }],
    }]);
    expect(await scheduler.tick()).toBe(1);
    expect(fetched.filter((url) => url.endsWith("/a.png"))).toHaveLength(1);
    const finish = calls.find((call) => call.name === "broadcast:finish");
    expect(finish?.args).toEqual({
      sessionToken: "token", postId: "p1",
      results: [
        { channel: "bluesky", ok: true, url: "https://bsky.app/profile/me.test/post/r1" },
        { channel: "x", ok: false, error: "X is not connected; add its keys in Settings, Integrations" },
      ],
    });
  });

  it("refuses media on this computer's network instead of fetching it", async () => {
    const { scheduler, calls, fetched } = setup([{ postId: "p2", variants: [{ channel: "bluesky", text: "Hi" }], media: [{ name: "b.png", kind: "image", url: "http://192.168.0.5/b.png" }] }]);
    await scheduler.tick();
    expect(fetched.some((url) => url.includes("192.168"))).toBe(false);
    expect(calls.find((call) => call.name === "broadcast:finish")?.args.results).toEqual([{ channel: "bluesky", ok: false, error: "A media file's address is not a public https address" }]);
  });

  it("does nothing without an Origin sign-in", async () => {
    const scheduler = new BroadcastScheduler({ session: () => ({}), connect: () => { throw new Error("no"); } });
    expect(await scheduler.tick()).toBe(0);
  });

  it("selects extra account keys per variant and keeps injected default keys", async () => {
    const accounts = accountsStore();
    const saved = accounts.add({ integration: "bluesky", label: "Brand", projectIds: ["proj"], fields: { handle: "brand.test", appPassword: "brand-password" } });
    if (!saved.ok) throw new Error(saved.error);
    const { scheduler, calls, bodies } = setup([
      { postId: "extra", projectId: "proj", variants: [{ channel: "bluesky", text: "Brand", accountId: saved.account.id }] },
      { postId: "default", projectId: "proj", variants: [{ channel: "bluesky", text: "Personal", accountId: "default" }] },
    ], { accounts });
    expect(await scheduler.tick()).toBe(2);
    expect(bodies).toEqual([{ identifier: "brand.test", password: "brand-password" }, { identifier: "me.test", password: "p" }]);
    expect(calls.filter((call) => call.name === "broadcast:finish").every((call) => (call.args.results as { ok: boolean }[])[0].ok)).toBe(true);
  });

  it("fails only the channel whose chosen account is missing", async () => {
    const { scheduler, calls, bodies } = setup([{ postId: "p1", projectId: "proj", variants: [
      { channel: "x", text: "X", accountId: "other-computer" }, { channel: "bluesky", text: "Hi" },
    ] }], { accounts: accountsStore() });
    await scheduler.tick();
    expect(bodies).toHaveLength(1);
    expect(calls.find((call) => call.name === "broadcast:finish")?.args.results).toEqual([
      { channel: "x", ok: false, error: "The X account chosen for this post is not on this computer" },
      { channel: "bluesky", ok: true, url: "https://bsky.app/profile/me.test/post/r1" },
    ]);
  });

  it("refuses an account restricted to another project", async () => {
    const accounts = accountsStore();
    const saved = accounts.add({ integration: "bluesky", label: "Private", projectIds: ["private"], fields: { handle: "private.test", appPassword: "secret" } });
    if (!saved.ok) throw new Error(saved.error);
    const { scheduler, calls, bodies } = setup([{ postId: "p1", projectId: "other", variants: [{ channel: "bluesky", text: "Hi", accountId: saved.account.id }] }], { accounts });
    await scheduler.tick();
    expect(bodies).toEqual([]);
    expect(calls.find((call) => call.name === "broadcast:finish")?.args.results).toEqual([
      { channel: "bluesky", ok: false, error: "The Bluesky account chosen for this post is not on this computer" },
    ]);
  });

  it("uses the same default accounts file as routes without additional wiring", async () => {
    mkdirSync(DATA_DIR, { recursive: true });
    const url = await serveAccounts();
    const response = await fetch(url, { method: "POST", body: JSON.stringify({ integration: "bluesky", label: "Default store", fields: { handle: "default-store.test", appPassword: "extra-password" } }) });
    expect(response.status).toBe(200);
    const { account } = await response.json() as { account: { id: string } };
    try {
      const { scheduler, bodies } = setup([{ postId: "p1", variants: [{ channel: "bluesky", text: "Hi", accountId: account.id }] }]);
      await scheduler.tick();
      expect(bodies).toEqual([{ identifier: "default-store.test", password: "extra-password" }]);
    } finally {
      await fetch(`${url}/${account.id}`, { method: "DELETE" });
    }
  });

  it("resolves default credentials from the accounts store when keys are not injected", async () => {
    const accounts = createBroadcastAccounts("unused", (id) => id === "bluesky" ? { handle: "store.test", appPassword: "store-password" } : null);
    const { scheduler, bodies } = setup([{ postId: "p1", variants: [{ channel: "bluesky", text: "Hi" }] }], { accounts, keys: undefined });
    await scheduler.tick();
    expect(bodies).toEqual([{ identifier: "store.test", password: "store-password" }]);
  });

  it("passes a reel's cover frame to the Instagram container with the chosen account", async () => {
    const accounts = accountsStore();
    const saved = accounts.add({ integration: "meta", label: "Brand", fields: { pageAccessToken: "brand-token", instagramUserId: "ig1" } });
    if (!saved.ok) throw new Error(saved.error);
    const seen: { url: string; body?: RequestInit["body"] }[] = [];
    const { scheduler, calls } = setup([{
      postId: "reel", projectId: "proj", format: "reel", reel: { coverMs: 1700, music: "In-app sound" },
      variants: [{ channel: "instagram", text: "Reel", accountId: saved.account.id }],
      media: [{ name: "clip.mp4", kind: "video", url: "https://cdn.test/clip.mp4" }],
    }], { accounts, env: {
      now: () => 0, nonce: () => "n", sleep: async () => undefined,
      fetch: async (input, init) => {
        const url = String(input);
        seen.push({ url, body: init?.body });
        if (url.endsWith("/ig1/media")) return Response.json({ id: "container" });
        if (url.includes("/container?")) return Response.json({ status_code: "FINISHED" });
        if (url.endsWith("/ig1/media_publish")) return Response.json({ id: "published" });
        if (url.includes("/published?")) return Response.json({ permalink: "https://instagram.com/reel/1" });
        throw new Error(`Unexpected fetch ${url}`);
      },
    } });
    await scheduler.tick();
    const container = new URLSearchParams(String(seen[0].body));
    expect(container.get("media_type")).toBe("REELS");
    expect(container.get("thumb_offset")).toBe("1700");
    expect(container.get("access_token")).toBe("brand-token");
    expect(calls.find((call) => call.name === "broadcast:finish")?.args.results).toEqual([{ channel: "instagram", ok: true, url: "https://instagram.com/reel/1" }]);
  });
});

async function serveAccounts(accounts?: ReturnType<typeof createBroadcastAccounts>, admin = true) {
  const scheduler = new BroadcastScheduler({ session: () => ({}), connect: () => { throw new Error("No session"); } });
  const route = createBroadcastRoutes({ scheduler, accounts });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const auth: RequestAuth = { kind: "loopback", scopes: admin ? ["admin"] : ["client"] };
    if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/origin/broadcast/accounts`;
}

describe("broadcast account routes", () => {
  it("adds, lists by project and deletes without returning credentials", async () => {
    const accounts = accountsStore();
    const url = await serveAccounts(accounts);
    const response = await fetch(url, { method: "POST", body: JSON.stringify({ integration: "bluesky", label: "Brand", projectIds: ["p1"], fields: { handle: "brand.test", appPassword: "never-send-this" } }) });
    expect(response.status).toBe(200);
    const saved = await response.json() as { account: { id: string } };
    expect(JSON.stringify(saved)).not.toContain("never-send-this");
    expect(saved.account).not.toHaveProperty("values");
    expect(await (await fetch(`${url}?projectId=p1`)).json()).toEqual({ accounts: [saved.account] });
    expect(await (await fetch(`${url}?projectId=p2`)).json()).toEqual({ accounts: [] });
    expect(await (await fetch(`${url}/${saved.account.id}`, { method: "DELETE" })).json()).toEqual({ ok: true });
    expect((await fetch(`${url}/${saved.account.id}`, { method: "DELETE" })).status).toBe(404);
    expect(accounts.list()).toEqual([]);
  });

  it("requires admin scope for changes while permitting reads", async () => {
    const accounts = accountsStore();
    const url = await serveAccounts(accounts, false);
    expect((await fetch(url)).status).toBe(200);
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await fetch(`${url}/unknown`, { method: "DELETE" })).status).toBe(403);
    expect(accounts.list()).toEqual([]);
  });

  it.each([null, [], {}, { integration: "x", label: "Brand", fields: {} }])("rejects invalid input %#", async (body) => {
    const url = await serveAccounts(accountsStore());
    const response = await fetch(url, { method: "POST", body: JSON.stringify(body) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });
});
