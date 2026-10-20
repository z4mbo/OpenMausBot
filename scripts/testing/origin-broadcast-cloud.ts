import { useSyncExternalStore } from "react";
import { channelProblems, type BroadcastChannel } from "../../shared/broadcast";
import type { BroadcastPost } from "../../src/components/origin-broadcast/broadcast-model";

const listeners = new Set<() => void>();
let revision = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;
const changed = () => { revision++; for (const listener of listeners) listener(); };

const swatch = (fill: string, label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="${fill}"/><text x="24" y="290" font-family="sans-serif" font-size="28" fill="white">${label}</text></svg>`)}`;
const assets = [
  { _id: "asset-cover", type: "image", name: "Launch cover", fileUrl: swatch("#3b5bdb", "cover"), contentType: "image/png", updatedAt: 3 },
  { _id: "asset-team", type: "image", name: "Team photo", fileUrl: swatch("#2b8a3e", "team"), contentType: "image/png", updatedAt: 2 },
  { _id: "asset-clip", type: "other", name: "Studio teaser.mp4", fileUrl: "https://cdn.fixture.test/teaser.mp4", contentType: "video/mp4", updatedAt: 1 },
  { _id: "asset-deck", type: "document", name: "Pitch deck.pdf", fileUrl: "https://cdn.fixture.test/deck.pdf", contentType: "application/pdf", updatedAt: 0 },
];
const kindOf = (id: string) => { const asset = assets.find((item) => item._id === id); return asset?.contentType.startsWith("video/") ? "video" as const : asset?.contentType.startsWith("image/") ? "image" as const : "other" as const; };
const mediaOf = (ids: string[]) => ids.map((id) => { const asset = assets.find((item) => item._id === id)!; return { assetId: id, name: asset.name, url: asset.fileUrl, contentType: asset.contentType, kind: kindOf(id) }; });

const day = (offset: number, hour: number) => { const at = new Date(); at.setDate(at.getDate() + offset); at.setHours(hour, 0, 0, 0); return at.getTime(); };
let nextId = 1;
const posts: BroadcastPost[] = [
  { _id: "post-agent", projectId: "fixture-project", status: "draft", agentName: "Echo", needsApproval: true, createdAt: 1, updatedAt: 5, assetIds: ["asset-cover"], media: mediaOf(["asset-cover"]),
    variants: [{ channel: "x", text: "Origin 0.3 is out: Studio, Broadcast and Pipeline in one app. https://origin.test/0.3" }, { channel: "linkedin", text: "Origin 0.3 is out. Your team and its agents now plan, generate and publish launch content in one place. #launch #buildinpublic" }] },
  { _id: "post-scheduled", projectId: "fixture-project", status: "scheduled", scheduledAt: day(1, 10), createdAt: 2, updatedAt: 4, assetIds: ["asset-team"], media: mediaOf(["asset-team"]),
    variants: [{ channel: "bluesky", text: "Meet the team behind Origin." }, { channel: "instagram", text: "Meet the team behind Origin." }] },
  { _id: "post-published", projectId: "fixture-project", status: "published", createdAt: 3, updatedAt: 3, assetIds: [], media: [],
    variants: [{ channel: "x", text: "We are hiring a designer.", result: "published", url: "https://x.com/i/web/status/1", publishedAt: day(-1, 16) }] },
  { _id: "post-failed", projectId: "fixture-project", status: "failed", createdAt: 4, updatedAt: 2, scheduledAt: undefined, assetIds: ["asset-clip"], media: mediaOf(["asset-clip"]),
    variants: [{ channel: "tiktok", text: "Behind the scenes", result: "failed", error: "TikTok answered 401: The access token is invalid" }] },
];

const requests: { name: string; args: Record<string, unknown> }[] = [];
Object.assign(window, { originBroadcastFixture: { requests, posts } });

export const cloudUrl = () => location.origin;
export const useCloudUrl = cloudUrl;
export const sessionStore = { get: () => "origin-broadcast-fixture-token" };
export const useCloudSession = () => ({ token: sessionStore.get(), user: { _id: "fixture-user" }, ready: true });
export const setCloudUrl = () => {};
export const setSessionToken = () => {};
export const logoutCloud = async () => {};
export const cloud = {};
export const CloudProvider = ({ children }: { children: unknown }) => children;
export const cloudQueryOnce = async () => null;
export const useCloudPages = () => ({ results: [], status: "done", loadMore() {} });
const viewer = () => new URLSearchParams(location.search).has("viewer");

export function useCloudQuery<T>(name: string): T | undefined {
  useSyncExternalStore(subscribe, snapshot);
  if (name === "projects:get") return { _id: "fixture-project", teamId: "fixture-team", name: "Fixture project", memberRole: viewer() ? "viewer" : "owner" } as T;
  if (name === "broadcast:list") return { canEdit: !viewer(), posts: posts.map((post) => ({ ...post, variants: post.variants.map((variant) => ({ ...variant })) })) } as T;
  if (name === "design:list") return { assets, tokens: [] } as T;
  return undefined;
}

function find(id: unknown): BroadcastPost {
  const post = posts.find((item) => item._id === id);
  if (!post) throw new Error("Post not found");
  return post;
}

export async function cloudMutation<T>(name: string, args: Record<string, unknown>): Promise<T> {
  requests.push({ name, args });
  await new Promise((resolve) => setTimeout(resolve, 60));
  let result: unknown = null;
  if (name === "broadcast:save") {
    const variants = (args.variants as { channel: BroadcastChannel; text: string }[]).map((variant) => ({ ...variant }));
    const assetIds = args.assetIds as string[];
    if (args.postId) {
      const post = find(args.postId);
      Object.assign(post, { variants: variants.map((variant) => post.variants.find((old) => old.channel === variant.channel && old.result === "published") ?? variant), assetIds, media: mediaOf(assetIds), updatedAt: Date.now(), ...(post.status === "failed" ? { status: "draft" } : {}) });
      result = post._id;
    } else {
      const post: BroadcastPost = { _id: `post-new-${nextId++}`, projectId: "fixture-project", status: "draft", variants, assetIds, media: mediaOf(assetIds), needsApproval: false, createdAt: Date.now(), updatedAt: Date.now() };
      posts.unshift(post);
      result = post._id;
    }
  } else if (name === "broadcast:approve") {
    Object.assign(find(args.postId), { needsApproval: false, approvedAt: Date.now() });
  } else if (name === "broadcast:schedule") {
    const post = find(args.postId);
    if (post.needsApproval) throw new Error("A person must approve this post before it is scheduled");
    const problems = post.variants.filter((variant) => variant.result !== "published").flatMap((variant) => channelProblems(variant.channel, variant.text, post.assetIds.map(kindOf)));
    if (problems.length) throw new Error(problems.join("; "));
    const at = Math.max(Number(args.at ?? Date.now()), Date.now());
    Object.assign(post, { status: "scheduled", scheduledAt: at, variants: post.variants.map((variant) => variant.result === "published" ? variant : { channel: variant.channel, text: variant.text }) });
    result = at;
  } else if (name === "broadcast:unschedule") {
    Object.assign(find(args.postId), { status: "draft", scheduledAt: undefined });
  } else if (name === "broadcast:remove") {
    posts.splice(posts.indexOf(find(args.postId)), 1);
  }
  changed();
  return result as T;
}
export const cloudAction = cloudMutation;
