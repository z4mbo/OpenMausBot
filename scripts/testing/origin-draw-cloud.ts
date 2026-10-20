import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
let revision = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;
const scene = JSON.parse(sessionStorage.getItem("origin-draw-fixture-scene") ?? "[]") as string[];
let rows = [...scene];
const changed = () => { rows = [...scene]; revision++; for (const listener of listeners) listener(); };
const presence: Record<string, unknown>[] = [{ userId: "other", name: "Fixture teammate", x: 100, y: 80, button: "up", selection: [] as string[], updatedAt: Date.now() }];
let pages = [{ id: "page-1", name: "Page 1" }] as { id: string; name: string; guides?: { axis: string; at: number }[] }[];
let comments: Record<string, unknown>[] = [];
let versions: { _id: string; name: string; nodeCount: number; authorName: string; createdAt: number; rows: string[] }[] = [];
let links: Record<string, unknown>[] = [];
const people = [{ _id: "m1", userId: "fixture-user", email: "you@fixture.test", role: "owner", status: "active", name: "You", avatarUrl: null }, { _id: "m2", userId: "other", email: "teammate@fixture.test", role: "member", status: "active", name: "Fixture teammate", avatarUrl: null }];
const issues = [{ _id: "fixtureissue0001", title: "Design the pricing page", done: false }];
let files: { fileId: string; mimeType: string; url: string | null }[] = [];
let canvases = [{ _id: "fixture-canvas", name: "Release planning with a long canvas name" }, { _id: "fixture-second", name: "Research and architecture" }];
const swatch = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#4F46E5"/><circle cx="160" cy="100" r="60" fill="#F59E0B"/></svg>')}`;
const assets = [{ _id: "asset-logo", type: "image", name: "Brand mark", fileUrl: swatch, storageId: "storage-logo", contentType: "image/svg+xml", updatedAt: 1 }];
const design = { assets, tokens: [] };
const requests: { name: string; args: Record<string, unknown> }[] = [];
let blocked = false;
let release: (() => void) | null = null;
const api = {
  requests,
  blockNextSave() { blocked = true; },
  rejectSave() { release?.(); release = null; },
  get scene() { return scene; },
  get comments() { return comments; },
  get pages() { return pages; },
  select(userId: string, ids: string[]) { const row = presence.find((item) => item.userId === userId) as Record<string, unknown> | undefined; if (row) { row.selection = ids; row.updatedAt = Date.now(); } changed(); },
  agent(name: string, x: number, y: number, ids: string[] = []) {
    const row = presence.find((item) => item.agentId === "fixture-agent");
    const next = { userId: "fixture-user", agentId: "fixture-agent", name, x, y, button: "up", selection: ids, updatedAt: Date.now() };
    if (row) Object.assign(row, next); else presence.push(next);
    changed();
  },
  link(frameId: string, frameName: string) { links = [{ _id: `link-${links.length}`, taskId: issues[0]!._id, canvasId: "fixture-canvas", canvasName: "Release planning", frameId, frameName, agentName: "Atlas", status: "review", title: issues[0]!.title, done: false }]; changed(); },
  remote(rows: string[]) {
    for (const data of rows) {
      const element = JSON.parse(data) as { id: string };
      const index = scene.findIndex((row) => JSON.parse(row).id === element.id);
      if (index < 0) scene.push(data); else scene[index] = data;
    }
    sessionStorage.setItem("origin-draw-fixture-scene", JSON.stringify(scene));
    changed();
  },
};
Object.assign(window, { originDrawFixture: api });
export const cloudUrl = () => location.origin;
export const useCloudUrl = cloudUrl;
export const sessionStore = { get: () => "origin-draw-fixture-token" };
export const useCloudSession = () => ({ token: sessionStore.get(), user: { _id: "fixture-user" }, ready: true });
export const isCurrentCloudSession = () => true;
export const captureCloudSession = () => ({ url: cloudUrl(), token: sessionStore.get(), isCurrent: () => true, assertCurrent() {} });
export const setCloudUrl = () => {};
export const setSessionToken = () => {};
export const logoutCloud = async () => {};
export const cloud = {};
export const CloudProvider = ({ children }: { children: unknown }) => children;
export const cloudQueryOnce = async (name: string, args: Record<string, unknown>) => (name === "canvasCollab:versionRows" ? versions.find((item) => item._id === args.versionId)?.rows ?? [] : null);
export const useCloudPages = () => ({ results: [], status: "done", loadMore() {} });
export function useCloudQuery<T>(name: string): T {
  useSyncExternalStore(subscribe, snapshot);
  if (name === "projects:get") return { _id: "fixture-project", teamId: "fixture-team", name: "Fixture project", memberRole: new URLSearchParams(location.search).has("viewer") ? "viewer" : "owner" } as T;
  if (name === "draw:canvases") return canvases as T;
  if (name === "design:list") return design as T;
  if (name === "draw:files") return files as T;
  if (name === "pages:list") return { pages: [], captureEnabled: true } as T;
  if (name === "brand:get") return null as T;
  if (name === "canvasCollab:meta") return { pages } as T;
  if (name === "canvasCollab:comments") return comments as T;
  if (name === "canvasCollab:versions") return versions.map(({ rows: _rows, ...version }) => version) as T;
  if (name === "canvasCollab:designsForCanvas") return links as T;
  if (name === "members:people") return people as T;
  if (name === "tasks:board") return { columns: [], tasks: issues, assignees: [] } as T;
  return (name === "draw:scene" ? rows : name === "draw:presence" ? presence : []) as T;
}
export async function cloudMutation<T>(name: string, args: Record<string, unknown>): Promise<T> {
  requests.push({ name, args });
  if (name === "draw:createCanvas") {
    const id = `fixture-created-${canvases.length}`;
    canvases = [...canvases, { _id: id, name: String(args.name) }];
    changed();
    return id as T;
  }
  if (name === "draw:renameCanvas") { canvases = canvases.map((item) => (item._id === args.canvasId ? { ...item, name: String(args.name) } : item)); changed(); }
  if (name === "draw:archiveCanvas") { canvases = canvases.filter((item) => item._id !== args.canvasId); changed(); }
  if (name === "design:createAsset") { design.assets = [...design.assets, { _id: `asset-${design.assets.length}`, type: "image", name: String(args.name), fileUrl: `/__origin-draw-file/${String(args.storageId)}`, storageId: String(args.storageId), contentType: String(args.contentType), updatedAt: Date.now() }]; changed(); }
  if (name === "draw:saveFile") {
    if (!files.some((file) => file.fileId === args.fileId)) files = [...files, { fileId: String(args.fileId), mimeType: String(args.mimeType), url: args.storageId === "storage-logo" ? swatch : `/__origin-draw-file/${String(args.storageId)}` }];
    changed();
  }
  if (name === "canvasCollab:setPages") { pages = args.pages as typeof pages; changed(); }
  if (name === "canvasCollab:addComment") { comments = [...comments, { _id: `comment-${comments.length + 1}`, x: args.x, y: args.y, nodeId: args.nodeId, parentId: args.parentId, body: args.body, mentions: args.mentions, authorId: "fixture-user", authorName: "You", resolved: false, createdAt: Date.now() }]; changed(); return `comment-${comments.length}` as T; }
  if (name === "canvasCollab:resolveComment") { comments = comments.map((item) => (item._id === args.commentId ? { ...item, resolved: args.resolved } : item)); changed(); }
  if (name === "canvasCollab:deleteComment") { comments = comments.filter((item) => item._id !== args.commentId && item.parentId !== args.commentId); changed(); }
  if (name === "canvasCollab:saveVersion") { versions = [{ _id: `version-${versions.length + 1}`, name: String(args.name), nodeCount: scene.length, authorName: "You", createdAt: Date.now(), rows: [...scene] }, ...versions]; changed(); return versions[0]!._id as T; }
  if (name === "canvasCollab:deleteVersion") { versions = versions.filter((item) => item._id !== args.versionId); changed(); }
  if (name === "draw:uploadUrl" || name === "design:generateUploadUrl") return `${location.origin}/__origin-draw-upload` as T;
  if (name === "draw:updateElements") {
    if (blocked) { blocked = false; await new Promise<void>((_resolve, reject) => { release = () => reject(new Error("Synthetic offline save")); }); }
    api.remote(args.elements as string[]);
  }
  return null as T;
}
export const cloudAction = cloudMutation;
