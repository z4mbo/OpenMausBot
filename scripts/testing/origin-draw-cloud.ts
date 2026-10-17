import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
let revision = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;
const scene = JSON.parse(sessionStorage.getItem("origin-draw-fixture-scene") ?? "[]") as string[];
const presence = [{ userId: "other", name: "Fixture teammate", x: 100, y: 80, button: "up", updatedAt: Date.now() }];
const files: unknown[] = [];
const canvases = [{ _id: "fixture-canvas", name: "Release planning with a long canvas name" }, { _id: "fixture-second", name: "Research and architecture" }];
const requests: { name: string; args: Record<string, unknown> }[] = [];
let blocked = false;
let release: (() => void) | null = null;
const api = {
  requests,
  blockNextSave() { blocked = true; },
  rejectSave() { release?.(); release = null; },
  get scene() { return scene; },
};
Object.assign(window, { originDrawFixture: api });
export const cloudUrl = () => location.origin;
export const useCloudUrl = cloudUrl;
export const sessionStore = { get: () => "origin-draw-fixture-token" };
export const useCloudSession = () => ({ token: sessionStore.get(), user: { _id: "fixture-user" }, ready: true });
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
  return (name === "draw:scene" ? scene : name === "draw:presence" ? presence : files) as T;
}
export async function cloudMutation<T>(name: string, args: Record<string, unknown>): Promise<T> {
  requests.push({ name, args });
  if (name === "draw:createCanvas") {
    const id = `fixture-created-${canvases.length}`;
    canvases.push({ _id: id, name: String(args.name) });
    revision++; for (const listener of listeners) listener();
    return id as T;
  }
  if (name === "draw:updateElements") {
    if (blocked) { blocked = false; await new Promise<void>((_resolve, reject) => { release = () => reject(new Error("Synthetic offline save")); }); }
    for (const data of args.elements as string[]) {
      const element = JSON.parse(data) as { id: string };
      const index = scene.findIndex((row) => JSON.parse(row).id === element.id);
      if (index < 0) scene.push(data); else scene[index] = data;
    }
    sessionStorage.setItem("origin-draw-fixture-scene", JSON.stringify(scene));
    revision++; for (const listener of listeners) listener();
  }
  return null as T;
}
export const cloudAction = cloudMutation;
