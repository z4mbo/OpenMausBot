import { jobPayload } from "./store.ts";
import { parseGitHubRepo, repoName } from "./repo.ts";
import { GitHubHttpError, githubRequest, workspaceGitHubToken, type GitHubService } from "./service.ts";

type Connection = { teamId: string; login: string; connectedBy: string; autoCreate: boolean };
export type IntegrationContext = {
  credentialAllowed: boolean;
  legacyOwner: boolean;
  project: { _id: string; teamId?: string; name: string; status?: string; description?: string; repoUrl?: string; githubRepoId?: number; githubWorkspaceAccess?: boolean };
  connection: Connection | null;
  task: { _id: string; title: string; description?: string; done: boolean; githubIssueNumber?: number; githubIssueUrl?: string } | null;
};
type GitHubIssue = { number: number; html_url: string; state: "open" | "closed"; updated_at: string; body?: string; pull_request?: unknown };
type Target = { projectId: string; taskId: string; repoUrl: string; number: number };
type Repository = { id: number; html_url: string; description: string; owner: { login: string }; private: boolean };
export type RepositoryResult = { state: "ready" | "working" | "awaiting_connection" | "error"; repoUrl?: string; error?: string };

/** A definitive rejection may be retried; an unknown network outcome keeps its intent marker so a retry reconciles instead of duplicating. */
async function createOnGitHub<T>(service: GitHubService, key: string, path: string, token: string, body: unknown): Promise<T> {
  try { return await githubRequest<T>(service, path, token, { method: "POST", body: JSON.stringify(body) }); }
  catch (error) {
    if (error instanceof GitHubHttpError && [400, 401, 403, 404, 422, 429].includes(error.status)) service.store.saveJob(key, "working");
    throw error;
  }
}

const isControl = (code: number) => code < 0x20 || (code >= 0x7f && code <= 0x9f);

export function withoutControlCharacters(text: string): string {
  let out = "";
  let inRun = false;
  for (const char of text) {
    if (isControl(char.charCodeAt(0))) {
      if (!inRun) out += " ";
      inRun = true;
    } else {
      out += char;
      inRun = false;
    }
  }
  return out;
}

function keepPayloadAsError(service: GitHubService, key: string) {
  const previous = service.store.readJob(key);
  service.store.saveJob(key, "error", previous?.payload ? JSON.parse(previous.payload) : undefined);
}

async function contextWithToken(service: GitHubService, projectId: string, taskId?: string) {
  let context = await service.bridge<IntegrationContext>("context", { projectId, taskId });
  const repo = parseGitHubRepo(context.project.repoUrl);
  let token: string | undefined;
  if (repo) {
    const existing = service.store.connectionInfo(projectId, repoName(repo));
    if (existing) {
      context = await service.bridge<IntegrationContext>("context", { projectId, taskId, credentialOwner: existing.connectedBy });
      if (context.credentialAllowed) token = service.store.connectionToken(projectId, repoName(repo));
    }
  }
  if (!token && context.project.githubWorkspaceAccess && context.connection) token = await workspaceGitHubToken(service, context.connection.teamId, context.connection.connectedBy);
  if (!token && context.legacyOwner) token = service.env.legacyToken;
  if (repo && context.task?.githubIssueUrl && context.task.githubIssueUrl.split("/issues/")[0].toLowerCase() !== `https://github.com/${repo.owner}/${repo.repo}`.toLowerCase()) throw new Error("This issue is linked to the previous repository");
  return { ...context, token, repo };
}

export async function createProjectRepository(service: GitHubService, projectId: string, manual = false): Promise<RepositoryResult> {
  const { store } = service;
  const key = `repo:${projectId}`;
  if (!store.lockJob(key)) return { state: "working" };
  try {
    const context = await service.bridge<IntegrationContext>("context", { projectId });
    if (context.project.status && context.project.status !== "active") { store.saveJob(key, "waiting"); return { state: "error", error: "Reactivate the project before creating a repository" }; }
    if (context.project.repoUrl) { store.saveJob(key, "done"); return { state: "ready", repoUrl: context.project.repoUrl }; }
    if (!context.connection || (!manual && !context.connection.autoCreate)) {
      await service.bridge("repoResult", { projectId, state: "awaiting_connection" });
      store.saveJob(key, "waiting");
      return { state: "awaiting_connection" };
    }
    const connection = context.connection;
    const token = await workspaceGitHubToken(service, connection.teamId, connection.connectedBy);
    if (!token) throw new Error("Reconnect GitHub in workspace settings");
    const saved = jobPayload(store.readJob(key));
    let repo = saved.repo as Repository | undefined;
    const name = `${context.project.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "project"}-${projectId.slice(-6)}`;
    const marker = `Origin project: ${projectId}`;
    if (!repo && saved.started) {
      try { repo = await githubRequest<Repository>(service, `/repos/${connection.login}/${typeof saved.name === "string" ? saved.name : name}`, token); }
      catch { throw new Error("The previous repository request could not be confirmed. Check GitHub before retrying."); }
      if (!repo.description?.includes(marker) || repo.owner.login.toLowerCase() !== connection.login.toLowerCase()) throw new Error("A repository with this name already exists and was not created by this project");
    }
    if (!repo) {
      store.saveJob(key, "working", { started: true, name });
      const description = [context.project.description && withoutControlCharacters(context.project.description).trim().slice(0, 200), marker].filter(Boolean).join(" | ");
      repo = await createOnGitHub<Repository>(service, key, "/user/repos", token, { name, description, private: true, has_issues: true, auto_init: true });
      store.saveJob(key, "working", { repo });
    }
    if (repo.owner.login.toLowerCase() !== connection.login.toLowerCase() || !repo.private) throw new Error("GitHub returned an unexpected repository owner or visibility. Review it on GitHub before linking.");
    await service.bridge("repoResult", { projectId, state: "ready", repoUrl: repo.html_url, repoId: repo.id });
    store.saveJob(key, "done", { repo });
    return { state: "ready", repoUrl: repo.html_url };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repository creation failed";
    keepPayloadAsError(service, key);
    await service.bridge("repoResult", { projectId, state: "error", error: message });
    return { state: "error", error: message };
  }
}

async function link(service: GitHubService, projectId: string, taskId: string, repoUrl: string, issue: GitHubIssue) {
  const updatedAt = Date.parse(issue.updated_at);
  if (!Number.isFinite(updatedAt) || !Number.isInteger(issue.number)) throw new Error("Invalid GitHub issue response");
  await service.bridge("linkIssue", { projectId, taskId, repoUrl, number: issue.number, issueUrl: `${repoUrl}/issues/${issue.number}`, state: issue.state, updatedAt });
}

export async function createGitHubTask(service: GitHubService, projectId: string, taskId: string) {
  const { store } = service;
  const { task, repo, token, connection, project } = await contextWithToken(service, projectId, taskId);
  if (project.status && project.status !== "active") throw new Error("Reactivate the project before creating GitHub issues");
  if (!task || !repo) throw new Error("Connect a GitHub repository first");
  const repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
  if (task.githubIssueNumber) return { ok: true, issueNumber: task.githubIssueNumber, issueUrl: task.githubIssueUrl, message: `Already linked to GitHub #${task.githubIssueNumber}` };
  if (!token) throw new Error(connection && !project.githubWorkspaceAccess
    ? "GitHub is connected. A workspace admin must enable this repository in the project's Repo tab."
    : "A workspace admin needs to reconnect GitHub in Settings > Integrations");
  const key = `issue:${taskId}:${repoUrl.toLowerCase()}`;
  if (!store.lockJob(key)) throw new Error("This issue is already being created. Wait a moment before retrying.");
  try {
    const saved = jobPayload(store.readJob(key));
    let issue = saved.issue as GitHubIssue | undefined;
    const marker = `<!-- origin-task:${taskId} -->`;
    if (!issue && saved.started) {
      const recent = await githubRequest<GitHubIssue[]>(service, `/repos/${repo.owner}/${repo.repo}/issues?state=all&sort=created&direction=desc&per_page=100`, token);
      issue = recent.find((candidate) => !candidate.pull_request && candidate.body?.includes(marker));
      if (!issue) throw new Error("The previous GitHub request has an unknown result. Check the repository before trying another issue; Origin will not create a duplicate.");
    }
    if (!issue) {
      store.saveJob(key, "working", { started: true });
      issue = await createOnGitHub<GitHubIssue>(service, key, `/repos/${repo.owner}/${repo.repo}/issues`, token, { title: task.title, body: `${task.description || ""}\n\n${marker}`.trim() });
      store.saveJob(key, "working", { issue });
    }
    await link(service, projectId, taskId, repoUrl, issue);
    store.saveJob(key, "done", { issue });
    return { ok: true, issueNumber: issue.number, issueUrl: issue.html_url, message: `Created GitHub issue #${issue.number}` };
  } catch (error) {
    keepPayloadAsError(service, key);
    throw error;
  }
}

async function syncTarget(service: GitHubService, target: Target) {
  const { token, repo } = await contextWithToken(service, target.projectId, target.taskId);
  if (!repo || !token) throw new Error("Repository sync needs an authorized GitHub connection");
  const issue = await githubRequest<GitHubIssue>(service, `/repos/${repo.owner}/${repo.repo}/issues/${target.number}`, token);
  if (!issue.pull_request) await link(service, target.projectId, target.taskId, `https://github.com/${repo.owner}/${repo.repo}`, issue);
}

export async function syncGitHubEvent(service: GitHubService, repoUrl: string, number: number) {
  const targets = await service.bridge<Target[]>("webhookTargets", { repoUrl, number });
  for (const target of targets) await syncTarget(service, target);
}

export async function syncGitHubPage(service: GitHubService) {
  const cursorKey = "sync-cursor";
  const saved = jobPayload(service.store.readJob(cursorKey));
  const page = await service.bridge<{ rows: Target[]; nextCursor: string | null }>("targets", { cursor: typeof saved.cursor === "string" ? saved.cursor : null });
  await Promise.all(page.rows.map(async (target) => {
    try { await syncTarget(service, target); }
    catch (error) { console.warn("GitHub issue sync failed", target.taskId, error instanceof Error ? error.message : "Unknown error"); }
  }));
  service.store.saveJob(cursorKey, "done", { cursor: page.nextCursor });
}
