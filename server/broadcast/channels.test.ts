import { describe, expect, it } from "vitest";
import { linkedInCommentary, linkFacets, publishBluesky, publishChannel, publishFacebook, publishInstagram, publishLinkedIn, publishTikTok, publishX, tiktokChunks, type PublishEnv, type PublishMedia } from "./channels.ts";
import { oauth1Header } from "./oauth1.ts";

type Route = { method?: string; match: string | RegExp; reply: unknown; status?: number; headers?: Record<string, string> };
type Seen = { method: string; url: string; headers: Record<string, string>; body: RequestInit["body"] };

function fakeEnv(routes: Route[]): PublishEnv & { seen: Seen[] } {
  const seen: Seen[] = [];
  const queue = [...routes];
  return {
    seen,
    sleep: async () => undefined,
    nonce: () => "nonce",
    now: () => Date.UTC(2026, 9, 20, 12),
    fetch: (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      seen.push({ method, url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body });
      const index = queue.findIndex((route) => (!route.method || route.method === method) && (typeof route.match === "string" ? url.startsWith(route.match) : route.match.test(url)));
      if (index < 0) throw new Error(`unexpected ${method} ${url}`);
      const [route] = queue.splice(index, 1);
      return new Response(typeof route.reply === "string" ? route.reply : JSON.stringify(route.reply), { status: route.status ?? 200, headers: route.headers });
    }) as typeof fetch,
  };
}

const image = (name = "cover.png"): PublishMedia => ({ name, kind: "image", contentType: "image/png", url: `https://cdn.test/${name}`, bytes: async () => new Uint8Array([1, 2, 3]) });
const video: PublishMedia = { name: "clip.mp4", kind: "video", contentType: "video/mp4", url: "https://cdn.test/clip.mp4", bytes: async () => new Uint8Array(10) };
const jsonBody = (seen: Seen) => JSON.parse(String(seen.body)) as Record<string, unknown>;

describe("OAuth 1.0a", () => {
  it("signs X's documented example request", () => {
    const header = oauth1Header("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true", {
      apiKey: "xvz1evFS4wEEPTGEFPHBog", apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    }, { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: 1318622958, formParams: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" } });
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
  });
});

describe("X", () => {
  const keys = { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "ts" };

  it("uploads an image, posts the tweet with its media id and links to it", async () => {
    const env = fakeEnv([
      { method: "POST", match: "https://api.x.com/2/media/upload", reply: { data: { id: "77" } } },
      { method: "POST", match: "https://api.x.com/2/tweets", reply: { data: { id: "123", text: "Hi" } }, status: 201 },
    ]);
    expect(await publishX(keys, "Hi", [image()], env)).toEqual({ url: "https://x.com/i/web/status/123" });
    expect(env.seen[0].body).toBeInstanceOf(FormData);
    expect(jsonBody(env.seen[1])).toEqual({ text: "Hi", media: { media_ids: ["77"] } });
    expect(env.seen.every((call) => call.headers.authorization.startsWith("OAuth "))).toBe(true);
  });

  it("uploads a video in chunks and waits for X to process it", async () => {
    const env = fakeEnv([
      { method: "POST", match: "https://api.x.com/2/media/upload/initialize", reply: { data: { id: "9" } } },
      { method: "POST", match: "https://api.x.com/2/media/upload/9/append", reply: {} },
      { method: "POST", match: "https://api.x.com/2/media/upload/9/finalize", reply: { data: { id: "9", processing_info: { state: "pending", check_after_secs: 1 } } } },
      { method: "GET", match: "https://api.x.com/2/media/upload?command=STATUS", reply: { data: { processing_info: { state: "succeeded" } } } },
      { method: "POST", match: "https://api.x.com/2/tweets", reply: { data: { id: "5" } } },
    ]);
    expect(await publishX(keys, "Clip", [video], env)).toEqual({ url: "https://x.com/i/web/status/5" });
  });

  it("reports X's error detail", async () => {
    const env = fakeEnv([{ method: "POST", match: "https://api.x.com/2/tweets", status: 403, reply: { title: "Forbidden", detail: "You are not permitted to perform this action." } }]);
    await expect(publishX(keys, "Hi", [], env)).rejects.toThrow("X answered 403: You are not permitted to perform this action.");
  });
});

describe("Bluesky", () => {
  it("signs in with the app password, uploads images as blobs and links the post", async () => {
    const env = fakeEnv([
      { match: /createSession$/, reply: { accessJwt: "jwt", did: "did:plc:abc", handle: "me.bsky.social" } },
      { match: /uploadBlob$/, reply: { blob: { $type: "blob", ref: { $link: "bafy" }, mimeType: "image/png", size: 3 } } },
      { match: /createRecord$/, reply: { uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz", cid: "c" } },
    ]);
    const result = await publishBluesky({ handle: "@me.bsky.social", appPassword: "app-pass" }, "Read https://origin.test now", [image()], env);
    expect(result).toEqual({ url: "https://bsky.app/profile/me.bsky.social/post/3kxyz" });
    expect(jsonBody(env.seen[0])).toEqual({ identifier: "me.bsky.social", password: "app-pass" });
    expect(env.seen[1].headers.authorization).toBe("Bearer jwt");
    const record = jsonBody(env.seen[2]).record as Record<string, unknown>;
    expect(record.embed).toMatchObject({ $type: "app.bsky.embed.images" });
    expect(record.facets).toEqual([{ index: { byteStart: 5, byteEnd: 24 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://origin.test" }] }]);
  });

  it("marks links by UTF-8 byte offsets", () => {
    expect(linkFacets("é https://a.test.")[0].index).toEqual({ byteStart: 3, byteEnd: 17 });
  });

  it("refuses a video", async () => {
    const env = fakeEnv([{ match: /createSession$/, reply: { accessJwt: "jwt", did: "did:plc:abc" } }]);
    await expect(publishBluesky({ handle: "me", appPassword: "p" }, "x", [video], env)).rejects.toThrow("images only");
  });
});

describe("LinkedIn", () => {
  it("uploads images, creates the post as the author and links the share", async () => {
    const env = fakeEnv([
      { match: /images\?action=initializeUpload$/, reply: { value: { uploadUrl: "https://upload.linkedin.test/1", image: "urn:li:image:1" } } },
      { method: "PUT", match: "https://upload.linkedin.test/1", reply: "", status: 201 },
      { match: /rest\/posts$/, reply: "", status: 201, headers: { "x-restli-id": "urn:li:share:42" } },
    ]);
    const result = await publishLinkedIn({ accessToken: "tok", authorUrn: "urn:li:person:abc" }, "Ship it #launch (v2)", [image()], env);
    expect(result).toEqual({ url: "https://www.linkedin.com/feed/update/urn:li:share:42/" });
    const post = jsonBody(env.seen[2]);
    expect(post).toMatchObject({ author: "urn:li:person:abc", commentary: "Ship it {hashtag|\\#|launch} \\(v2\\)", content: { media: { id: "urn:li:image:1" } } });
    expect(env.seen[2].headers["linkedin-version"]).toMatch(/^\d{6}$/);
  });

  it("escapes little-text markup", () => {
    expect(linkedInCommentary("a_b @c [d]")).toBe("a\\_b \\@c \\[d\\]");
  });
});

describe("Facebook and Instagram", () => {
  const meta = { pageAccessToken: "page-token", facebookPageId: "100" };

  it("posts text to the page feed", async () => {
    const env = fakeEnv([{ method: "POST", match: "https://graph.facebook.com/v23.0/100/feed", reply: { id: "100_7" } }]);
    expect(await publishFacebook(meta, "Hello", [], env)).toEqual({ url: "https://www.facebook.com/100_7" });
    expect(new URLSearchParams(String(env.seen[0].body)).get("access_token")).toBe("page-token");
  });

  it("posts several photos as attached media", async () => {
    const env = fakeEnv([
      { match: /100\/photos$/, reply: { id: "p1" } },
      { match: /100\/photos$/, reply: { id: "p2" } },
      { match: /100\/feed$/, reply: { id: "100_8" } },
    ]);
    await publishFacebook(meta, "Two", [image("a.png"), image("b.png")], env);
    const feed = new URLSearchParams(String(env.seen[2].body));
    expect(feed.get("attached_media[1]")).toBe('{"media_fbid":"p2"}');
    expect(new URLSearchParams(String(env.seen[0].body)).get("published")).toBe("false");
  });

  it("finds the Instagram account, waits for the reel and publishes it", async () => {
    const env = fakeEnv([
      { method: "GET", match: "https://graph.facebook.com/v23.0/100?", reply: { instagram_business_account: { id: "ig1" } } },
      { method: "POST", match: /ig1\/media$/, reply: { id: "c1" } },
      { method: "GET", match: "https://graph.facebook.com/v23.0/c1?", reply: { status_code: "IN_PROGRESS" } },
      { method: "GET", match: "https://graph.facebook.com/v23.0/c1?", reply: { status_code: "FINISHED" } },
      { method: "POST", match: /ig1\/media_publish$/, reply: { id: "m1" } },
      { method: "GET", match: "https://graph.facebook.com/v23.0/m1?", reply: { permalink: "https://www.instagram.com/reel/abc/" } },
    ]);
    expect(await publishInstagram(meta, "Reel", [video], env)).toEqual({ url: "https://www.instagram.com/reel/abc/" });
    const container = new URLSearchParams(String(env.seen[1].body));
    expect(container.get("media_type")).toBe("REELS");
    expect(container.get("video_url")).toBe("https://cdn.test/clip.mp4");
  });

  it("stops when Instagram fails to process the media", async () => {
    const env = fakeEnv([
      { method: "POST", match: /ig2\/media$/, reply: { id: "c2" } },
      { method: "GET", match: "https://graph.facebook.com/v23.0/c2?", reply: { status_code: "ERROR" } },
    ]);
    await expect(publishInstagram({ ...meta, instagramUserId: "ig2" }, "x", [image()], env)).rejects.toThrow("could not process");
  });
});

describe("TikTok", () => {
  it("uploads the video in one chunk, publishes it publicly and links the video", async () => {
    const env = fakeEnv([
      { match: /creator_info\/query\/$/, reply: { data: { creator_username: "origin", privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"] }, error: { code: "ok" } } },
      { match: /video\/init\/$/, reply: { data: { publish_id: "pub1", upload_url: "https://upload.tiktok.test/v" }, error: { code: "ok" } } },
      { method: "PUT", match: "https://upload.tiktok.test/v", reply: "", status: 201 },
      { match: /status\/fetch\/$/, reply: { data: { status: "PROCESSING_UPLOAD" }, error: { code: "ok" } } },
      { match: /status\/fetch\/$/, reply: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7311] }, error: { code: "ok" } } },
    ]);
    expect(await publishTikTok({ accessToken: "act.1" }, "Caption", [video], env)).toEqual({ url: "https://www.tiktok.com/@origin/video/7311" });
    expect(jsonBody(env.seen[1])).toEqual({
      post_info: { title: "Caption", privacy_level: "PUBLIC_TO_EVERYONE" },
      source_info: { source: "FILE_UPLOAD", video_size: 10, chunk_size: 10, total_chunk_count: 1 },
    });
    expect(env.seen[2].headers["content-range"]).toBe("bytes 0-9/10");
  });

  it("reports TikTok's error", async () => {
    const env = fakeEnv([{ match: /creator_info\/query\/$/, reply: { data: {}, error: { code: "access_token_invalid", message: "The access token is invalid" } } }]);
    await expect(publishTikTok({ accessToken: "bad" }, "x", [video], env)).rejects.toThrow("The access token is invalid");
  });

  it("splits large videos into chunks the last of which takes the remainder", () => {
    expect(tiktokChunks(1_000)).toEqual({ chunkSize: 1_000, count: 1 });
    expect(tiktokChunks(100 * 1024 * 1024 + 5)).toEqual({ chunkSize: 10 * 1024 * 1024, count: 10 });
  });

  it("needs exactly one video", async () => {
    await expect(publishTikTok({ accessToken: "a" }, "x", [image()], fakeEnv([]))).rejects.toThrow("exactly one video");
  });
});

describe("publishChannel", () => {
  it("asks to connect a channel without keys", async () => {
    const none = { x: () => null, bluesky: () => null, linkedin: () => null, meta: () => null, tiktok: () => null };
    await expect(publishChannel("instagram", "x", [image()], none, fakeEnv([]))).rejects.toThrow("Instagram is not connected");
  });
});
