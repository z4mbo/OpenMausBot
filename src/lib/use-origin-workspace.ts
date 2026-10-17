import { useStore } from "@/state/store";
import { useCloudLinks } from "@/lib/origin-cloud-links";
import { useCloudSession } from "@/lib/origin-cloud";
import { useWorkspaceAccess, useWorkspaceMembers } from "@/lib/origin-members";
import { activeWorkspace, useWorkspaces, workspaceHeadsOf } from "@/lib/origin-workspaces";
import { canCreateProjects } from "@/lib/origin-project-access";

/** The open workspace's local head and the Origin workspace it is linked to. */
export function useActiveOriginWorkspace(): { headId?: string; teamId: string | null } {
  const { state } = useStore();
  const view = useWorkspaces();
  const links = useCloudLinks();
  const headId = activeWorkspace(view, workspaceHeadsOf(state.bots));
  return { headId, teamId: (headId && links.workspaces[headId]) || null };
}

/** Whether the signed-in person may create projects in this workspace: undefined while their role loads. A workspace not linked to Origin is local, so anyone may. */
export function useCanCreateProject(teamId: string | null): boolean | undefined {
  const access = useWorkspaceAccess(teamId);
  if (!teamId) return true;
  return access ? canCreateProjects(access.role) : undefined;
}

export function useWorkspacePeople(teamId: string | null) {
  const session = useCloudSession();
  const members = useWorkspaceMembers(teamId);
  return { members, myEmail: session.user?.email ?? "" };
}
