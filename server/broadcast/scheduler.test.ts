import { describe, expect, it } from "vitest";
import type { OriginCloudClient } from "../origin-cloud.ts";
import type { PublishEnv } from "./channels.ts";
import { BroadcastScheduler, connectedChannels, mediaAddressAllowed } from "./scheduler.ts";

const DEPLOYMENT = "http://127.0.0.1:3210";

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
  function setup(claimed: unknown[]) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const client: OriginCloudClient = {
      query: async () => null,
      mutation: async (name, args) => {
        calls.push({ name, args });
        return name === "broadcast:claimDue" ? claimed.splice(0) : null;
      },
    };
    const fetched: string[] = [];
    const env: PublishEnv = {
      sleep: async () => undefined, nonce: () => "n", now: () => 0,
      fetch: (async (input: string | URL | Request) => {
        const url = String(input);
        fetched.push(url);
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
    });
    return { scheduler, calls, fetched };
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
});
