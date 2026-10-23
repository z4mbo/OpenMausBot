import { ConvexReactClient } from "convex/react";
import { makeFunctionReference, type FunctionType } from "convex/server";
import { originServerFor } from "./servers";

const URL_KEY = "origin-cloud-url";
const SESSION_KEY = "origin-cloud-session";

type Listener = () => void;

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): boolean {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function createStore(read: () => string | null) {
  const listeners = new Set<Listener>();
  return {
    get: read,
    notify: () => listeners.forEach((listener) => listener()),
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

function effectiveCloudUrl(stored: string | null): string | null {
  const input = stored?.trim() || (import.meta.env?.VITE_ORIGIN_CONVEX_URL as string | undefined)?.trim();
  return input ? originServerFor(input) : null;
}

export function cloudUrl(): string | null {
  return effectiveCloudUrl(readStorage(URL_KEY));
}

export const urlStore = createStore(cloudUrl);

export function setCloudUrl(url: string | null): void {
  const stored = url?.trim() || null;
  const changed = cloudUrl() !== effectiveCloudUrl(stored);
  if (changed && !writeStorage(SESSION_KEY, null)) throw new Error("Origin could not clear the previous account. Check browser storage and try again.");
  if (!writeStorage(URL_KEY, stored)) {
    if (changed) notifyCloudSession();
    throw new Error("Origin could not save the connection. Check browser storage and try again.");
  }
  notifyCloudSession();
}

export const sessionStore = createStore(() => readStorage(SESSION_KEY));

export function setSessionToken(token: string | null): void {
  writeStorage(SESSION_KEY, token);
  notifyCloudSession();
}

let sessionEpoch = 0;

function notifyCloudSession(): void {
  sessionEpoch++;
  urlStore.notify();
  sessionStore.notify();
}

globalThis.addEventListener?.("storage", (event: StorageEvent) => {
  if (event.key === null || event.key === URL_KEY || event.key === SESSION_KEY) notifyCloudSession();
});

export function isCurrentCloudSession(url: string | null, token: string | null): boolean {
  return cloudUrl() === url && sessionStore.get() === token;
}

export function captureCloudSession(): {
  url: string | null;
  token: string | null;
  isCurrent(): boolean;
  assertCurrent(): void;
} {
  const url = cloudUrl();
  const token = sessionStore.get();
  const epoch = sessionEpoch;
  const isCurrent = () => sessionEpoch === epoch && isCurrentCloudSession(url, token);
  return {
    url,
    token,
    isCurrent,
    assertCurrent() {
      if (!isCurrent()) throw new Error("Your Origin account or connection changed. Try again.");
    },
  };
}

let current: { url: string; client: ConvexReactClient | null } | null = null;

export function cloudClient(): ConvexReactClient | null {
  const url = cloudUrl();
  if (!url) return null;
  if (current?.url === url) return current.client;
  void current?.client?.close();
  let client: ConvexReactClient | null;
  try {
    client = new ConvexReactClient(url);
  } catch {
    client = null;
  }
  current = { url, client };
  return client;
}

export function functionRef<T extends FunctionType>(name: string) {
  return makeFunctionReference<T>(name);
}

export async function logoutCloud(): Promise<void> {
  const session = captureCloudSession();
  const client = cloudClient();
  try {
    if (client && session.token) await client.mutation(functionRef<"mutation">("auth:logout"), { sessionToken: session.token });
  } finally {
    if (session.isCurrent()) setSessionToken(null);
  }
}

export function withSession(args: Record<string, unknown> = {}): Record<string, unknown> {
  if ("sessionToken" in args) {
    if (args.sessionToken !== undefined) return args;
    const { sessionToken: _omitted, ...rest } = args;
    return rest;
  }
  const token = sessionStore.get();
  return token ? { ...args, sessionToken: token } : args;
}

function requireClient(): ConvexReactClient {
  const client = cloudClient();
  if (!client) throw new Error("Origin Cloud is not configured");
  return client;
}

export async function cloudQueryOnce<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  return (await requireClient().query(functionRef<"query">(name), withSession(args))) as T;
}

export async function cloudMutation<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  return (await requireClient().mutation(functionRef<"mutation">(name), withSession(args))) as T;
}

export async function cloudAction<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  return (await requireClient().action(functionRef<"action">(name), withSession(args))) as T;
}
