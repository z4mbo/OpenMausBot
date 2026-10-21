import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { canEdit } from "./lib/permissions";
import { seal, unseal } from "./lib/sealing";
import { GitHubError, github, parseRepository, refreshUserToken, type GitHubUserToken } from "./lib/githubApi";
import { connection, NOT_SHARED, type Connection } from "./teamGitHub";
import { revokeUserToken, userTokenPurpose } from "./githubLinks";

const TITLE_MAX = 256;
const BODY_MAX = 60_000;
const BRANCH = /^[\w./-]{1,200}$/;

type Opened = { state: "opened"; number: number; login: string } | { state: "unlinked" } | { state: "refused"; reason: string };
type Link = { login: string; sealed: string; clientId: string; linkedAt: number };

/** The person's own user-to-server token for the workspace's App, refreshed when it is about to expire, or null when they have none. */
async function memberToken(ctx: ActionCtx, found: Connection, userId: Id<"users">, link: Link): Promise<string | null> {
  const token = JSON.parse(await unseal(link.sealed, userTokenPurpose(userId))) as GitHubUserToken;
  if (!token.expires_at || token.expires_at > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token) return null;
  const next = await refreshUserToken(found.secrets.app, token.refresh_token).catch(() => null);
  if (!next) return null;
  const saved = await ctx.runMutation(internal.githubLinks.saveUserToken, { userId, linkedAt: link.linkedAt, sealed: await seal(JSON.stringify(next), userTokenPurpose(userId)) });
  if (saved) return next.access_token;
  await revokeUserToken(found.secrets.app, next.access_token);
  return null;
}

/**
 * Opens an issue's draft pull request under the caller's own GitHub account, so GitHub attributes it to them and the
 * Chief's App review counts as another reviewer's. Answers "unlinked" or "refused" instead of throwing when the
 * person has no usable link or GitHub turns their account away, so their Origin server opens it as the App instead.
 * Security: only the issue's own branch in the project's approved repository, and the token never leaves the backend.
 */
export const openAsMember = action({
  args: { sessionToken: v.string(), projectId: v.id("projects"), taskId: v.id("tasks"), head: v.string(), base: v.string(), title: v.string(), body: v.string() },
  returns: v.union(
    v.object({ state: v.literal("opened"), number: v.number(), login: v.string() }),
    v.object({ state: v.literal("unlinked") }),
    v.object({ state: v.literal("refused"), reason: v.string() }),
  ),
  handler: async (ctx, a): Promise<Opened> => {
    const access = await ctx.runQuery(internal.teamGitHub.projectAccess, { sessionToken: a.sessionToken, projectId: a.projectId });
    if (!canEdit(access)) throw new Error("Edit role required");
    const { project } = access;
    if (project.status && project.status !== "active") throw new Error("Reactivate the project before using GitHub");
    const repo = parseRepository(project.repoUrl);
    if (!repo || !project.githubWorkspaceAccess) throw new Error("A workspace admin approves this project's repository before pull requests open on it");
    const branch = await ctx.runQuery(internal.teamGitHub.taskBranch, { projectId: a.projectId, taskId: a.taskId });
    if (!branch || a.head !== branch || !BRANCH.test(a.head) || !BRANCH.test(a.base) || a.head === a.base) throw new Error("That branch is not this issue's branch");
    if (!a.title.trim() || a.title.length > TITLE_MAX || a.body.length > BODY_MAX) throw new Error("Pull request title or description is too long");
    const found = project.teamId ? await connection(ctx, project.teamId) : null;
    if (!found) throw new Error(NOT_SHARED);
    if (repo.owner.toLowerCase() !== found.row.accountLogin.toLowerCase()) throw new Error(`${repo.owner}/${repo.repo} is outside ${found.row.accountLogin}, the GitHub account this workspace is connected to`);
    const link = await ctx.runQuery(internal.githubLinks.userTokenRow, { userId: access.userId });
    if (!link || link.clientId !== found.secrets.app.clientId) return { state: "unlinked" };
    const token = await memberToken(ctx, found, access.userId, link);
    if (!token) return { state: "unlinked" };
    try {
      const pr = await github<{ number: number; user?: { login?: string } | null }>(`/repos/${repo.owner}/${repo.repo}/pulls`, token, {
        method: "POST", body: { head: a.head, base: a.base, title: a.title, body: a.body, draft: true },
      });
      return { state: "opened", number: pr.number, login: pr.user?.login ?? link.login };
    } catch (error) {
      if (error instanceof GitHubError && [401, 403, 404, 422].includes(error.status)) return { state: "refused", reason: error.message };
      throw error;
    }
  },
});
