"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex-api";

/** Stable link to the newest Windows installer; the server also keeps each versioned Origin-x.y.z-setup.exe. */
export const WINDOWS_DOWNLOAD_URL = "https://origin.imbored.fun/downloads/Origin-Setup.exe";
export const MAC_ARM_DOWNLOAD_URL = "https://origin.imbored.fun/downloads/Origin-Mac-AppleSilicon.dmg";
export const MAC_INTEL_DOWNLOAD_URL = "https://origin.imbored.fun/downloads/Origin-Mac-Intel.dmg";

/** Existing browser sessions are stored under this key; renaming it signs everyone out. */
const SESSION_KEY = "origin.sessionToken";

export const TEAM = [
  { id: "researcher", name: "Researcher", job: "Digs into users, markets and competitors, and writes up what it found." },
  { id: "product-manager", name: "Product Manager", job: "Turns goals into scoped issues with clear acceptance criteria." },
  { id: "designer", name: "Designer", job: "Sketches flows and screens, and keeps the interface consistent." },
  { id: "developer", name: "Developer", job: "Works in the repo on a branch per issue and opens the pull request." },
  { id: "marketer", name: "Marketer", job: "Plans launches, campaigns and the channels to reach people." },
  { id: "copywriter", name: "Copywriter", job: "Writes the words: pages, emails, release notes and docs." },
] as const;

export function AgentAvatar({ id, size = 40, label }: { id: string; size?: number; label?: string }) {
  return <img src={`/landing/avatars/${id}.svg`} width={size} height={size} alt={label ?? ""} loading="lazy" decoding="async" />;
}

export function AppleLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.18 8.5c-.02-1.66 1.36-2.46 1.42-2.5-.78-1.13-1.98-1.29-2.41-1.3-1.02-.1-2 .6-2.52.6-.52 0-1.32-.59-2.17-.57A3.2 3.2 0 0 0 2.8 6.37c-1.16 2-.3 4.97.83 6.6.55.8 1.21 1.69 2.07 1.66.83-.03 1.15-.54 2.15-.54 1 0 1.29.54 2.17.52.9-.01 1.46-.81 2-1.61.63-.92.89-1.81.9-1.86-.02 0-1.73-.66-1.74-2.64ZM9.53 3.62c.46-.56.77-1.33.68-2.1-.66.03-1.46.44-1.93 1-.42.49-.8 1.28-.7 2.03.74.06 1.49-.37 1.95-.93Z" />
    </svg>
  );
}

export function WindowsLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M0 2.2 6.5 1.3v6.2H0zM7.3 1.2 16 0v7.5H7.3zM0 8.3h6.5v6.3L0 13.7zM7.3 8.3H16V16l-8.7-1.2z" />
    </svg>
  );
}

const tokenListeners = new Set<() => void>();

function readToken(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Blocked storage: the browser cannot keep a session.
  }
  tokenListeners.forEach(listener => listener());
}

function subscribeToken(listener: () => void) {
  tokenListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { tokenListeners.delete(listener); window.removeEventListener("storage", listener); };
}

export function useOriginSession() {
  const stored = useSyncExternalStore(subscribeToken, readToken, () => undefined);
  const ready = stored !== undefined;
  const token = stored ?? null;
  const user = useQuery(api.auth.me, token ? { sessionToken: token } : "skip");
  const logout = useMutation(api.auth.logout);
  const save = useCallback((next: string) => writeToken(next), []);
  const signOut = useCallback(async () => {
    if (token) await logout({ sessionToken: token }).catch(() => {});
    writeToken(null);
  }, [token, logout]);
  const loading = !ready || (token !== null && user === undefined);
  return { token, user: token && user ? user : null, loading, save, signOut };
}

export type Platform = "windows" | "mac" | "other";

function readPlatform(): Platform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const agent = nav.userAgent.toLowerCase();
  if (agent.includes("android")) return "other";
  if (/macintosh|mac os x|iphone|ipad|ipod/.test(agent)) return "mac";
  const platform = `${nav.userAgentData?.platform ?? ""} ${nav.platform}`.toLowerCase();
  if (agent.includes("windows") || platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "mac";
  return "other";
}

const neverChanges = () => () => {};

/** The visitor's desktop platform; the server render assumes Windows, the only build so far. */
export function usePlatform(): Platform {
  return useSyncExternalStore(neverChanges, readPlatform, () => "windows");
}
