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

  useEffect(() => {
    if (token && me === null) setSessionToken(null);
  }, [token, me]);

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
    ready: Boolean(url) && (!token || me !== undefined),
    login,
    logout,
  }), [url, token, me, login, logout]);
}
