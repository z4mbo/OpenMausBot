import { cloudMutation, cloudQueryOnce } from "@/lib/origin-cloud";
import { originGitHub } from "@/lib/origin-github";
import type { WorkspaceMember, WorkspaceRole } from "@/lib/origin-members";
import { repositoryNameFor } from "../../shared/github-repo-name";

export type RepositoryVisibility = "private" | "public";

/** A new project's repository: created under the workspace's GitHub connection (`name` null follows the project name), an existing one, or none yet. */
export type RepositoryChoice = { mode: "new"; name: string | null; visibility?: RepositoryVisibility } | { mode: "existing"; url: string } | { mode: "later" };

export type RepositoryOutcome = { state: "ready"; repoUrl: string } | { state: "working" | "waiting" | "later" } | { state: "error"; error: string };

/** Who sees a project besides workspace owners and admins, who always see every project. */
export type AccessMode = "private" | "everyone" | "people";

export interface ProjectAccess { mode: AccessMode; emails: readonly string[] }

type ProjectRole = "member" | "viewer";
export interface Grant { email: string; role: ProjectRole }

interface ProjectRow { _id: string; email: string; role: WorkspaceRole; status: string }

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const seesEveryProject = (role: WorkspaceRole) => role === "owner" || role === "admin";

export const canCreateProjects = (role: WorkspaceRole) => role !== "viewer";

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

/** An Origin backend without the `githubRepo` argument rejects it; the project is then created the older way. */
async function createProjectRecord(teamId: string, name: string, repository: RepositoryChoice): Promise<{ projectId: string; deferred: boolean }> {
  if (repository.mode === "existing") return { projectId: await cloudMutation<string>("projects:create", { teamId, name, repoUrl: repository.url }), deferred: false };
  const visibility = repository.mode === "new" && repository.visibility === "public" ? { githubRepoVisibility: "public" } : {};
  try {
    return { projectId: await cloudMutation<string>("projects:create", { teamId, name, githubRepo: "later", ...visibility }), deferred: true };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("githubRepo")) throw error;
    return { projectId: await cloudMutation<string>("projects:create", { teamId, name }), deferred: false };
  }
}

async function createRepository(teamId: string, projectId: string, name: string, visibility?: RepositoryVisibility): Promise<RepositoryOutcome> {
  try {
    const result = await originGitHub.createRepository(teamId, projectId, name, visibility);
    if (result.state === "ready" && result.repoUrl) return { state: "ready", repoUrl: result.repoUrl };
    if (result.state === "error") return { state: "error", error: result.error ?? "Repository creation failed" };
    return { state: result.state === "working" ? "working" : "waiting" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/connect github/i.test(message)) return { state: "error", error: message };
    await cloudMutation("integrations:retryRepo", { projectId }).catch(() => undefined);
    return { state: "waiting" };
  }
}

/** Creates the Origin project, its repository and grants the chosen people access; a missed grant or repository is reported, not thrown. */
export async function createOriginProject(args: { teamId: string; name: string; access: ProjectAccess; members: readonly WorkspaceMember[]; myEmail: string; repository?: RepositoryChoice }): Promise<{ projectId: string; missed: string[]; repository: RepositoryOutcome }> {
  const name = args.name.trim();
  const choice = args.repository ?? { mode: "new", name: null };
  const { projectId, deferred } = await createProjectRecord(args.teamId, name, choice);
  const missed = await applyGrants(projectId, grantsFor(args.access, args.members, args.myEmail), []);
  const repository: RepositoryOutcome = choice.mode === "existing" ? { state: "ready", repoUrl: choice.url }
    : choice.mode === "later" ? { state: "later" }
    : deferred ? await createRepository(args.teamId, projectId, choice.name ?? repositoryNameFor(name), choice.visibility)
    : { state: "waiting" };
  return { projectId, missed, repository };
}

export async function updateProjectAccess(args: { projectId: string; access: ProjectAccess; members: readonly WorkspaceMember[]; myEmail: string }): Promise<void> {
  const rows = await cloudQueryOnce<ProjectRow[]>("members:list", { projectId: args.projectId });
  const { add, remove } = accessChanges(grantsFor(args.access, args.members, args.myEmail), rows, args.members);
  const failures = await applyGrants(args.projectId, add, remove);
  if (failures.length) throw new Error(`Could not update access for ${failures.length === 1 ? "one person" : `${failures.length} people`}`);
}
