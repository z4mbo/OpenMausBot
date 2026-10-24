import { repositoryNameFor } from "../../shared/github-repo-name.ts";
import { originIssueKey } from "../../shared/origin-issues.ts";
import { jobPayload } from "./store.ts";
import { parseGitHubRepo, repoName } from "./repo.ts";
import { GitHubHttpError, githubRequest, workspaceGitHubToken, type GitHubService } from "./service.ts";
import { brokeredToken } from "./broker.ts";

type Connection = { teamId: string; login: string; connectedBy: string; autoCreate: boolean };
export type IntegrationContext = {
  credentialAllowed: boolean;
  legacyOwner: boolean;
  project: { _id: string; teamId?: string; name: string; status?: string; description?: string; repoUrl?: string; githubRepoId?: number; githubWorkspaceAccess?: boolean; githubRepoVisibility?: "private" | "public" };
  connection: Connection | null;
  task: {
    _id: string; title: string; description?: string; done: boolean; githubIssueNumber?: number; githubIssueUrl?: string; githubIssueState?: "open" | "closed"; githubIssueReopenRequested?: boolean;
    /** In the board's draft column. Absent from Origin Cloud deployments without draft columns. */
    draft?: boolean;
  } | null;
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
  let tokenError: string | undefined;
  if (!token && repo && context.project.githubWorkspaceAccess) {
    token = await brokeredToken(service, projectId, "write").then((minted) => minted.token, (error: unknown) => { tokenError = error instanceof Error ? error.message : undefined; return undefined; });
  }
  if (!token && context.legacyOwner) token = service.env.legacyToken;
  if (repo && context.task?.githubIssueUrl && context.task.githubIssueUrl.split("/issues/")[0].toLowerCase() !== `https://github.com/${repo.owner}/${repo.repo}`.toLowerCase()) throw new Error("This issue is linked to the previous repository");
  return { ...context, token, repo, tokenError };
}

const NO_CONNECTION = "GitHub isn't set up for this workspace yet. A workspace owner or admin connects it once in Settings > Integrations; then every member can use it.";

/** The token of this project's own GitHub connection (its saved connection, else the workspace's), never the legacy fallback. */
export async function projectConnection(service: GitHubService, projectId: string): Promise<{ repoUrl: string; token: string | undefined }> {
  const context = await contextWithToken(service, projectId);
  if (!context.repo) throw new Error("Link a GitHub repository to this project first");
  const repoUrl = `https://github.com/${context.repo.owner}/${context.repo.repo}`;
  return { repoUrl, token: context.token && context.token !== service.env.legacyToken ? context.token : undefined };
}

export async function createProjectRepository(service: GitHubService, projectId: string, manual = false, requestedName?: string, requestedVisibility?: "private" | "public"): Promise<RepositoryResult> {
  const { store } = service;
  const key = `repo:${projectId}`;
  if (!store.lockJob(key)) return { state: "working" };
  try {
    const context = await service.bridge<IntegrationContext>("context", { projectId });
    if (!context.project.repoUrl && context.connection && !store.workspaceInfo(context.connection.teamId)) {
      store.saveJob(key, "done");
      return await service.bridge<RepositoryResult>("createRepository", { projectId, manual, ...(requestedName ? { name: requestedName } : {}), ...(requestedVisibility ? { visibility: requestedVisibility } : {}) });
    }
    const visibility = requestedVisibility ?? context.project.githubRepoVisibility ?? "private";
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
    const name = requestedName ?? repositoryNameFor(context.project.name);
    const marker = `Origin project: ${projectId}`;
    if (!repo && saved.started) {
      try { repo = await githubRequest<Repository>(service, `/repos/${connection.login}/${typeof saved.name === "string" ? saved.name : name}`, token); }
      catch { throw new Error("The previous repository request could not be confirmed. Check GitHub before retrying."); }
      if (!repo.description?.includes(marker) || repo.owner.login.toLowerCase() !== connection.login.toLowerCase()) throw new Error("A repository with this name already exists and was not created by this project");
    }
    if (!repo) {
      store.saveJob(key, "working", { started: true, name });
      const description = [context.project.description && withoutControlCharacters(context.project.description).trim().slice(0, 200), marker].filter(Boolean).join(" | ");
      repo = await createOnGitHub<Repository>(service, key, "/user/repos", token, { name, description, private: visibility !== "public", has_issues: true, auto_init: true });
      store.saveJob(key, "working", { repo });
    }
    if (repo.owner.login.toLowerCase() !== connection.login.toLowerCase() || repo.private !== (visibility !== "public")) throw new Error("GitHub returned an unexpected repository owner or visibility. Review it on GitHub before linking.");
    await service.bridge("repoResult", { projectId, state: "ready", repoUrl: repo.html_url, repoId: repo.id });
    store.saveJob(key, "done", { repo });
    return { state: "ready", repoUrl: repo.html_url };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repository creation failed";
    keepPayloadAsError(service, key);
    await service.bridge("repoResult", { projectId, state: "error", error: message }).catch(() => undefined);
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
  const { task, repo, token, connection, project, tokenError } = await contextWithToken(service, projectId, taskId);
  if (project.status && project.status !== "active") throw new Error("Reactivate the project before creating GitHub issues");
  if (!task || !repo) throw new Error("Connect a GitHub repository first");
  const repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
  if (task.githubIssueNumber) return { ok: true, issueNumber: task.githubIssueNumber, issueUrl: task.githubIssueUrl, message: `Already linked to GitHub #${task.githubIssueNumber}` };
  if (task.draft) throw new Error(DRAFT_STAYS_LOCAL);
  if (!token) throw new Error(connection && !project.githubWorkspaceAccess
    ? "GitHub is connected. A workspace admin must enable this repository in the project's Repo tab."
    : tokenError ?? NO_CONNECTION);
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

export const DRAFT_STAYS_LOCAL = "This issue is in Draft, which stays in Origin. Move it to another column to create its GitHub issue.";

/**
 * What a sync pushes to GitHub. `close` closes the GitHub issue of a completed Origin issue as completed and keeps the link;
 * `reopen` reopens it after the Origin issue reopens; `remove` deletes the GitHub issue of one in Draft, which gets a new
 * one when it leaves Draft. A completion or reopening made on GitHub since the last sync wins and is pulled instead.
 */
export type IssueStateMove = "pull" | "close" | "remove" | "reopen";

export function issueStateMove(task: { done: boolean; draft?: boolean; githubIssueState?: "open" | "closed"; githubIssueReopenRequested?: boolean }, remote: "open" | "closed"): IssueStateMove {
  if (task.draft === true) return "remove";
  const local = task.done ? "closed" : "open";
  if (!task.githubIssueState || remote !== task.githubIssueState || local === remote) return "pull";
  if (local === "open") return task.githubIssueReopenRequested ? "reopen" : "pull";
  return "close";
}

async function syncTarget(service: GitHubService, target: Target, pushChanges = true) {
  const { token, repo, task, tokenError } = await contextWithToken(service, target.projectId, target.taskId);
  if (!repo || !token) throw new Error(tokenError ?? "Repository sync needs an authorized GitHub connection");
  const expectedRepo = parseGitHubRepo(target.repoUrl);
  if (!expectedRepo || repoName(repo) !== repoName(expectedRepo) || !task || task._id !== target.taskId || task.githubIssueNumber !== target.number) throw new Error("GitHub issue link changed; refresh before synchronizing");
  const path = `/repos/${repo.owner}/${repo.repo}/issues/${target.number}`;
  let issue = await githubRequest<GitHubIssue>(service, path, token);
  if (issue.pull_request) return;
  const move = pushChanges ? issueStateMove(task, issue.state) : "pull";
  if (move === "remove") {
    await removeGitHubIssue(service, target.projectId, target.taskId, `https://github.com/${repo.owner}/${repo.repo}/issues/${target.number}`, "Moved back to Draft in Origin");
    await service.bridge("unlinkIssue", { projectId: target.projectId, taskId: target.taskId, number: target.number });
    return;
  }
  if (move === "close") issue = await githubRequest<GitHubIssue>(service, path, token, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
  if (move === "reopen") issue = await githubRequest<GitHubIssue>(service, path, token, { method: "PATCH", body: JSON.stringify({ state: "open" }) });
  await link(service, target.projectId, target.taskId, `https://github.com/${repo.owner}/${repo.repo}`, issue);
}

/** Pushes one linked issue's Origin state to GitHub now instead of on the next sync: see `IssueStateMove`. */
export async function syncLinkedTask(service: GitHubService, projectId: string, taskId: string, number: number, repoUrl: string) {
  await syncTarget(service, { projectId, taskId, number, repoUrl });
}

export async function pushIssueState(service: GitHubService, projectId: string, taskId: string): Promise<MirrorResult> {
  try {
    const { task, repo } = await contextWithToken(service, projectId, taskId);
    if (!task || !repo) return { taskId };
    if (task.githubIssueNumber) {
      await syncLinkedTask(service, projectId, taskId, task.githubIssueNumber, `https://github.com/${repo.owner}/${repo.repo}`);
      return task.draft ? { taskId } : { taskId, issueNumber: task.githubIssueNumber };
    }
    if (task.done || task.draft) return { taskId };
    const created = await createGitHubTask(service, projectId, taskId);
    return { taskId, ...(created.issueNumber ? { issueNumber: created.issueNumber } : {}) };
  } catch (error) {
    return { taskId, error: error instanceof Error ? error.message : "GitHub issue sync failed" };
  }
}

export type GitHubIssueRemoval = {
  outcome: "deleted" | "closed" | "missing";
  number: number;
  /** Why a closed issue could not be deleted. */
  reason?: string;
};

type GraphQLReply = { data?: unknown; errors?: { type?: string; message?: string }[] };

async function issueOrGone(service: GitHubService, repoPath: string, number: number, token: string): Promise<(GitHubIssue & { node_id: string }) | null> {
  try { return await githubRequest(service, `${repoPath}/issues/${number}`, token); }
  catch (error) {
    if (!(error instanceof GitHubHttpError) || ![404, 410].includes(error.status)) throw error;
    await githubRequest(service, repoPath, token);
    return null;
  }
}

/**
 * Deletes the GitHub issue Origin created for this task. GitHub lets only repository admins delete issues, so without
 * that right, or for an issue Origin did not create, it is closed as not planned with a note instead.
 */
export async function removeGitHubIssue(service: GitHubService, projectId: string, taskId: string, issueUrl: string, cause = "Deleted in Origin"): Promise<GitHubIssueRemoval> {
  const { repo, token, tokenError } = await contextWithToken(service, projectId);
  if (!repo) throw new Error("This project has no GitHub repository");
  const repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
  const linked = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/issues\/(\d{1,9})$/.exec(issueUrl);
  if (!linked || linked[1].toLowerCase() !== repoUrl.toLowerCase()) throw new Error("This issue is linked to another repository; remove its GitHub issue there");
  const number = Number(linked[2]);
  if (!token) throw new Error(tokenError ?? NO_CONNECTION);
  const repoPath = `/repos/${repo.owner}/${repo.repo}`;
  const issue = await issueOrGone(service, repoPath, number, token);
  if (!issue) return { outcome: "missing", number };
  if (issue.pull_request) throw new Error(`GitHub #${number} is a pull request, not an issue`);
  let reason = "it was not created by Origin";
  if (issue.body?.includes(`<!-- origin-task:${taskId} -->`)) {
    const reply = await githubRequest<GraphQLReply>(service, "/graphql", token, {
      method: "POST", body: JSON.stringify({ query: "mutation($id:ID!){deleteIssue(input:{issueId:$id}){clientMutationId}}", variables: { id: issue.node_id } }),
    }).catch((error: unknown): GraphQLReply => {
      if (error instanceof GitHubHttpError && error.status === 403) return { errors: [{ type: "FORBIDDEN" }] };
      throw error;
    });
    if (!reply.errors?.length) return { outcome: "deleted", number };
    reason = reply.errors.some((error) => error.type === "FORBIDDEN")
      ? "Origin's GitHub connection is not an admin of this repository"
      : `GitHub refused to delete it (${(reply.errors[0].message ?? "unknown error").slice(0, 200)})`;
  }
  await githubRequest(service, `${repoPath}/issues/${number}`, token, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "not_planned" }) });
  await githubRequest(service, `${repoPath}/issues/${number}/comments`, token, {
    method: "POST", body: JSON.stringify({ body: `${cause} (${originIssueKey(taskId)}), so this issue is closed as not planned.` }),
  }).catch(() => undefined);
  return { outcome: "closed", number, reason };
}

export function removalSentence(removal: GitHubIssueRemoval): string {
  if (removal.outcome === "deleted") return `GitHub issue #${removal.number} was deleted too`;
  if (removal.outcome === "missing") return `GitHub issue #${removal.number} was already gone`;
  return `GitHub issue #${removal.number} was closed as not planned with a note instead of deleted, because ${removal.reason ?? "it could not be deleted"}`;
}

export type MirrorResult = { taskId: string; issueNumber?: number; error?: string };

/** Gives each Origin issue its GitHub issue, one at a time so a lost response is reconciled before the next. */
export async function mirrorTasks(service: GitHubService, projectId: string, taskIds: readonly string[]): Promise<MirrorResult[]> {
  const results: MirrorResult[] = [];
  for (const taskId of taskIds) {
    try {
      const created = await createGitHubTask(service, projectId, taskId);
      results.push({ taskId, ...(created.issueNumber ? { issueNumber: created.issueNumber } : {}) });
    } catch (error) {
      results.push({ taskId, error: error instanceof Error ? error.message : "GitHub issue creation failed" });
    }
  }
  return results;
}

/** One page of open issues without a GitHub issue, across projects whose repository a workspace admin authorized. */
export async function mirrorUnlinkedPage(service: GitHubService) {
  const cursorKey = "mirror-cursor";
  const saved = jobPayload(service.store.readJob(cursorKey));
  const page = await service.bridge<{ rows: { projectId: string; taskId: string }[]; nextCursor: string | null }>("unlinkedTasks", { cursor: typeof saved.cursor === "string" ? saved.cursor : null });
  const byProject = new Map<string, string[]>();
  for (const row of page.rows) byProject.set(row.projectId, [...byProject.get(row.projectId) ?? [], row.taskId]);
  for (const [projectId, taskIds] of byProject) {
    for (const result of await mirrorTasks(service, projectId, taskIds)) {
      if (result.error) console.warn("GitHub issue mirroring failed", result.taskId, result.error);
    }
  }
  service.store.saveJob(cursorKey, "done", { cursor: page.nextCursor });
}

export async function syncGitHubEvent(service: GitHubService, repoUrl: string, number: number) {
  const targets = await service.bridge<Target[]>("webhookTargets", { repoUrl, number });
  for (const target of targets) await syncTarget(service, { ...target, repoUrl, number }, false);
  return targets;
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
