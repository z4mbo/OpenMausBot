// Stands in for @/lib/origin-cloud in the Campaigns fixture: every query and
// mutation goes over HTTP to the in-memory backend of origin-campaigns-backend.ts,
// which runs the real Convex functions.
import { useEffect, useState, useSyncExternalStore } from "react";

const config = await (await fetch("/__origin-campaigns.json")).json() as { url: string; token: string; viewerToken: string };
const viewer = () => new URLSearchParams(location.search).has("viewer");
const token = () => viewer() ? config.viewerToken : config.token;

const listeners = new Set<() => void>();
let revision = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const changed = () => { revision++; for (const listener of listeners) listener(); };
setInterval(changed, 1_500);

const requests: { name: string; args: Record<string, unknown> }[] = [];
Object.assign(window, { originCampaignsFixture: { requests, changed } });

async function call<T>(kind: "query" | "mutation" | "action", name: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${config.url}/api/${kind}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: name, format: "convex_encoded_json", args: [{ ...args, sessionToken: token() }] }),
  });
  const body = await response.json() as { status: string; value?: unknown; errorMessage?: string };
  if (body.status !== "success") throw new Error(body.errorMessage ?? "Request failed");
  return body.value as T;
}

export const cloudUrl = () => config.url;
export const useCloudUrl = cloudUrl;
export const sessionStore = { get: token };
export const useCloudSession = () => ({ token: token(), user: { _id: "fixture-user" }, ready: true });
export const isCurrentCloudSession = () => true;
export const captureCloudSession = () => ({ url: cloudUrl(), token: token(), isCurrent: () => true, assertCurrent() {} });
export const setCloudUrl = () => {};
export const setSessionToken = () => {};
export const logoutCloud = async () => {};
export const cloud = {};
export const CloudProvider = ({ children }: { children: unknown }) => children;
export const useCloudPages = () => ({ results: [], status: "done", loadMore() {} });
export const cloudQueryOnce = <T>(name: string, args?: Record<string, unknown>) => call<T>("query", name, args);

export function useCloudQuery<T>(name: string, args: Record<string, unknown> | "skip"): T | undefined {
  const tick = useSyncExternalStore(subscribe, () => revision);
  const key = args === "skip" ? null : JSON.stringify([name, args]);
  const [value, setValue] = useState<{ key: string; value: T } | undefined>();
  useEffect(() => {
    if (!key) return;
    let live = true;
    const [path, input] = JSON.parse(key) as [string, Record<string, unknown>];
    void call<T>("query", path, input).then((next) => { if (live) setValue({ key, value: next }); }, () => undefined);
    return () => { live = false; };
  }, [key, tick]);
  return value && value.key === key ? value.value : undefined;
}

export async function cloudMutation<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  requests.push({ name, args });
  try {
    return await call<T>("mutation", name, args);
  } finally {
    changed();
  }
}
export async function cloudAction<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  requests.push({ name, args });
  try {
    return await call<T>("action", name, args);
  } finally {
    changed();
  }
}
export const createOriginWorkspace = async (): Promise<{ teamId: string; slug: string }> => { throw new Error("The fixture has one workspace"); };
