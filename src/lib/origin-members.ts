import { cloudAction, cloudMutation, cloudUrl, useCloudQuery } from "@/lib/origin-cloud";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export type InviteRole = Exclude<WorkspaceRole, "owner">;

export const INVITE_ROLES: readonly InviteRole[] = ["admin", "member", "viewer"];

export type WorkspaceMember = {
  _id: string;
  userId?: string;
  name: string;
  username?: string;
  email: string;
  role: WorkspaceRole;
  avatarUrl: string | null;
};

export type WorkspaceInvite = {
  _id: string;
  teamId: string;
  projectId?: string;
  token: string;
  email?: string;
  role: InviteRole;
  expiresAt: number;
  createdAt: number;
};

export type WorkspaceAccess = { teamId: string; slug: string; role: WorkspaceRole };

export const useWorkspaceAccess = (teamId: string | null) =>
  useCloudQuery<WorkspaceAccess>("workspaces:access", teamId ? { teamId } : "skip");

export const useWorkspaceMembers = (teamId: string | null) =>
  useCloudQuery<WorkspaceMember[]>("workspaces:members", teamId ? { teamId } : "skip");

/** Only admins and owners may read invitations; the backend rejects everyone else. */
export const useWorkspaceInvites = (teamId: string | null, isAdmin: boolean) =>
  useCloudQuery<WorkspaceInvite[]>("workspaces:invitations", teamId && isAdmin ? { teamId } : "skip");

export const originMembers = {
  createInvite: (args: { teamId: string; role: InviteRole; email?: string; projectId?: string }) =>
    cloudMutation<{ token: string; expiresAt: number; teamName: string }>("workspaces:createInvite", args),
  /** Creates the invite and emails it when the backend has an email provider; `sent` is false otherwise. */
  sendEmailInvite: (args: { teamId: string; email: string; role: InviteRole }) =>
    cloudAction<{ inviteLink: string; sent: boolean }>("workspaces:sendEmailInvite", args),
  revokeInvite: (inviteId: string) => cloudMutation<null>("workspaces:revokeInvite", { inviteId }),
  updateRole: (args: { teamId: string; memberId: string; role: InviteRole }) => cloudMutation<null>("teams:updateRole", args),
  removeMember: (args: { teamId: string; memberId: string }) => cloudMutation<null>("teams:removeMember", args),
  leave: (teamId: string) => cloudMutation<null>("teams:leave", { teamId }),
};

const WEB_URL_KEY = "origin-web-url";
const LOCAL_BACKEND = /^https?:\/\/(127\.0\.0\.1|localhost):3210\/?$/;
const LOCAL_WEB_APP = "http://localhost:3000";

/** The Origin web app that serves `/join/<token>`; the Convex backend URL is a different host. */
export function originWebUrl(): string | null {
  try {
    const stored = globalThis.localStorage?.getItem(WEB_URL_KEY)?.trim();
    if (stored) return stored.replace(/\/+$/, "");
  } catch {
    // Storage can be unavailable in a locked-down renderer; fall through to the defaults.
  }
  const fromEnv = (import.meta.env?.VITE_ORIGIN_WEB_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return LOCAL_BACKEND.test(cloudUrl() ?? "") ? LOCAL_WEB_APP : null;
}

export function setOriginWebUrl(url: string | null): void {
  try {
    const clean = url?.trim().replace(/\/+$/, "");
    if (clean) globalThis.localStorage?.setItem(WEB_URL_KEY, clean);
    else globalThis.localStorage?.removeItem(WEB_URL_KEY);
  } catch {
    return;
  }
}

export function rememberWebUrlFrom(inviteLink: string): void {
  try {
    setOriginWebUrl(new URL(inviteLink).origin);
  } catch {
    return;
  }
}

export function joinLink(token: string, base = originWebUrl()): string | null {
  return base ? `${base}/join/${token}` : null;
}
