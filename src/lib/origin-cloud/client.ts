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

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    return;
  }
}

function createStore(read: () => string | null) {
  const listeners = new Set<Listener>();
  return {
    get: read,
    notify: () => listeners.forEach((listener) => listener()),
    subscribe(listener: Listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === URL_KEY || event.key === SESSION_KEY) listener();
      };
      globalThis.addEventListener?.("storage", onStorage);
      return () => {
        listeners.delete(listener);
        globalThis.removeEventListener?.("storage", onStorage);
      };
    },
  };
}

export function cloudUrl(): string | null {
  const stored = readStorage(URL_KEY)?.trim();
  if (stored) return originServerFor(stored);
  const fromEnv = (import.meta.env?.VITE_ORIGIN_CONVEX_URL as string | undefined)?.trim();
  return fromEnv || null;
}

export const urlStore = createStore(cloudUrl);

export function setCloudUrl(url: string | null): void {
  writeStorage(URL_KEY, url?.trim() || null);
  urlStore.notify();
}

export const sessionStore = createStore(() => readStorage(SESSION_KEY));

export function setSessionToken(token: string | null): void {
  writeStorage(SESSION_KEY, token);
  sessionStore.notify();
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
  const client = cloudClient();
  const current = sessionStore.get();
  try {
    if (client && current) await client.mutation(functionRef<"mutation">("auth:logout"), { sessionToken: current });
  } finally {
    setSessionToken(null);
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
