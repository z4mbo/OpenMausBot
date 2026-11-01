export type GitHubAppSecrets = { appId: number; privateKey: string; clientId: string; clientSecret: string; slug?: string; webhookSecret?: string };
export type GitHubUserToken = { access_token: string; refresh_token?: string; expires_at?: number };

const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

/** GitHub's API origin; ORIGIN_GITHUB_API_URL may point a test deployment at a fake on 127.0.0.1 and nowhere else. */
export function githubApiOrigin(): string {
  const override = process.env.ORIGIN_GITHUB_API_URL?.trim().replace(/\/+$/, "");
  return override && LOOPBACK.test(override) ? override : "https://api.github.com";
}

export function githubWebOrigin(): string {
  const api = githubApiOrigin();
  return api === "https://api.github.com" ? "https://github.com" : api;
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function failure(status: number, detail: string): GitHubError {
  const message = status === 401 ? "GitHub refused the workspace's credentials. A workspace admin reconnects GitHub in Settings > Integrations."
    : [403, 429].includes(status) ? "GitHub permissions or rate limit prevented this action. Check the Origin GitHub App's access and try again later."
    : status === 404 ? "Repository not found, or the Origin GitHub App is not installed on it."
    : status === 422 ? `GitHub rejected this request${detail ? ` (${detail})` : ""}`
    : `GitHub request failed (${status})`;
  return new GitHubError(status, message);
}

export async function github<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${githubApiOrigin()}${path}`, {
    method: init.method ?? "GET",
    headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "origin-backend", "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${token}` },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    let detail = "";
    if (response.status === 422) {
      const payload = await response.json().catch(() => null) as { errors?: { field?: string; code?: string; message?: string }[]; message?: string } | null;
      detail = (payload?.errors ?? []).slice(0, 3).map((error) => `${error.field || "request"}: ${error.message || error.code || "invalid"}`).join("; ").slice(0, 300) || (payload?.message ?? "").slice(0, 300);
    }
    throw failure(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** GitHub hands out PKCS#1 keys; WebCrypto imports only PKCS#8, which wraps the same key with the rsaEncryption algorithm id. */
function pkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const pkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const body = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")), (char) => char.charCodeAt(0));
  if (!pkcs1) return body;
  const version = [0x02, 0x01, 0x00];
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const key = [0x04, ...derLength(body.length)];
  const inner = version.length + algorithm.length + key.length + body.length;
  return Uint8Array.from([0x30, ...derLength(inner), ...version, ...algorithm, ...key, ...body]);
}

const base64url = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function appJwt(app: Pick<GitHubAppSecrets, "appId" | "privateKey">): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(app.privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 9 * 60, iss: String(app.appId) })}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  return `${unsigned}.${base64url(signature)}`;
}

export type InstallationToken = { token: string; expiresAt: number };

/** Security: a token for one installation, narrowed to `repository` when given; GitHub caps its life at one hour. */
export async function installationToken(app: GitHubAppSecrets, installationId: number, permissions: Readonly<Record<string, string>>, repository?: { owner: string; repo: string }): Promise<InstallationToken> {
  const result = await github<{ token: string; expires_at: string; repositories?: { full_name: string }[] }>(`/app/installations/${installationId}/access_tokens`, await appJwt(app), {
    method: "POST", body: { ...(repository ? { repositories: [repository.repo] } : {}), permissions },
  });
  const expiresAt = Date.parse(result.expires_at);
  const now = Date.now();
  const scoped = !repository || (result.repositories?.length === 1 && result.repositories[0].full_name.toLowerCase() === `${repository.owner}/${repository.repo}`.toLowerCase());
  if (!result.token || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 65 * 60_000 || !scoped) {
    if (result.token) await revokeInstallationToken(result.token);
    throw new Error("GitHub returned an installation token with an unexpected scope");
  }
  return { token: result.token, expiresAt };
}

export async function revokeInstallationToken(token: string): Promise<void> {
  await fetch(`${githubApiOrigin()}/installation/token`, { method: "DELETE", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "origin-backend" }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

export async function refreshUserToken(app: GitHubAppSecrets, refreshToken: string): Promise<GitHubUserToken> {
  const response = await fetch(`${githubWebOrigin()}/login/oauth/access_token`, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "origin-backend" },
    body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.access_token || data.error) throw new Error("GitHub no longer accepts the workspace's connection. A workspace admin reconnects GitHub in Settings > Integrations.");
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined };
}

export type ParsedRepository = { owner: string; repo: string };

export function parseRepository(repoUrl: string | undefined): ParsedRepository | null {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(repoUrl?.trim() ?? "");
  if (!match || [match[1], match[2]].some((part) => part === "." || part === "..")) return null;
  return { owner: match[1], repo: match[2] };
}
