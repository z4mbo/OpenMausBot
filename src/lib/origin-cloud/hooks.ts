import { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { captureCloudSession, cloudClient, functionRef, logoutCloud, sessionStore, setSessionToken, urlStore, withSession } from "./client";
import type { CloudUser } from "./types";
import { isAuthorityQuery, OriginQueryFailures, OriginQueryRecovery, OriginQueryUnavailable } from "./query-failure";

function useQueryFailure(key: string | null, pending: boolean, failed: boolean, hasData: boolean): void {
  const enabled = useContext(OriginQueryFailures);
  const recovery = useContext(OriginQueryRecovery);
  const timeout = recovery && recovery.attempt > 0 ? 30_000 : 12_000;
  const [timedOut, setTimedOut] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || key === null || !pending || failed) return;
    const timer = window.setTimeout(() => setTimedOut(key), timeout);
    return () => window.clearTimeout(timer);
  }, [enabled, key, pending, failed, timeout]);
  const unavailable = failed || (pending && timedOut === key);
  const report = recovery?.reportFailure;
  useEffect(() => {
    if (!enabled || key === null || !report) return;
    report(key, unavailable && hasData);
    return () => report(key, false);
  }, [enabled, key, report, unavailable, hasData]);
  if (enabled && key !== null && unavailable && !hasData) throw new OriginQueryUnavailable();
}

export function useCloudUrl(): string | null {
  return useSyncExternalStore(urlStore.subscribe, urlStore.get, () => null);
}

export function useCloudToken(): string | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => null);
}

export function useCloudQuery<T = unknown>(name: string, args: Record<string, unknown> | "skip"): T | undefined {
  const recovery = useContext(OriginQueryRecovery);
  const attempt = recovery?.attempt ?? 0;
  const retaining = recovery !== null;
  const url = useCloudUrl();
  const token = useCloudToken();
  const key = args === "skip" ? null : JSON.stringify(args);
  const [result, setResult] = useState<{ key: string; value: T | undefined; failed: boolean } | null>(null);
  const watchKey = url && key !== null ? `${url}\n${token ?? ""}\n${name}\n${key}` : null;

  useEffect(() => {
    const client = cloudClient();
    if (!client || watchKey === null || key === null) return;
    const watch = client.watchQuery(functionRef<"query">(name), withSession(JSON.parse(key) as Record<string, unknown>));
    const read = () => {
      let value: T | undefined;
      let failed = false;
      try {
        value = watch.localQueryResult() as T | undefined;
      } catch {
        value = undefined;
        failed = true;
      }
      setResult((current) => ({ key: watchKey, value: failed && retaining && !isAuthorityQuery(name) && current?.key === watchKey ? current.value : value, failed }));
    };
    read();
    return watch.onUpdate(read);
  }, [watchKey, name, key, attempt, retaining]);

  const current = result?.key === watchKey ? result : null;
  useQueryFailure(watchKey, current?.value === undefined, current?.failed ?? false, current?.value !== undefined);
  return current?.value;
}

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };
export type CloudPages<T> = { results: T[]; status: "loading" | "more" | "done"; loadMore(): void };

/** A Convex paginated query, every loaded page kept live. */
export function useCloudPages<T>(name: string, args: Record<string, unknown> | "skip", pageSize: number): CloudPages<T> {
  const recovery = useContext(OriginQueryRecovery);
  const attempt = recovery?.attempt ?? 0;
  const url = useCloudUrl();
  const token = useCloudToken();
  const key = args === "skip" ? null : JSON.stringify(args);
  const watchKey = url && key !== null ? `${url}\n${token ?? ""}\n${name}\n${key}` : null;
  const [cursors, setCursors] = useState<{ key: string | null; list: (string | null)[] }>({ key: watchKey, list: [null] });
  const list = cursors.key === watchKey ? cursors.list : [null];
  const [pages, setPages] = useState<{ key: string | null; byCursor: Map<string | null, Page<T>> }>({ key: null, byCursor: new Map() });
  const [failures, setFailures] = useState<{ key: string | null; cursors: Set<string | null> }>({ key: null, cursors: new Set() });
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
          setFailures((current) => ({ key: watchKey, cursors: new Set([...(current.key === watchKey ? current.cursors : []), cursor]) }));
        }
        if (!value) return;
        setFailures((current) => {
          if (current.key !== watchKey || !current.cursors.has(cursor)) return current;
          const cursors = new Set(current.cursors);
          cursors.delete(cursor);
          return { key: watchKey, cursors };
        });
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
  }, [watchKey, name, key, listKey, pageSize, attempt]);

  const loaded = pages.key === watchKey ? list.map((cursor) => pages.byCursor.get(cursor)) : [];
  const last = loaded.at(-1);
  const results = loaded.flatMap((page) => page?.page ?? []);
  const status = !loaded.length || loaded.some((page) => !page) ? "loading" : last!.isDone ? "done" : "more";
  useQueryFailure(watchKey, status === "loading", failures.key === watchKey && failures.cursors.size > 0, loaded.some((page) => page !== undefined));
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
      () => { if (alive) { window.clearTimeout(slow); setUnreachable(url); } },
    );
    return () => { alive = false; window.clearTimeout(slow); };
  }, [url, token]);

  const login = useCallback(async (email: string, password: string) => {
    const session = captureCloudSession();
    const client = cloudClient();
    if (!client) throw new Error("Origin Cloud is not configured");
    const result = (await client.action(functionRef<"action">("auth:login"), { email, password })) as { sessionToken: string };
    session.assertCurrent();
    setSessionToken(result.sessionToken);
  }, []);

  const logout = useCallback(() => logoutCloud(), []);

  return useMemo(() => ({
    user: token && me ? me : null,
    token: url ? token : null,
    ready: Boolean(url) && (!token || me !== undefined || unreachable === url),
    login,
    logout,
  }), [url, token, me, unreachable, login, logout]);
}
