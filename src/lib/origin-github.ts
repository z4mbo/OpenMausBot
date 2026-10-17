import { api } from "@/state/store";
import { openExternalLink } from "./app-links";
import { sessionStore } from "./origin-cloud/client";

export interface GitHubWorkspaceStatus {
  configured: boolean;
  canSetup: boolean;
  login: string | null;
  prPermissionNotice: string | null;
  permissionApprovalUrl: string;
  installationUrl: string | null;
}

export interface GitHubProjectConnection {
  login: string;
  source: "project" | "workspace";
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
  createRepository: (teamId: string, projectId: string) =>
    call<{ state: RepositoryState; repoUrl?: string; error?: string }>(`/api/github/repo?${query({ teamId, projectId })}`, { method: "POST" }),
};
