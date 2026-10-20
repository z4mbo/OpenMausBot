import { useSyncExternalStore } from "react";
import { channelProblems, reelProblems, type BroadcastChannel, type BroadcastFormat, type BroadcastReel } from "../../shared/broadcast";
import type { BroadcastPost, BroadcastVariant } from "../../src/components/origin-broadcast/broadcast-model";

const listeners = new Set<() => void>();
let revision = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;
const changed = () => { revision++; for (const listener of listeners) listener(); };

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">${body}</svg>`)}`;
const cover = svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#4338ca"/></linearGradient></defs>
<rect width="1080" height="1080" fill="url(#g)"/><circle cx="820" cy="260" r="220" fill="#818cf8" opacity=".35"/><circle cx="900" cy="760" r="120" fill="#c7d2fe" opacity=".25"/>
<text x="90" y="560" font-family="Segoe UI, Helvetica, Arial" font-weight="700" font-size="128" fill="#fff">Origin 0.6</text>
<text x="94" y="650" font-family="Segoe UI, Helvetica, Arial" font-size="48" fill="#c7d2fe">Idea to launch, in one app</text>`);
const team = svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f97316"/></linearGradient></defs>
<rect width="1080" height="1080" fill="url(#g)"/><g fill="#7c2d12" opacity=".85"><circle cx="300" cy="520" r="110"/><circle cx="540" cy="470" r="130"/><circle cx="780" cy="520" r="110"/>
<rect x="170" y="640" width="260" height="440" rx="120"/><rect x="400" y="610" width="280" height="470" rx="130"/><rect x="650" y="640" width="260" height="440" rx="120"/></g>`);
const dashboard = svg(`<rect width="1080" height="1080" fill="#0f172a"/><rect x="90" y="120" width="900" height="840" rx="40" fill="#1e293b"/>
<rect x="150" y="190" width="300" height="40" rx="12" fill="#334155"/><g fill="#38bdf8"><rect x="150" y="700" width="90" height="180" rx="12"/><rect x="280" y="600" width="90" height="280" rx="12"/><rect x="410" y="520" width="90" height="360" rx="12"/><rect x="540" y="420" width="90" height="460" rx="12"/></g>
<rect x="700" y="300" width="230" height="580" rx="24" fill="#0ea5e9" opacity=".25"/>`);

type Asset = { _id: string; type: string; name: string; fileUrl: string; contentType: string; updatedAt: number };
const assets: Asset[] = [
  { _id: "asset-cover", type: "image", name: "Launch cover", fileUrl: cover, contentType: "image/png", updatedAt: 5 },
  { _id: "asset-team", type: "image", name: "Team photo", fileUrl: team, contentType: "image/png", updatedAt: 4 },
  { _id: "asset-dashboard", type: "image", name: "Pulse dashboard", fileUrl: dashboard, contentType: "image/png", updatedAt: 3 },
  { _id: "asset-reel", type: "video", name: "Product reel.webm", fileUrl: "", contentType: "video/webm", updatedAt: 2 },
  { _id: "asset-clip", type: "other", name: "Studio teaser.mp4", fileUrl: "https://cdn.fixture.test/teaser.mp4", contentType: "video/mp4", updatedAt: 1 },
  { _id: "asset-deck", type: "document", name: "Pitch deck.pdf", fileUrl: "https://cdn.fixture.test/deck.pdf", contentType: "application/pdf", updatedAt: 0 },
];

/** A four-second 9:16 clip recorded from a canvas, so the reel editor has real frames to show without any network. */
async function recordClip(): Promise<string> {
  const canvas = Object.assign(document.createElement("canvas"), { width: 360, height: 640 });
  const ctx = canvas.getContext("2d")!;
  const scenes = [["#0b1020", "#6366f1", "Origin"], ["#111827", "#10b981", "Studio"], ["#1f1135", "#ec4899", "Broadcast"], ["#1c1917", "#f59e0b", "Ship"]] as const;
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm;codecs=vp8" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const started = performance.now();
  const draw = () => {
    const t = (performance.now() - started) / 1000;
    const [bg, accent, word] = scenes[Math.min(scenes.length - 1, Math.floor(t))];
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 360, 640);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(180 + Math.sin(t * 2) * 60, 250, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.font = "700 44px Segoe UI, Helvetica, Arial";
    ctx.textAlign = "center";
    ctx.fillText(word, 180, 300);
    ctx.font = "20px Segoe UI, Helvetica, Arial";
    ctx.fillText(`0${Math.floor(t) + 1} / 04`, 180, 340);
    if (t < 4) requestAnimationFrame(draw);
  };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start(250);
  draw();
  await new Promise((resolve) => setTimeout(resolve, 4_100));
  recorder.stop();
  await stopped;
  return URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
}
const clipReady = recordClip().then((url) => {
  assets.find((asset) => asset._id === "asset-reel")!.fileUrl = url;
  for (const post of posts) post.media = mediaOf(post.assetIds);
  changed();
});

const kindOf = (id: string) => { const asset = assets.find((item) => item._id === id); return asset?.contentType.startsWith("video/") ? "video" as const : asset?.contentType.startsWith("image/") ? "image" as const : "other" as const; };
const mediaOf = (ids: string[]) => ids.map((id) => { const asset = assets.find((item) => item._id === id)!; return { assetId: id, name: asset.name, url: asset.fileUrl || null, contentType: asset.contentType, kind: kindOf(id) }; });

const day = (offset: number, hour: number) => { const at = new Date(); at.setDate(at.getDate() + offset); at.setHours(hour, 0, 0, 0); return at.getTime(); };
/** The most recent past `weekday` (0 Sunday) at `hour`, `weeksAgo` weeks back. */
const past = (weekday: number, hour: number, weeksAgo: number) => { const at = new Date(); at.setDate(at.getDate() - ((at.getDay() - weekday + 7) % 7 || 7) - 7 * weeksAgo); at.setHours(hour, 0, 0, 0); return at.getTime(); };
const measured = (id: string, channel: BroadcastChannel, text: string, publishedAt: number, likes: number, reposts: number, replies: number): BroadcastPost => ({
  _id: id, projectId: "fixture-project", status: "published", createdAt: 1, updatedAt: 1, assetIds: [], media: [], needsApproval: false,
  variants: [{ channel, text, result: "published", url: `https://x.com/i/web/status/${id}`, publishedAt, metrics: { likes, reposts, replies, at: Date.now() } }],
});

let nextId = 1;
const posts: BroadcastPost[] = [
  { _id: "post-agent", projectId: "fixture-project", status: "draft", agentName: "Echo", needsApproval: true, createdAt: 1, updatedAt: 9, assetIds: ["asset-cover"], media: mediaOf(["asset-cover"]),
    variants: [{ channel: "x", text: "Origin 0.6 is out: Studio and Publish in one app. https://origin.test/0.6" }, { channel: "linkedin", text: "Origin 0.6 is out. Your team and its agents now plan, generate and publish launch content in one place. #launch #buildinpublic" }] },
  { _id: "post-scheduled", projectId: "fixture-project", status: "scheduled", scheduledAt: day(1, 10), createdAt: 2, updatedAt: 8, assetIds: ["asset-team"], media: mediaOf(["asset-team"]),
    variants: [{ channel: "bluesky", text: "Meet the team behind Origin." }, { channel: "instagram", text: "Meet the team behind Origin. #team #startup" }] },
  { _id: "post-reel", projectId: "fixture-project", status: "scheduled", format: "reel", reel: { coverMs: 2_500, music: "Nightcall · Kavinsky" }, scheduledAt: day(3, 18), createdAt: 3, updatedAt: 7,
    assetIds: ["asset-reel"], media: mediaOf(["asset-reel"]),
    variants: [{ channel: "instagram", text: "From idea to launch in four scenes. #buildinpublic #saas" }, { channel: "tiktok", text: "From idea to launch in four scenes 🚀 #buildinpublic", accountId: "acct-founder-tt", accountLabel: "Founder" }] },
  { _id: "post-later", projectId: "fixture-project", status: "scheduled", scheduledAt: day(9, 9), createdAt: 4, updatedAt: 6, assetIds: ["asset-dashboard"], media: mediaOf(["asset-dashboard"]),
    variants: [{ channel: "x", text: "Pulse shows every project's numbers on one page.", accountId: "acct-founder-x", accountLabel: "Founder" }, { channel: "linkedin", text: "Pulse shows every project's numbers on one page. Here's how we use it every Monday." }] },
  { _id: "post-published", projectId: "fixture-project", status: "published", createdAt: 5, updatedAt: 5, assetIds: [], media: [],
    variants: [{ channel: "x", text: "We are hiring a designer.", result: "published", url: "https://x.com/i/web/status/1", publishedAt: day(-1, 16), metrics: { likes: 31, reposts: 6, replies: 4, at: Date.now() } }] },
  measured("hist-1", "x", "Shipping notes, week 38.", past(2, 9, 1), 120, 18, 12),
  measured("hist-2", "x", "Shipping notes, week 37.", past(2, 9, 2), 96, 14, 9),
  measured("hist-3", "x", "A thread on how agents draft our posts.", past(4, 9, 1), 74, 9, 15),
  measured("hist-4", "x", "Friday demo clip.", past(5, 17, 1), 12, 1, 2),
  measured("hist-5", "x", "Weekend reading list.", past(6, 11, 1), 8, 0, 1),
  { _id: "post-failed", projectId: "fixture-project", status: "failed", createdAt: 6, updatedAt: 4, assetIds: ["asset-clip"], media: mediaOf(["asset-clip"]),
    variants: [{ channel: "tiktok", text: "Behind the scenes", result: "failed", error: "TikTok answered 401: The access token is invalid" }] },
];

const requests: { name: string; args: Record<string, unknown> }[] = [];
Object.assign(window, { originBroadcastFixture: { requests, posts, clipReady } });

export const cloudUrl = () => location.origin;
export const useCloudUrl = cloudUrl;
export const sessionStore = { get: () => "origin-broadcast-fixture-token" };
export const useCloudSession = () => ({ token: sessionStore.get(), user: { _id: "fixture-user" }, ready: true });
export const setCloudUrl = () => {};
export const setSessionToken = () => {};
export const logoutCloud = async () => {};
export const createOriginWorkspace = async () => ({ teamId: "fixture-team" });
export const cloud = {};
export const CloudProvider = ({ children }: { children: unknown }) => children;
export const cloudQueryOnce = async () => null;
export const useCloudPages = () => ({ results: [], status: "done", loadMore() {} });
const viewer = () => new URLSearchParams(location.search).has("viewer");

export function useCloudQuery<T>(name: string): T | undefined {
  useSyncExternalStore(subscribe, snapshot);
  if (name === "projects:get") return { _id: "fixture-project", teamId: "fixture-team", name: "Origin", memberRole: viewer() ? "viewer" : "owner" } as T;
  if (name === "broadcast:list") return { canEdit: !viewer(), posts: posts.map((post) => ({ ...post, variants: post.variants.map((variant) => ({ ...variant })) })) } as T;
  if (name === "design:list") return { assets: assets.filter((asset) => asset.fileUrl), tokens: [] } as T;
  return undefined;
}

function find(id: unknown): BroadcastPost {
  const post = posts.find((item) => item._id === id);
  if (!post) throw new Error("Post not found");
  return post;
}

type VariantInput = { channel: BroadcastChannel; text: string; accountId?: string; accountLabel?: string };

export async function cloudMutation<T>(name: string, args: Record<string, unknown>): Promise<T> {
  requests.push({ name, args });
  await new Promise((resolve) => setTimeout(resolve, 60));
  let result: unknown = null;
  if (name === "broadcast:save") {
    const variants: BroadcastVariant[] = (args.variants as VariantInput[]).map((variant) => ({ ...variant }));
    const assetIds = args.assetIds as string[];
    const format = (args.format as BroadcastFormat | undefined) ?? "post";
    const shape = { format, reel: format === "reel" ? args.reel as BroadcastReel | undefined : undefined };
    if (args.postId) {
      const post = find(args.postId);
      Object.assign(post, { ...shape, variants: variants.map((variant) => post.variants.find((old) => old.channel === variant.channel && old.result === "published") ?? variant), assetIds, media: mediaOf(assetIds), updatedAt: Date.now(), ...(post.status === "failed" ? { status: "draft" } : {}) });
      result = post._id;
    } else {
      const post: BroadcastPost = { _id: `post-new-${nextId++}`, projectId: "fixture-project", status: "draft", ...shape, variants, assetIds, media: mediaOf(assetIds), needsApproval: false, createdAt: Date.now(), updatedAt: Date.now() };
      posts.unshift(post);
      result = post._id;
    }
  } else if (name === "broadcast:approve") {
    Object.assign(find(args.postId), { needsApproval: false, approvedAt: Date.now() });
  } else if (name === "broadcast:schedule") {
    const post = find(args.postId);
    if (post.needsApproval) throw new Error("A person must approve this post before it is scheduled");
    const open = post.variants.filter((variant) => variant.result !== "published");
    const kinds = post.assetIds.map(kindOf);
    const problems = [...(post.format === "reel" ? reelProblems(open.map((variant) => variant.channel), kinds) : []), ...open.flatMap((variant) => channelProblems(variant.channel, variant.text, kinds))];
    if (problems.length) throw new Error(problems.join("; "));
    const at = Math.max(Number(args.at ?? Date.now()), Date.now());
    Object.assign(post, { status: "scheduled", scheduledAt: at, variants: post.variants.map((variant) => variant.result === "published" ? variant : { channel: variant.channel, text: variant.text, ...(variant.accountId ? { accountId: variant.accountId, accountLabel: variant.accountLabel } : {}) }) });
    result = at;
  } else if (name === "broadcast:reschedule") {
    const post = find(args.postId);
    if (post.status !== "scheduled") throw new Error("Only a scheduled post can be moved");
    if (Number(args.at) <= Date.now()) throw new Error("Choose a time in the future");
    Object.assign(post, { scheduledAt: Number(args.at), updatedAt: Date.now() });
    result = args.at;
  } else if (name === "broadcast:unschedule") {
    Object.assign(find(args.postId), { status: "draft", scheduledAt: undefined });
  } else if (name === "broadcast:remove") {
    posts.splice(posts.indexOf(find(args.postId)), 1);
  }
  changed();
  return result as T;
}
export const cloudAction = cloudMutation;
