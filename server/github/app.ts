import { createSign } from "node:crypto";
import { brokeredToken, sameRepository } from "./broker.ts";
import { parseGitHubRepo } from "./repo.ts";
import { appConfig, githubRequest, type GitHubService } from "./service.ts";

export const prPermissions = { contents: "write", pull_requests: "write", checks: "read" } as const;
export const permissionNotice = "Tasks as pull requests needs Contents: write, Pull requests: write and Checks: read. The App owner must save these permissions and subscribe to pull_request, pull_request_review, check_suite and check_run (keep issues). Then open GitHub Settings > Applications > Installed GitHub Apps > Origin > Configure and accept the new permissions. Existing issue sync continues with the current permissions.";
type Installation = { id: number; account?: { id: number; login: string }; suspended_at?: string | null; permissions: Record<string, string> };
type Account = { id: number; login: string };

export function appJwt(service: GitHubService): string {
  const config = appConfig(service);
  if (!config?.appId || !config.privateKey) throw new Error("The App owner must configure GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY on the Origin server for PRs. Existing issue sync is available.");
  const now = Math.floor(service.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(config.appId) })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(config.privateKey, "base64url")}`;
}

export function repositoryPath(repoUrl: string): string {
  const repo = parseGitHubRepo(repoUrl);
  if (!repo || [repo.owner, repo.repo].some((part) => part === "." || part === "..")) throw new Error("GitHub repository required");
  return `/repos/${repo.owner}/${repo.repo}`;
}

async function installationFor(service: GitHubService, repoUrl: string, account?: Account) {
  const installation = await githubRequest<Installation>(service, `${repositoryPath(repoUrl)}/installation`, appJwt(service));
  if (account && (installation.account?.id !== account.id || installation.account.login.toLowerCase() !== account.login.toLowerCase())) throw new Error("Repository App installation does not belong to this workspace's connected GitHub account");
  if (installation.suspended_at || Object.entries(prPermissions).some(([key, level]) => installation.permissions[key] !== level && installation.permissions[key] !== "write")) throw new Error(permissionNotice);
  return installation;
}

/** Security: installation tokens live only in memory for GitHub's one-hour lifetime and are never persisted or returned to a model. */
/** `extra` widens the token by permissions such as Actions for Ship's workflow runs; the installation must have granted them. */
export async function installationToken(service: GitHubService, repoUrl: string, pushOnly = false, account?: Account, extra: Readonly<Record<string, string>> = {}) {
  const repo = parseGitHubRepo(repoUrl);
  if (!repo) throw new Error("GitHub repository required");
  const installation = await installationFor(service, repoUrl, account);
  const result = await githubRequest<{ token: string; expires_at: string; repositories?: { full_name: string }[] }>(service, `/app/installations/${installation.id}/access_tokens`, appJwt(service), {
    method: "POST", body: JSON.stringify({ repositories: [repo.repo], permissions: pushOnly ? { contents: "write" } : { ...prPermissions, ...extra } }),
  });
  const expires = Date.parse(result.expires_at);
  const now = service.now();
  if (!result.token || !Number.isFinite(expires) || expires <= now || expires > now + 65 * 60_000 || result.repositories?.length !== 1 || result.repositories[0].full_name.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase()) {
    if (result.token) await revokeInstallationToken(service, result.token);
    throw new Error("Unexpected installation token scope");
  }
  return { token: result.token, expiresAt: result.expires_at };
}

type ProjectContext = { project: { repoUrl?: string; githubWorkspaceAccess?: boolean }; connection: { teamId: string; login: string; connectedBy: string } | null };

/** Whether this server mints the project's installation tokens itself: it holds the App's key and the workspace's connection. */
async function mintsLocally(service: GitHubService, projectId: string): Promise<boolean> {
  const config = appConfig(service);
  if (!config?.appId || !config.privateKey) return false;
  const context = await service.bridge<ProjectContext>("context", { projectId });
  return Boolean(context.connection && service.store.workspaceInfo(context.connection.teamId));
}

async function projectAccount(service: GitHubService, projectId: string, repoUrl: string): Promise<Account> {
  const context = await service.bridge<ProjectContext>("context", { projectId });
  const connection = context.connection;
  const saved = connection ? service.store.workspaceInfo(connection.teamId) : null;
  const expected = parseGitHubRepo(repoUrl), current = parseGitHubRepo(context.project.repoUrl);
  const sameRepo = expected && current && `${expected.owner}/${expected.repo}`.toLowerCase() === `${current.owner}/${current.repo}`.toLowerCase();
  if (!context.project.githubWorkspaceAccess || !sameRepo || !connection || !saved || saved.connected_by !== connection.connectedBy || saved.login.toLowerCase() !== connection.login.toLowerCase()) {
    throw new Error("An active workspace admin must connect GitHub and authorize this repository before using the App for PRs");
  }
  return { id: saved.account_id, login: saved.login };
}

export async function projectInstallationToken(service: GitHubService, projectId: string, repoUrl: string, pushOnly = false, extra: Readonly<Record<string, string>> = {}) {
  const account = await projectAccount(service, projectId, repoUrl);
  const credentials = await installationToken(service, repoUrl, pushOnly, account, extra);
  try {
    const current = await projectAccount(service, projectId, repoUrl);
    if (current.id !== account.id || current.login.toLowerCase() !== account.login.toLowerCase()) throw new Error("GitHub connection changed during authorization");
    return credentials;
  } catch (error) {
    await revokeInstallationToken(service, credentials.token);
    throw error;
  }
}

/** Runs `fn` with an installation token for the project's repository: minted here, or by the backend from the workspace's shared connection. */
export async function withInstallation<T>(service: GitHubService, projectId: string, repoUrl: string, fn: (token: string) => Promise<T>, extra: Readonly<Record<string, string>> = {}): Promise<T> {
  if (!await mintsLocally(service, projectId)) {
    const brokered = await brokeredToken(service, projectId, "write", extra, repoUrl);
    if (!sameRepository(brokered.repoUrl, repoUrl)) throw new Error("The project's repository changed during authorization; reload and retry");
    return fn(brokered.token);
  }
  const { token } = await projectInstallationToken(service, projectId, repoUrl, false, extra);
  try { return await fn(token); }
  finally { await revokeInstallationToken(service, token); }
}

export async function revokeInstallationToken(service: Pick<GitHubService, "fetch">, token: string): Promise<void> {
  await service.fetch("https://api.github.com/installation/token", { method: "DELETE", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

/** A contents-only token for git in the project's folder; the caller keeps it in memory. */
export async function pushToken(service: GitHubService, projectId: string, repoUrl: string): Promise<{ token: string; expiresAt: string }> {
  if (await mintsLocally(service, projectId)) return projectInstallationToken(service, projectId, repoUrl, true);
  const brokered = await brokeredToken(service, projectId, "push", {}, repoUrl);
  if (!sameRepository(brokered.repoUrl, repoUrl)) throw new Error("The project's repository changed during authorization");
  return brokered;
}
