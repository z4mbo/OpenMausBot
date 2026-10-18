import { useEffect, useState } from "react";
import { cloudMutation, cloudUrl, useCloudQuery, useCloudUrl } from "@/lib/origin-cloud";
import { sessionStore } from "@/lib/origin-cloud/client";
import { normalizeOriginBackendUrl, resolveOriginSiteAddress, type OriginInviteDeliveryStatus } from "../../shared/origin-site-address";

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

export type CreatedInvite = { token: string; expiresAt: number; inviteLink: string; sent: boolean; deliveryStatus?: OriginInviteDeliveryStatus };

async function createServerInvite(args: { teamId: string; role: InviteRole; email?: string; projectId?: string }): Promise<CreatedInvite> {
  const convexUrl = normalizeOriginBackendUrl(cloudUrl());
  const sessionToken = sessionStore.get();
  if (!convexUrl) throw new Error("Connect to Origin before inviting people");
  if (!sessionToken) throw new Error("Sign in to Origin first");
  const response = await fetch("/api/origin/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...args, convexUrl, sessionToken }),
  });
  const body = await response.json().catch(() => ({})) as Partial<CreatedInvite> & { error?: string };
  if (sessionStore.get() !== sessionToken || normalizeOriginBackendUrl(cloudUrl()) !== convexUrl) throw new Error("Your Origin account or connection changed. Try again.");
  if (!response.ok || typeof body.inviteLink !== "string" || typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token) || typeof body.expiresAt !== "number" || typeof body.sent !== "boolean") throw new Error(body.error || `Invitation failed (${response.status})`);
  let siteUrl: string | null = null;
  try {
    const link = new URL(body.inviteLink);
    if (!link.username && !link.password) siteUrl = link.origin;
  } catch {}
  const address = resolveOriginSiteAddress({ convexUrl, siteUrl });
  if (!address) throw new Error("This Origin connection needs a public address before sharing invitations");
  return { ...body, inviteLink: joinLink(body.token, address) } as CreatedInvite;
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

export function useOriginInviteAddress(): string | null {
  const convexUrl = normalizeOriginBackendUrl(useCloudUrl());
  const fallback = resolveOriginSiteAddress({ convexUrl });
  const [resolved, setResolved] = useState<{ convexUrl: string | null; origin: string | null }>({ convexUrl, origin: fallback });
  if (resolved.convexUrl !== convexUrl) setResolved({ convexUrl, origin: fallback });
  useEffect(() => {
    if (!convexUrl) return;
    const controller = new AbortController();
    let live = true;
    void fetch("/api/origin/invite-address", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { origin?: unknown; convexUrl?: unknown } | null) => {
        if (!live || typeof body?.convexUrl !== "string" || normalizeOriginBackendUrl(body.convexUrl) !== convexUrl) return;
        const origin = resolveOriginSiteAddress({ convexUrl, siteUrl: typeof body.origin === "string" ? body.origin : null });
        setResolved({ convexUrl, origin });
      })
      .catch(() => undefined);
    return () => { live = false; controller.abort(); };
  }, [convexUrl]);
  return resolved.convexUrl === convexUrl ? resolved.origin : fallback;
}

export function joinLink(token: string, base: string): string {
  return `${base.replace(/\/+$/, "")}/join/${token}`;
}

export function feedbackLink(slug: string, base: string): string {
  return `${base.replace(/\/+$/, "")}/feedback/${slug}`;
}
