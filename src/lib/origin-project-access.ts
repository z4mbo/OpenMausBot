import { cloudMutation, cloudQueryOnce } from "@/lib/origin-cloud";
import type { WorkspaceMember, WorkspaceRole } from "@/lib/origin-members";

/** Who sees a project besides workspace owners and admins, who always see every project. */
export type AccessMode = "private" | "everyone" | "people";

export interface ProjectAccess { mode: AccessMode; emails: readonly string[] }

type ProjectRole = "member" | "viewer";
export interface Grant { email: string; role: ProjectRole }

interface ProjectRow { _id: string; email: string; role: WorkspaceRole; status: string }

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const seesEveryProject = (role: WorkspaceRole) => role === "owner" || role === "admin";

export const canCreateProjects = seesEveryProject;

/** The workspace members whose access this choice decides: everyone except admins, owners and the person choosing. */
export function grantable(members: readonly WorkspaceMember[], myEmail: string): WorkspaceMember[] {
  return members.filter((member) => !seesEveryProject(member.role) && !sameEmail(member.email, myEmail));
}

export function grantsFor(access: ProjectAccess, members: readonly WorkspaceMember[], myEmail: string): Grant[] {
  if (access.mode === "private") return [];
  const chosen = grantable(members, myEmail)
    .filter((member) => access.mode === "everyone" || access.emails.some((email) => sameEmail(email, member.email)));
  return chosen.map((member) => ({ email: member.email, role: member.role === "viewer" ? "viewer" : "member" }));
}

/** The project rows to add and remove so exactly the granted people hold one; owner rows and admins' rows stay. */
export function accessChanges(grants: readonly Grant[], rows: readonly ProjectRow[], members: readonly WorkspaceMember[]): { add: Grant[]; remove: string[] } {
  const admin = (email: string) => members.some((member) => sameEmail(member.email, email) && seesEveryProject(member.role));
  const held = rows.filter((row) => row.status === "active");
  return {
    add: grants.filter((grant) => !held.some((row) => sameEmail(row.email, grant.email))),
    remove: rows.filter((row) => row.role !== "owner" && !admin(row.email) && !grants.some((grant) => sameEmail(grant.email, row.email))).map((row) => row._id),
  };
}

/** Reads the current choice back from a project's rows. */
export function currentAccess(rows: readonly ProjectRow[], members: readonly WorkspaceMember[], myEmail: string): ProjectAccess {
  const candidates = grantable(members, myEmail);
  const inside = candidates.filter((member) => rows.some((row) => row.status === "active" && sameEmail(row.email, member.email)));
  if (!inside.length) return { mode: "private", emails: [] };
  if (inside.length === candidates.length) return { mode: "everyone", emails: inside.map((member) => member.email) };
  return { mode: "people", emails: inside.map((member) => member.email) };
}

export function accessSummary(access: ProjectAccess, members: readonly WorkspaceMember[], myEmail: string): string {
  if (access.mode === "private") return "Only you and workspace admins";
  if (access.mode === "everyone") return "Everyone in the workspace";
  const count = grantsFor(access, members, myEmail).length;
  return count === 1 ? "You, admins and 1 person" : `You, admins and ${count} people`;
}

async function applyGrants(projectId: string, add: readonly Grant[], remove: readonly string[]): Promise<string[]> {
  const failures: string[] = [];
  for (const grant of add) {
    try { await cloudMutation("members:addWorkspaceMember", { projectId, email: grant.email, role: grant.role }); }
    catch { failures.push(grant.email); }
  }
  for (const memberId of remove) {
    try { await cloudMutation("members:remove", { projectId, memberId }); }
    catch { failures.push(memberId); }
  }
  return failures;
}

/** Creates the Origin project and grants the chosen people access; returns the people the grant missed instead of failing the creation. */
export async function createOriginProject(args: { teamId: string; name: string; access: ProjectAccess; members: readonly WorkspaceMember[]; myEmail: string }): Promise<{ projectId: string; missed: string[] }> {
  const projectId = await cloudMutation<string>("projects:create", { teamId: args.teamId, name: args.name.trim() });
  const missed = await applyGrants(projectId, grantsFor(args.access, args.members, args.myEmail), []);
  return { projectId, missed };
}

export async function updateProjectAccess(args: { projectId: string; access: ProjectAccess; members: readonly WorkspaceMember[]; myEmail: string }): Promise<void> {
  const rows = await cloudQueryOnce<ProjectRow[]>("members:list", { projectId: args.projectId });
  const { add, remove } = accessChanges(grantsFor(args.access, args.members, args.myEmail), rows, args.members);
  const failures = await applyGrants(args.projectId, add, remove);
  if (failures.length) throw new Error(`Could not update access for ${failures.length === 1 ? "one person" : `${failures.length} people`}`);
}
