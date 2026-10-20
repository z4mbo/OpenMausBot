import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
let revision = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;
const scene = JSON.parse(sessionStorage.getItem("origin-draw-fixture-scene") ?? "[]") as string[];
let rows = [...scene];
const changed = () => { rows = [...scene]; revision++; for (const listener of listeners) listener(); };
const presence = [{ userId: "other", name: "Fixture teammate", x: 100, y: 80, button: "up", updatedAt: Date.now() }];
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
export const cloudQueryOnce = async () => null;
export const useCloudPages = () => ({ results: [], status: "done", loadMore() {} });
export function useCloudQuery<T>(name: string): T {
  useSyncExternalStore(subscribe, snapshot);
  if (name === "projects:get") return { _id: "fixture-project", teamId: "fixture-team", name: "Fixture project", memberRole: new URLSearchParams(location.search).has("viewer") ? "viewer" : "owner" } as T;
  if (name === "draw:canvases") return canvases as T;
  if (name === "design:list") return design as T;
  if (name === "draw:files") return files as T;
  if (name === "pages:list") return { pages: [], captureEnabled: true } as T;
  if (name === "brand:get") return null as T;
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
  if (name === "draw:uploadUrl" || name === "design:generateUploadUrl") return `${location.origin}/__origin-draw-upload` as T;
  if (name === "draw:updateElements") {
    if (blocked) { blocked = false; await new Promise<void>((_resolve, reject) => { release = () => reject(new Error("Synthetic offline save")); }); }
    api.remote(args.elements as string[]);
  }
  return null as T;
}
export const cloudAction = cloudMutation;
