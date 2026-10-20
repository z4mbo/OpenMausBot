import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { parseGitHubRepo, repoName } from "./repo.ts";
import { appConfig, type GitHubService } from "./service.ts";

/** A token the Origin backend minted from the workspace's shared GitHub connection, for one project's repository. */
export type BrokeredToken = { token: string; expiresAt: string; repoUrl: string };
export type BrokerAccess = "read" | "write" | "push";
export type SharedGitHubStatus = {
  shared: { accountLogin: string; accountType: "User" | "Organization"; connectorLogin: string; sharedByName: string; updatedAt: number } | null;
  stale: boolean;
  canManage: boolean;
  sealing: boolean;
  linkedLogin: string | null;
};

const REUSE_MARGIN_MS = 5 * 60_000;
const caches = new WeakMap<object, Map<string, BrokeredToken>>();

/** Convex actions over HTTP: the Origin cloud client this server shares carries only queries and mutations. */
export function convexAction<T>(url: string, name: string, args: Record<string, unknown>): Promise<T> {
  return new ConvexHttpClient(url, { logger: false }).action(makeFunctionReference<"action">(name), args) as Promise<T>;
}

/**
 * Security: brokered installation tokens stay in this server's memory until five minutes before GitHub expires them,
 * keyed by the session that asked, so one person's token is never reused for another's request.
 */
export async function brokeredToken(service: GitHubService, projectId: string, access: BrokerAccess, extra: Readonly<Record<string, string>> = {}, repoUrl?: string): Promise<BrokeredToken> {
  let cache = caches.get(service.store);
  if (!cache) caches.set(service.store, cache = new Map());
  const key = `${service.principal ?? "server"}:${service.env.integrationSecret ? "operator" : "member"}:${projectId}:${access}:${JSON.stringify(extra)}`;
  const cached = cache.get(key);
  if (cached && Date.parse(cached.expiresAt) - service.now() > REUSE_MARGIN_MS && (!repoUrl || sameRepository(cached.repoUrl, repoUrl))) return cached;
  const minted = await service.bridge<BrokeredToken>("githubToken", { projectId, access, ...(Object.keys(extra).length ? { extra } : {}) });
  if (!/^ghs_[A-Za-z0-9_]{20,}$/.test(minted.token) || !Number.isFinite(Date.parse(minted.expiresAt)) || !parseGitHubRepo(minted.repoUrl)) throw new Error("The Origin backend returned an unexpected GitHub token");
  cache.set(key, minted);
  return minted;
}

export function sameRepository(a: string | undefined, b: string | undefined): boolean {
  const left = parseGitHubRepo(a), right = parseGitHubRepo(b);
  return Boolean(left && right && repoName(left) === repoName(right));
}

/** Whether this server runs the workspace's GitHub itself (it holds the App and the integration secret) rather than through the backend. */
export function holdsLocalGitHub(service: Pick<GitHubService, "env" | "store">, teamId: string | undefined): boolean {
  return Boolean(service.env.integrationSecret && teamId && service.store.workspaceInfo(teamId));
}

export const sessionKey = (sessionToken: string) => createHash("sha256").update(sessionToken).digest("hex").slice(0, 32);

export async function sharedStatus(service: GitHubService, sessionToken: string, teamId: string): Promise<SharedGitHubStatus | null> {
  return await service.convex().query("teamGitHub:status", { sessionToken, teamId }).catch(() => null) as SharedGitHubStatus | null;
}

/** Uploads this server's App credentials and the admin's GitHub connection to the backend, which seals them for the workspace. */
export async function shareWorkspaceGitHub(service: GitHubService, sessionToken: string, teamId: string): Promise<{ accountLogin: string }> {
  const config = appConfig(service);
  const connection = service.store.workspaceInfo(teamId);
  const sealed = connection ? service.store.workspaceSealed(teamId, connection.connected_by) : null;
  if (!config || !sealed) throw new Error("Connect GitHub on this computer first, then share it with the workspace");
  if (!config.appId || !config.privateKey) throw new Error("This server has the GitHub App's OAuth credentials but not its App ID and private key, which the workspace needs. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, then share again.");
  if (!service.action) throw new Error("This Origin server cannot reach the backend's actions");
  return service.action("teamGitHub:share", {
    sessionToken, teamId,
    app: { appId: config.appId, privateKey: config.privateKey, clientId: config.clientId, clientSecret: config.clientSecret, ...(config.slug ? { slug: config.slug } : {}), ...(config.webhookSecret ? { webhookSecret: config.webhookSecret } : {}) },
    token: sealed.token(),
  });
}

/** OMB_GITHUB_API_URL: a stand-in for GitHub, honoured only on 127.0.0.1 so a fixture can never redirect real credentials. */
export function loopbackGitHubOrigin(value: string | undefined = process.env.OMB_GITHUB_API_URL): string | undefined {
  try {
    const url = value ? new URL(value) : null;
    return url && url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && url.pathname === "/" ? url.origin : undefined;
  } catch { return undefined; }
}

/** Sends GitHub's API and sign-in requests to the loopback stand-in instead, when one is set. */
export function loopbackGitHub(base: typeof fetch, value: string | undefined): typeof fetch {
  const target = loopbackGitHubOrigin(value);
  if (!target) return base;
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "https://api.github.com" && url.origin !== "https://github.com") return base(input, init);
    return base(`${target}${url.pathname}${url.search}`, input instanceof Request ? { method: input.method, headers: input.headers, body: input.body, ...init } : init);
  }) as typeof fetch;
}
