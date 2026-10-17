import { createHmac, timingSafeEqual } from "node:crypto";
import type { OriginCloudClient } from "../origin-cloud.ts";
import { githubHeaders } from "./repo.ts";
import type { GitHubAppConfig, GitHubStore, TokenRecord } from "./store.ts";

/** Server environment for the GitHub integration; documented in docs/origin-cloud-dev.md. */
export interface GitHubEnv {
  /** ORIGIN_PUBLIC_URL: the origin GitHub and Convex reach this server at; the server's own public URL when unset. */
  publicUrl?: string;
  /** ORIGIN_INTEGRATION_SECRET: shared with the Convex deployment, at least 32 characters. */
  integrationSecret?: string;
  /** ORIGIN_CONVEX_URL: the Convex deployment's client URL, when no Origin sign-in has shared one with this server. */
  convexUrl?: string;
  /** ORIGIN_CONVEX_SITE_URL: the Convex deployment's HTTP actions URL; derived from convexUrl when unset. */
  convexSiteUrl?: string;
  /** ORIGIN_LEGACY_OWNER_EMAIL: the one Origin account allowed to create the GitHub App. */
  legacyOwnerEmail?: string;
  /** ORIGIN_GITHUB_TOKEN: a token the legacy owner's own projects may fall back to. */
  legacyToken?: string;
  appId?: number;
  appPrivateKey?: string;
  clientId?: string;
  clientSecret?: string;
  webhookSecret?: string;
}

export function githubEnvFrom(env: NodeJS.ProcessEnv): GitHubEnv {
  const value = (name: string) => env[name]?.trim() || undefined;
  return {
    publicUrl: value("ORIGIN_PUBLIC_URL"),
    integrationSecret: value("ORIGIN_INTEGRATION_SECRET"),
    convexUrl: value("ORIGIN_CONVEX_URL"),
    convexSiteUrl: value("ORIGIN_CONVEX_SITE_URL"),
    legacyOwnerEmail: value("ORIGIN_LEGACY_OWNER_EMAIL")?.toLowerCase(),
    legacyToken: value("ORIGIN_GITHUB_TOKEN"),
    appId: value("GITHUB_APP_ID") ? Number(value("GITHUB_APP_ID")) : undefined,
    appPrivateKey: value("GITHUB_APP_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
    clientId: value("GITHUB_CLIENT_ID"),
    clientSecret: value("GITHUB_CLIENT_SECRET"),
    webhookSecret: value("GITHUB_WEBHOOK_SECRET"),
  };
}

export interface GitHubService {
  store: GitHubStore;
  env: GitHubEnv;
  publicUrl(): string | undefined;
  fetch: typeof fetch;
  /** The Origin Convex deployment, called with the caller's own Origin session token. */
  convex(): OriginCloudClient;
  /** The signed `/integrations` HTTP action of the Convex deployment. */
  bridge<T>(operation: string, args: unknown): Promise<T>;
  now(): number;
}

export class GitHubHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function originUrl(service: Pick<GitHubService, "publicUrl">): string {
  const configured = service.publicUrl();
  if (!configured) throw new Error("Set ORIGIN_PUBLIC_URL to the address GitHub reaches this server at");
  const url = new URL(configured);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("ORIGIN_PUBLIC_URL must be an application origin");
  return url.origin;
}

export function convexSiteUrl(env: GitHubEnv, convexUrl: string | undefined): string {
  if (env.convexSiteUrl) return env.convexSiteUrl.replace(/\/+$/, "");
  if (!convexUrl) throw new Error("Convex site URL missing");
  const url = new URL(convexUrl);
  if (url.hostname.endsWith(".convex.cloud")) url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  else if (url.port) url.port = String(Number(url.port) + 1);
  else throw new Error("Set ORIGIN_CONVEX_SITE_URL for this Convex deployment");
  return url.origin;
}

export function appConfig(service: Pick<GitHubService, "store" | "env">): GitHubAppConfig | null {
  const { env } = service;
  const credentials = { appId: env.appId, privateKey: env.appPrivateKey };
  const saved = service.store.savedApp();
  if (saved) return { ...saved, appId: credentials.appId ?? saved.appId, privateKey: credentials.privateKey ?? saved.privateKey };
  return env.clientId && env.clientSecret ? { ...credentials, clientId: env.clientId, clientSecret: env.clientSecret, webhookSecret: env.webhookSecret } : null;
}

export function signIntegration(secret: string | undefined, body: string): string {
  if (!secret || secret.length < 32) throw new Error("Integration service is not configured");
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Security: the HMAC and a 60 second freshness window are the only credential of a Convex tick. */
export function verifyIntegration(secret: string | undefined, body: string, signature: string, now: number): Record<string, unknown> {
  if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(signIntegration(secret, body), "hex"))) throw new Error("Unauthorized");
  const payload = JSON.parse(body) as Record<string, unknown>;
  if (typeof payload.at !== "number" || Math.abs(now - payload.at) > 60_000) throw new Error("Request expired");
  return payload;
}

export function createIntegrationBridge(deps: { fetch: typeof fetch; siteUrl(): string; secret(): string | undefined; now(): number }) {
  return async <T>(operation: string, args: unknown): Promise<T> => {
    const body = JSON.stringify({ at: deps.now(), operation, args });
    const response = await deps.fetch(`${deps.siteUrl()}/integrations`, {
      method: "POST", body,
      headers: { "Content-Type": "application/json", "x-origin-signature": signIntegration(deps.secret(), body) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Integration update failed (${response.status})`);
    return await response.json() as T;
  };
}

export async function githubRequest<T>(service: Pick<GitHubService, "fetch">, path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await service.fetch(`https://api.github.com${path}`, { ...init, headers: githubHeaders(token), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    let detail = "";
    if (response.status === 422) {
      const payload = await response.json().catch(() => null) as { errors?: { field?: string; code?: string; message?: string }[] } | null;
      detail = (payload?.errors ?? []).slice(0, 3).map((error) => `${error.field || "request"}: ${error.message || error.code || "invalid"}`).join("; ").slice(0, 300);
    }
    const message = response.status === 401 ? "Reconnect GitHub in workspace settings"
      : [403, 429].includes(response.status) ? "GitHub permissions or rate limit prevented this action. Check the Origin GitHub App access and try again later."
      : response.status === 404 ? "Repository not found. Grant the Origin GitHub App access to this repository."
      : response.status === 422 ? `GitHub rejected this request${detail ? ` (${detail})` : ". Check the repository name and issue fields."}`
      : `GitHub request failed (${response.status})`;
    throw new GitHubHttpError(response.status, message);
  }
  return await response.json() as T;
}

export async function exchangeGitHubToken(service: Pick<GitHubService, "fetch" | "now">, params: Record<string, string>): Promise<TokenRecord> {
  const response = await service.fetch("https://github.com/login/oauth/access_token", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(params), signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.access_token || data.error) throw new Error("GitHub authorization failed. Please reconnect.");
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_in ? service.now() + data.expires_in * 1000 : undefined };
}

const refreshing = new Map<string, Promise<string>>();

export async function workspaceGitHubToken(service: GitHubService, team: string, connectedBy: string): Promise<string | undefined> {
  const row = service.store.workspaceSealed(team, connectedBy);
  if (!row) return undefined;
  const token = row.token();
  if (!token.expires_at || token.expires_at > service.now() + 60_000) return token.access_token;
  const existing = refreshing.get(team);
  if (existing) return existing;
  const refresh = (async () => {
    const config = appConfig(service);
    if (!config || !token.refresh_token) throw new Error("Reconnect GitHub in workspace settings");
    const next = await exchangeGitHubToken(service, { client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: token.refresh_token });
    if (service.store.workspaceSealed(team, connectedBy)?.encrypted !== row.encrypted) throw new Error("GitHub connection changed");
    service.store.saveWorkspace(team, row.login, row.account_id, row.connected_by, next);
    return next.access_token;
  })();
  refreshing.set(team, refresh);
  try { return await refresh; } finally { refreshing.delete(team); }
}

export function githubAuthorizeUrl(service: GitHubService, state: string, challenge: string): string {
  const config = appConfig(service);
  if (!config) throw new Error("GitHub App setup is required");
  const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${originUrl(service)}/api/github/oauth/callback`, state, code_challenge: challenge, code_challenge_method: "S256" });
  if (!config.slug) params.set("scope", "repo");
  return `https://github.com/login/oauth/authorize?${params}`;
}
