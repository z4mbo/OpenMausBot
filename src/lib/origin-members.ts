import { useEffect, useState } from "react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { sessionStore } from "@/lib/origin-cloud/client";

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

export type CreatedInvite = { token: string; expiresAt: number; inviteLink: string; sent: boolean };

/** This app's server creates the invitation, builds its /join link from its own address, and emails it when mail is set up. */
async function createServerInvite(args: { teamId: string; role: InviteRole; email?: string; projectId?: string }): Promise<CreatedInvite> {
  const response = await fetch("/api/origin/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...args, sessionToken: sessionStore.get() }),
  });
  const body = await response.json().catch(() => ({})) as Partial<CreatedInvite> & { error?: string };
  if (!response.ok || typeof body.inviteLink !== "string") throw new Error(body.error || `Invitation failed (${response.status})`);
  return body as CreatedInvite;
}

export const originMembers = {
  createInvite: (args: { teamId: string; role: InviteRole; email?: string; projectId?: string }) => createServerInvite(args),
  revokeInvite: (inviteId: string) => cloudMutation<null>("workspaces:revokeInvite", { inviteId }),
  updateRole: (args: { teamId: string; memberId: string; role: InviteRole }) => cloudMutation<null>("teams:updateRole", args),
  removeMember: (args: { teamId: string; memberId: string }) => cloudMutation<null>("teams:removeMember", args),
  leave: (teamId: string) => cloudMutation<null>("teams:leave", { teamId }),
};

const currentOrigin = () => (typeof window === "undefined" ? "" : window.location.origin);

/** Where people outside this machine open this app: the server's configured public address, else this window's origin. */
export function useAppAddress(): string {
  const [address, setAddress] = useState(currentOrigin);
  useEffect(() => {
    let live = true;
    void fetch("/api/origin/app-address")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { origin?: unknown } | null) => {
        if (live && typeof body?.origin === "string" && body.origin) setAddress(body.origin.replace(/\/+$/, ""));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return address;
}

export function joinLink(token: string, base: string): string {
  return `${base.replace(/\/+$/, "")}/join/${token}`;
}

export function feedbackLink(slug: string, base: string): string {
  return `${base.replace(/\/+$/, "")}/feedback/${slug}`;
}
