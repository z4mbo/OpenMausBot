import { api } from "@/state/store";
import { openExternalLink } from "./app-links";
import { sessionStore } from "./origin-cloud/client";

/** The workspace's GitHub connection as the backend holds it for every member. */
export interface SharedGitHub {
  accountLogin: string;
  accountType: "User" | "Organization";
  connectorLogin: string;
  sharedByName: string;
  updatedAt: number;
}

export interface GitHubWorkspaceStatus {
  configured: boolean;
  /** This server holds the GitHub App, so an admin can connect GitHub from here. */
  localApp: boolean;
  canSetup: boolean;
  /** The account repositories are created in, from this computer's connection or the workspace's shared one. */
  login: string | null;
  shared: SharedGitHub | null;
  /** The admin who shared the connection is no longer an admin, so it stopped working. */
  sharedStale: boolean;
  /** The backend can hold integrations (ORIGIN_SEALING_KEY is set). */
  sealing: boolean;
  canManage: boolean;
  /** This computer holds a connection the workspace does not have yet. */
  canShare: boolean;
  shareError: string | null;
  /** The caller's own GitHub account, when linked. */
  linkedLogin: string | null;
  prPermissionNotice: string | null;
  permissionApprovalUrl: string;
  installationUrl: string | null;
}

export interface GitHubProjectConnection {
  login: string;
  source: "project" | "workspace" | "shared";
  sharedBy?: string;
  updatedAt?: number;
}

export type RepositoryState = "ready" | "working" | "awaiting_connection" | "error";

function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = sessionStore.get();
  if (!session) return Promise.reject(new Error("Sign in to Origin first"));
  return api<T>(path, { ...init, headers: { "content-type": "application/json", "x-origin-session": session } });
}

const query = (params: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();

/** The GitHub routes of this server; GitHub's own pages open in the system browser. */
export const originGitHub = {
  workspace: (teamId: string) => call<GitHubWorkspaceStatus>(`/api/github/workspace?${query({ teamId })}`),
  disconnectWorkspace: (teamId: string) => call<{ ok: true }>(`/api/github/workspace?${query({ teamId })}`, { method: "DELETE" }),
  async connectWorkspace(teamId: string, projectId?: string) {
    const { url } = await call<{ url: string }>(`/api/github/oauth/start?${query({ teamId, projectId })}`, { method: "POST" });
    await openExternalLink(url);
  },
  async setupApp(teamId: string) {
    const { url } = await call<{ url: string }>(`/api/github/setup?${query({ teamId })}`, { method: "POST" });
    await openExternalLink(url);
  },
  connection: (projectId: string) => call<{ connection: GitHubProjectConnection | null }>(`/api/github/connection?${query({ projectId })}`),
  saveToken: (projectId: string, token: string) =>
    call<{ connection: GitHubProjectConnection | null }>(`/api/github/connection?${query({ projectId })}`, { method: "POST", body: JSON.stringify({ token }) }),
  removeToken: (projectId: string) => call<{ connection: null }>(`/api/github/connection?${query({ projectId })}`, { method: "DELETE" }),
  createRepository: (teamId: string, projectId: string, name?: string, visibility?: "private" | "public") =>
    call<{ state: RepositoryState; repoUrl?: string; error?: string }>(`/api/github/repo?${query({ teamId, projectId })}`, { method: "POST", body: JSON.stringify({ ...(name ? { name } : {}), ...(visibility ? { visibility } : {}) }) }),
  /** Hands this computer's GitHub connection to the backend so every member of the workspace uses it. */
  shareWorkspace: (teamId: string) => call<GitHubWorkspaceStatus>(`/api/github/share?${query({ teamId })}`, { method: "POST" }),
  repositories: (teamId: string) => call<{ login: string | null; repositories: GitHubRepository[] }>(`/api/github/repos?${query({ teamId })}`),
  repository: (projectId: string) => call<RepoSnapshot>(`/api/github/repo?${query({ projectId })}`),
  /** Creates the missing GitHub issues of open issues outside Draft; linked issues among `taskIds` get their done or Draft state pushed to GitHub. */
  mirrorIssues: (projectId: string, taskIds?: readonly string[]) =>
    call<{ results: { taskId: string; issueNumber?: number; error?: string }[] }>("/api/github/mirror", { method: "POST", body: JSON.stringify({ projectId, ...(taskIds ? { taskIds } : {}) }) }),
  openTaskPullRequest: (projectId: string, taskId: string) =>
    call<{ number: number; url: string; message: string }>("/api/github/pull-requests", { method: "POST", body: JSON.stringify({ projectId, taskId }) }),
  /** Deletes the Origin issue after removing its GitHub issue; a failure on GitHub keeps both. */
  deleteIssue: (projectId: string, taskId: string) =>
    call<{ message: string; github: GitHubIssueRemoval | null }>("/api/github/issues/delete", { method: "POST", body: JSON.stringify({ projectId, taskId }) }),
  /** A merge with `headSha` is refused when the pull request has a newer head than the one shown. */
  review: (projectId: string, number: number, action: "approve" | "merge", body?: string, headSha?: string) =>
    call<{ approved?: boolean; merged?: boolean; sha?: string; completed?: number[] }>("/api/github/pull-requests/review", { method: "POST", body: JSON.stringify({ projectId, number, action, ...(body ? { body } : {}), ...(headSha ? { headSha } : {}) }) }),
};

export interface GitHubRepository { fullName: string; url: string; private: boolean }

export interface GitHubIssueRemoval { outcome: "deleted" | "closed" | "missing"; number: number; reason?: string }

export type PullState = "draft" | "open" | "closed" | "merged";
export type ReviewDecision = "approved" | "changes_requested" | "review_required" | "commented";

export interface RepoPull {
  number: number;
  title: string;
  url: string;
  author?: string;
  branch?: string;
  state: PullState;
  closes: number[];
  updatedAt: number;
  checks?: string;
  review?: ReviewDecision;
}

export interface RepoIssue { number: number; title: string; state: "open" | "closed"; url: string; author?: string; updatedAt: number }
export interface RepoCommit { sha: string; url: string; message: string; author: string; committedAt: number }

export interface RepoSnapshot {
  repo: string;
  tokenConfigured: boolean;
  issues: RepoIssue[];
  pullRequests: RepoPull[];
  commits: RepoCommit[];
  commitsError: string;
}
