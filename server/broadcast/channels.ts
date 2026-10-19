import { randomBytes } from "node:crypto";
import { BROADCAST_RULES, type BroadcastChannel } from "../../shared/broadcast.ts";
import type { IntegrationValues } from "../integration-keys.ts";
import { oauth1Header } from "./oauth1.ts";

export interface PublishMedia {
  name: string;
  kind: "image" | "video";
  contentType: string;
  /** A public https address of the file (Instagram and Facebook fetch it themselves). */
  url: string;
  bytes(): Promise<Uint8Array>;
}

export interface PublishEnv {
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  nonce(): string;
  /** Unix milliseconds. */
  now(): number;
}

export const defaultPublishEnv: PublishEnv = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nonce: () => randomBytes(16).toString("hex"),
  now: () => Date.now(),
};

/** Where the published post lives, when the channel says. */
export interface Published {
  url?: string;
}

export class PublishError extends Error {}

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const text = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

async function readJson(response: Response): Promise<Json> {
  const body = await response.text();
  try {
    return record(JSON.parse(body));
  } catch {
    return { message: body.slice(0, 300) };
  }
}

function vendorMessage(body: Json): string {
  const error = record(body.error);
  const first = Array.isArray(body.errors) ? record(body.errors[0]) : {};
  return [text(body.detail), text(error.message), text(body.message), text(first.message), text(body.error_description), text(body.title), typeof body.error === "string" ? body.error : ""]
    .find(Boolean)?.slice(0, 300) ?? "";
}

async function expectOk(label: string, response: Response): Promise<Json> {
  const body = await readJson(response);
  if (!response.ok) throw new PublishError(`${label} answered ${response.status}${vendorMessage(body) ? `: ${vendorMessage(body)}` : ""}`);
  return body;
}

function blobOf(data: Uint8Array, contentType: string): Blob {
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: contentType });
}

const POLL_MS = 3_000;
const POLL_TRIES = 60;

async function poll<T>(env: PublishEnv, label: string, check: () => Promise<T | null>): Promise<T> {
  for (let attempt = 0; attempt < POLL_TRIES; attempt += 1) {
    const done = await check();
    if (done !== null) return done;
    await env.sleep(POLL_MS);
  }
  throw new PublishError(`${label} was still processing the media after ${Math.round((POLL_MS * POLL_TRIES) / 60_000)} minutes`);
}

const X_API = "https://api.x.com/2";
/** X's simple upload takes one request up to this size; larger files and every video use the chunked upload. */
const X_SIMPLE_MAX = 5 * 1024 * 1024;
const X_CHUNK = 4 * 1024 * 1024;

export async function publishX(credentials: IntegrationValues<"x">, body: string, media: readonly PublishMedia[], env = defaultPublishEnv): Promise<Published> {
  const signed = (method: string, url: string, init: RequestInit = {}) => env.fetch(url, {
    ...init, method,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: oauth1Header(method, url, credentials, { nonce: env.nonce(), timestamp: Math.floor(env.now() / 1000) }) },
  });
  const mediaIds: string[] = [];
  for (const item of media) {
    const data = await item.bytes();
    const category = item.kind === "video" ? "tweet_video" : "tweet_image";
    if (item.kind === "image" && data.byteLength <= X_SIMPLE_MAX) {
      const form = new FormData();
      form.append("media", blobOf(data, item.contentType), item.name);
      form.append("media_category", category);
      const uploaded = await expectOk("X media upload", await signed("POST", `${X_API}/media/upload`, { body: form }));
      mediaIds.push(text(record(uploaded.data).id) || refuse("X media upload returned no id"));
      continue;
    }
    const init = await expectOk("X media upload", await signed("POST", `${X_API}/media/upload/initialize`, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: item.contentType, total_bytes: data.byteLength, media_category: category }),
    }));
    const id = text(record(init.data).id) || refuse("X media upload returned no id");
    for (let index = 0, offset = 0; offset < data.byteLength; index += 1, offset += X_CHUNK) {
      const form = new FormData();
      form.append("segment_index", String(index));
      form.append("media", blobOf(data.subarray(offset, offset + X_CHUNK), "application/octet-stream"), item.name);
      await expectOk("X media upload", await signed("POST", `${X_API}/media/upload/${id}/append`, { body: form }));
    }
    let info = record(record((await expectOk("X media upload", await signed("POST", `${X_API}/media/upload/${id}/finalize`))).data).processing_info);
    if (Object.keys(info).length) {
      await poll(env, "X", async () => {
        const state = text(info.state);
        if (state === "succeeded") return true;
        if (state === "failed") throw new PublishError(`X could not process ${item.name}: ${text(record(info.error).message) || "failed"}`);
        await env.sleep(Math.max(0, Number(info.check_after_secs) || 0) * 1_000);
        info = record(record((await expectOk("X media status", await signed("GET", `${X_API}/media/upload?command=STATUS&media_id=${encodeURIComponent(id)}`))).data).processing_info);
        return text(info.state) === "succeeded" ? true : null;
      });
    }
    mediaIds.push(id);
  }
  const created = await expectOk("X", await signed("POST", `${X_API}/tweets`, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: body, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
  }));
  const id = text(record(created.data).id);
  return id ? { url: `https://x.com/i/web/status/${id}` } : {};
}

const BLUESKY = "https://bsky.social/xrpc";
/** Bluesky's blob limit for a post image. */
const BLUESKY_IMAGE_MAX = 1_000_000;
const LINK = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;

/** Bluesky marks links by UTF-8 byte ranges, or they show as plain text. */
export function linkFacets(body: string): Json[] {
  const encoder = new TextEncoder();
  return [...body.matchAll(LINK)].map((match) => {
    const start = encoder.encode(body.slice(0, match.index)).byteLength;
    return { index: { byteStart: start, byteEnd: start + encoder.encode(match[0]).byteLength }, features: [{ $type: "app.bsky.richtext.facet#link", uri: match[0] }] };
  });
}

export async function publishBluesky(credentials: IntegrationValues<"bluesky">, body: string, media: readonly PublishMedia[], env = defaultPublishEnv): Promise<Published> {
  const session = await expectOk("Bluesky sign-in", await env.fetch(`${BLUESKY}/com.atproto.server.createSession`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: credentials.handle.replace(/^@/, ""), password: credentials.appPassword }),
  }));
  const auth = { Authorization: `Bearer ${text(session.accessJwt)}` };
  const did = text(session.did) || refuse("Bluesky returned no account id");
  const images: Json[] = [];
  for (const item of media) {
    if (item.kind !== "image") throw new PublishError("Bluesky posts here take images only");
    const data = await item.bytes();
    if (data.byteLength > BLUESKY_IMAGE_MAX) throw new PublishError(`${item.name} is over Bluesky's 1 MB image limit`);
    const uploaded = await expectOk("Bluesky image upload", await env.fetch(`${BLUESKY}/com.atproto.repo.uploadBlob`, {
      method: "POST", headers: { ...auth, "Content-Type": item.contentType }, body: blobOf(data, item.contentType),
    }));
    images.push({ alt: "", image: uploaded.blob });
  }
  const facets = linkFacets(body);
  const created = await expectOk("Bluesky", await env.fetch(`${BLUESKY}/com.atproto.repo.createRecord`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      repo: did, collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post", text: body, createdAt: new Date(env.now()).toISOString(),
        ...(facets.length ? { facets } : {}),
        ...(images.length ? { embed: { $type: "app.bsky.embed.images", images } } : {}),
      },
    }),
  }));
  const rkey = text(created.uri).split("/").pop();
  return rkey ? { url: `https://bsky.app/profile/${text(session.handle) || did}/post/${rkey}` } : {};
}

const LINKEDIN = "https://api.linkedin.com/rest";
/** LinkedIn's versioned API needs a YYYYMM version it still supports; each one is retired about a year after release. */
export const LINKEDIN_VERSION = "202608";

/** LinkedIn's "little text" commentary treats these characters as markup; hashtags become its hashtag template. */
export function linkedInCommentary(body: string): string {
  return body.split(/(#[\p{L}\p{N}_]+)/u).map((part, index) => index % 2
    ? `{hashtag|\\#|${part.slice(1)}}`
    : part.replace(/[\\|{}@[\]()<>#*_~]/g, (char) => `\\${char}`)).join("");
}

export async function publishLinkedIn(credentials: IntegrationValues<"linkedin">, body: string, media: readonly PublishMedia[], env = defaultPublishEnv): Promise<Published> {
  const headers = { Authorization: `Bearer ${credentials.accessToken}`, "LinkedIn-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0" };
  const author = credentials.authorUrn.trim();
  if (!/^urn:li:(person|organization):\S+$/.test(author)) throw new PublishError("The LinkedIn author must be a urn:li:person or urn:li:organization");
  const imageIds: string[] = [];
  for (const item of media) {
    if (item.kind !== "image") throw new PublishError("LinkedIn posts here take images only");
    const init = await expectOk("LinkedIn image upload", await env.fetch(`${LINKEDIN}/images?action=initializeUpload`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
    }));
    const value = record(init.value);
    const uploadUrl = text(value.uploadUrl);
    if (!uploadUrl.startsWith("https://")) throw new PublishError("LinkedIn returned no upload address");
    const uploaded = await env.fetch(uploadUrl, { method: "PUT", headers: { Authorization: headers.Authorization, "Content-Type": item.contentType }, body: blobOf(await item.bytes(), item.contentType) });
    if (!uploaded.ok) throw new PublishError(`LinkedIn image upload answered ${uploaded.status}`);
    imageIds.push(text(value.image) || refuse("LinkedIn returned no image id"));
  }
  const content = imageIds.length === 1 ? { media: { id: imageIds[0] } } : imageIds.length ? { multiImage: { images: imageIds.map((id) => ({ id })) } } : undefined;
  const response = await env.fetch(`${LINKEDIN}/posts`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      author, commentary: linkedInCommentary(body), visibility: "PUBLIC", lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(content ? { content } : {}),
    }),
  });
  await expectOk("LinkedIn", response);
  const urn = response.headers.get("x-restli-id") ?? response.headers.get("x-linkedin-id") ?? "";
  return urn ? { url: `https://www.linkedin.com/feed/update/${urn}/` } : {};
}

const GRAPH = "https://graph.facebook.com/v23.0";

function graph(env: PublishEnv, token: string) {
  const call = async (label: string, method: "GET" | "POST", path: string, params: Record<string, string> = {}) => {
    const query = new URLSearchParams({ ...params, access_token: token });
    const response = method === "GET"
      ? await env.fetch(`${GRAPH}/${path}?${query}`)
      : await env.fetch(`${GRAPH}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: query.toString() });
    return expectOk(label, response);
  };
  return call;
}

async function facebookPageId(call: ReturnType<typeof graph>, credentials: IntegrationValues<"meta">): Promise<string> {
  return credentials.facebookPageId?.trim() || text((await call("Facebook", "GET", "me", { fields: "id" })).id) || refuse("Facebook returned no page for this token");
}

export async function publishFacebook(credentials: IntegrationValues<"meta">, body: string, media: readonly PublishMedia[], env = defaultPublishEnv): Promise<Published> {
  const call = graph(env, credentials.pageAccessToken);
  const page = await facebookPageId(call, credentials);
  const video = media.find((item) => item.kind === "video");
  if (video) {
    const posted = await call("Facebook video", "POST", `${page}/videos`, { file_url: video.url, description: body });
    return text(posted.id) ? { url: `https://www.facebook.com/${page}/videos/${text(posted.id)}` } : {};
  }
  if (media.length === 1) {
    const posted = await call("Facebook photo", "POST", `${page}/photos`, { url: media[0].url, caption: body });
    const id = text(posted.post_id) || text(posted.id);
    return id ? { url: `https://www.facebook.com/${id}` } : {};
  }
  const attached: Record<string, string> = {};
  for (const [index, item] of media.entries()) {
    const photo = await call("Facebook photo", "POST", `${page}/photos`, { url: item.url, published: "false" });
    attached[`attached_media[${index}]`] = JSON.stringify({ media_fbid: text(photo.id) });
  }
  const posted = await call("Facebook", "POST", `${page}/feed`, { message: body, ...attached });
  return text(posted.id) ? { url: `https://www.facebook.com/${text(posted.id)}` } : {};
}

export async function publishInstagram(credentials: IntegrationValues<"meta">, body: string, media: readonly PublishMedia[], env = defaultPublishEnv): Promise<Published> {
  if (!media.length) throw new PublishError("Instagram needs an image or a video");
  const call = graph(env, credentials.pageAccessToken);
  let account = credentials.instagramUserId?.trim() ?? "";
  if (!account) {
    const page = await facebookPageId(call, credentials);
    account = text(record((await call("Instagram", "GET", page, { fields: "instagram_business_account" })).instagram_business_account).id)
      || refuse("This Facebook page has no Instagram professional account linked");
  }
  const ready = (container: string) => poll(env, "Instagram", async () => {
    const status = text((await call("Instagram", "GET", container, { fields: "status_code" })).status_code);
    if (status === "ERROR" || status === "EXPIRED") throw new PublishError(`Instagram could not process the media (${status})`);
    return status === "FINISHED" || status === "PUBLISHED" ? container : null;
  });
  const source = (item: PublishMedia): Record<string, string> => item.kind === "video" ? { video_url: item.url } : { image_url: item.url };
  let container: string;
  if (media.length === 1) {
    const item = media[0];
    container = text((await call("Instagram", "POST", `${account}/media`, { ...source(item), ...(item.kind === "video" ? { media_type: "REELS" } : {}), caption: body })).id);
  } else {
    const children: string[] = [];
    for (const item of media) {
      const child = text((await call("Instagram", "POST", `${account}/media`, { ...source(item), ...(item.kind === "video" ? { media_type: "VIDEO" } : {}), is_carousel_item: "true" })).id);
      children.push(await ready(child || refuse("Instagram returned no media id")));
    }
    container = text((await call("Instagram", "POST", `${account}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: body })).id);
  }
  await ready(container || refuse("Instagram returned no media id"));
  const published = text((await call("Instagram", "POST", `${account}/media_publish`, { creation_id: container })).id) || refuse("Instagram returned no post id");
  const permalink = text((await call("Instagram", "GET", published, { fields: "permalink" }).catch(() => ({} as Json))).permalink);
  return permalink ? { url: permalink } : {};
}

const TIKTOK = "https://open.tiktokapis.com/v2/post/publish";
/** TikTok takes a file up to 64 MB as one chunk; larger ones go in chunks of 5–64 MB, the last one holding the remainder. */
const TIKTOK_SINGLE_MAX = 64 * 1024 * 1024;
const TIKTOK_CHUNK = 10 * 1024 * 1024;

export function tiktokChunks(size: number): { chunkSize: number; count: number } {
  if (size <= TIKTOK_SINGLE_MAX) return { chunkSize: size, count: 1 };
  return { chunkSize: TIKTOK_CHUNK, count: Math.floor(size / TIKTOK_CHUNK) };
}

export async function publishTikTok(credentials: IntegrationValues<"tiktok">, body: string, media: readonly PublishMedia[], env = defaultPublishEnv): Promise<Published> {
  const video = media.length === 1 && media[0].kind === "video" ? media[0] : refuse("TikTok needs exactly one video");
  const headers = { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json; charset=UTF-8" };
  const api = async (label: string, path: string, payload: Json = {}) => {
    const answer = await expectOk(label, await env.fetch(`${TIKTOK}/${path}`, { method: "POST", headers, body: JSON.stringify(payload) }));
    const error = record(answer.error);
    if (text(error.code) && text(error.code) !== "ok") throw new PublishError(`${label}: ${text(error.message) || text(error.code)}`);
    return record(answer.data);
  };
  const creator = await api("TikTok", "creator_info/query/");
  const options = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options.map(text) : [];
  const privacy = options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0] || refuse("TikTok offers this account no way to post");
  const data = await video.bytes();
  const { chunkSize, count } = tiktokChunks(data.byteLength);
  const init = await api("TikTok", "video/init/", {
    post_info: { title: body, privacy_level: privacy },
    source_info: { source: "FILE_UPLOAD", video_size: data.byteLength, chunk_size: chunkSize, total_chunk_count: count },
  });
  const uploadUrl = text(init.upload_url);
  const publishId = text(init.publish_id) || refuse("TikTok returned no publish id");
  if (!uploadUrl.startsWith("https://")) throw new PublishError("TikTok returned no upload address");
  for (let index = 0; index < count; index += 1) {
    const start = index * chunkSize;
    const end = index === count - 1 ? data.byteLength : start + chunkSize;
    const uploaded = await env.fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": video.contentType, "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${data.byteLength}` },
      body: blobOf(data.subarray(start, end), video.contentType),
    });
    if (!uploaded.ok) throw new PublishError(`TikTok video upload answered ${uploaded.status}`);
  }
  const profile = text(creator.creator_username) ? `https://www.tiktok.com/@${text(creator.creator_username)}` : "";
  return poll(env, "TikTok", async () => {
    const status = await api("TikTok", "status/fetch/", { publish_id: publishId });
    const state = text(status.status);
    if (state === "FAILED") throw new PublishError(`TikTok could not publish the video: ${text(status.fail_reason) || "failed"}`);
    if (state !== "PUBLISH_COMPLETE") return null;
    const ids = Array.isArray(status.publicaly_available_post_id) ? status.publicaly_available_post_id.map(text).filter(Boolean) : [];
    return profile && ids[0] ? { url: `${profile}/video/${ids[0]}` } : profile ? { url: profile } : {};
  });
}

function refuse(message: string): never {
  throw new PublishError(message);
}

/** Each channel's credentials as the member stored them, or null when that integration is not connected. */
export type ChannelKeys = { [I in "x" | "bluesky" | "linkedin" | "meta" | "tiktok"]: () => IntegrationValues<I> | null };

export async function publishChannel(channel: BroadcastChannel, body: string, media: readonly PublishMedia[], keys: ChannelKeys, env = defaultPublishEnv): Promise<Published> {
  const missing = (): never => refuse(`${BROADCAST_RULES[channel].label} is not connected; add its keys in Settings, Integrations`);
  switch (channel) {
    case "x": return publishX(keys.x() ?? missing(), body, media, env);
    case "bluesky": return publishBluesky(keys.bluesky() ?? missing(), body, media, env);
    case "linkedin": return publishLinkedIn(keys.linkedin() ?? missing(), body, media, env);
    case "facebook": return publishFacebook(keys.meta() ?? missing(), body, media, env);
    case "instagram": return publishInstagram(keys.meta() ?? missing(), body, media, env);
    case "tiktok": return publishTikTok(keys.tiktok() ?? missing(), body, media, env);
  }
}
