import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cloudClient, functionRef, sessionStore, setSessionToken, urlStore, withSession } from "./client";
import type { CloudUser } from "./types";

export function useCloudUrl(): string | null {
  return useSyncExternalStore(urlStore.subscribe, urlStore.get, () => null);
}

export function useCloudToken(): string | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => null);
}

export function useCloudQuery<T = unknown>(name: string, args: Record<string, unknown> | "skip"): T | undefined {
  const url = useCloudUrl();
  const token = useCloudToken();
  const key = args === "skip" ? null : JSON.stringify(args);
  const [result, setResult] = useState<{ key: string; value: T | undefined } | null>(null);
  const watchKey = url && key !== null ? `${url}\n${token ?? ""}\n${name}\n${key}` : null;

  useEffect(() => {
    const client = cloudClient();
    if (!client || watchKey === null || key === null) return;
    const watch = client.watchQuery(functionRef<"query">(name), withSession(JSON.parse(key) as Record<string, unknown>));
    const read = () => {
      let value: T | undefined;
      try {
        value = watch.localQueryResult() as T | undefined;
      } catch {
        value = undefined;
      }
      setResult({ key: watchKey, value });
    };
    read();
    return watch.onUpdate(read);
  }, [watchKey, name, key]);

  return result && result.key === watchKey ? result.value : undefined;
}

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };
export type CloudPages<T> = { results: T[]; status: "loading" | "more" | "done"; loadMore(): void };

/** A Convex paginated query, every loaded page kept live. */
export function useCloudPages<T>(name: string, args: Record<string, unknown> | "skip", pageSize: number): CloudPages<T> {
  const url = useCloudUrl();
  const token = useCloudToken();
  const key = args === "skip" ? null : JSON.stringify(args);
  const watchKey = url && key !== null ? `${url}\n${token ?? ""}\n${name}\n${key}` : null;
  const [cursors, setCursors] = useState<{ key: string | null; list: (string | null)[] }>({ key: watchKey, list: [null] });
  const list = cursors.key === watchKey ? cursors.list : [null];
  const [pages, setPages] = useState<{ key: string | null; byCursor: Map<string | null, Page<T>> }>({ key: null, byCursor: new Map() });
  const listKey = JSON.stringify(list);

  useEffect(() => {
    const client = cloudClient();
    if (!client || watchKey === null || key === null) return;
    const base = JSON.parse(key) as Record<string, unknown>;
    const stops = (JSON.parse(listKey) as (string | null)[]).map((cursor) => {
      const watch = client.watchQuery(functionRef<"query">(name), withSession({ ...base, paginationOpts: { numItems: pageSize, cursor } }));
      const read = () => {
        let value: Page<T> | undefined;
        try {
          value = watch.localQueryResult() as Page<T> | undefined;
        } catch {
          value = undefined;
        }
        if (!value) return;
        setPages((current) => {
          const byCursor = new Map(current.key === watchKey ? current.byCursor : []);
          byCursor.set(cursor, value);
          return { key: watchKey, byCursor };
        });
      };
      read();
      return watch.onUpdate(read);
    });
    return () => { for (const stop of stops) stop(); };
  }, [watchKey, name, key, listKey, pageSize]);

  const loaded = pages.key === watchKey ? list.map((cursor) => pages.byCursor.get(cursor)) : [];
  const last = loaded.at(-1);
  const results = loaded.flatMap((page) => page?.page ?? []);
  const status = !loaded.length || loaded.some((page) => !page) ? "loading" : last!.isDone ? "done" : "more";
  const loadMore = useCallback(() => {
    if (!last || last.isDone) return;
    setCursors({ key: watchKey, list: [...list, last.continueCursor] });
  }, [last, list, watchKey]);
  return { results, status, loadMore };
}

const SESSION_CHECK_MS = 8_000;

export function useCloudSession(): {
  user: CloudUser | null;
  token: string | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
} {
  const url = useCloudUrl();
  const token = useCloudToken();
  const me = useCloudQuery<CloudUser | null>("auth:me", url && token ? {} : "skip");
  const [unreachable, setUnreachable] = useState<string | null>(null);

  useEffect(() => {
    if (token && me === null) setSessionToken(null);
  }, [token, me]);

  useEffect(() => {
    if (!url || !token) return;
    let alive = true;
    const slow = window.setTimeout(() => { if (alive) setUnreachable(url); }, SESSION_CHECK_MS);
    cloudClient()?.query(functionRef<"query">("auth:me"), { sessionToken: token }).then(
      (user) => { if (!alive) return; window.clearTimeout(slow); setUnreachable(null); if (!user) setSessionToken(null); },
      () => { if (alive) { window.clearTimeout(slow); setSessionToken(null); } },
    );
    return () => { alive = false; window.clearTimeout(slow); };
  }, [url, token]);

  const login = useCallback(async (email: string, password: string) => {
    const client = cloudClient();
    if (!client) throw new Error("Origin Cloud is not configured");
    const result = (await client.action(functionRef<"action">("auth:login"), { email, password })) as { sessionToken: string };
    setSessionToken(result.sessionToken);
  }, []);

  const logout = useCallback(async () => {
    const client = cloudClient();
    const current = sessionStore.get();
    try {
      if (client && current) await client.mutation(functionRef<"mutation">("auth:logout"), { sessionToken: current });
    } finally {
      setSessionToken(null);
    }
  }, []);

  return useMemo(() => ({
    user: token && me ? me : null,
    token: url ? token : null,
    ready: Boolean(url) && (!token || me !== undefined || unreachable === url),
    login,
    logout,
  }), [url, token, me, unreachable, login, logout]);
}
