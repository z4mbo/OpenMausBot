import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { requireMember } from "./lib/permissions";
import { GitHubError, github, installationToken, parseRepository, revokeInstallationToken, type ParsedRepository } from "./lib/githubApi";
import { connection, NOT_SHARED, type Connection } from "./teamGitHub";

const ADMIN_ROLES = new Set(["owner", "admin"]);
const protectionState = v.union(v.literal("on"), v.literal("unavailable"), v.literal("error"));
const result = v.object({ state: protectionState, branch: v.string(), detail: v.optional(v.string()) });
export type ProtectionResult = { state: "on" | "unavailable" | "error"; branch: string; detail?: string };

/**
 * Security: the default branch takes changes only through a pull request with one approving review, and refuses
 * force-pushes and deletion, so the contents-write token agents push with cannot skip the merge a person confirms.
 * Repository admins keep GitHub's own override.
 */
export const PROTECTION = {
  required_status_checks: null, enforce_admins: false, restrictions: null, allow_force_pushes: false, allow_deletions: false,
  required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true, require_code_owner_reviews: false },
} as const;

type Existing = { required_pull_request_reviews?: { required_approving_review_count?: number } | null; allow_force_pushes?: { enabled?: boolean }; allow_deletions?: { enabled?: boolean } };
const KEEPS_RULES = "The default branch already has protection rules, which Origin does not replace. Require at least one approving review and turn off force pushes and deletion for it on GitHub, then check again.";

const UNAVAILABLE = "GitHub refused to protect the default branch. Private repositories need a paid GitHub plan (Pro, Team or Enterprise) for branch protection, and the Origin GitHub App needs Administration: write. Make the repository public or upgrade the account, then protect it again from the project's Repo tab.";

export async function protectRepository(found: Connection, repo: ParsedRepository): Promise<ProtectionResult> {
  const minted = await installationToken(found.secrets.app, found.row.installationId, { administration: "write", metadata: "read" }, repo);
  try {
    const path = `/repos/${repo.owner}/${repo.repo}`;
    const { default_branch: branch } = await github<{ default_branch: string }>(path, minted.token);
    const rules = `${path}/branches/${encodeURIComponent(branch)}/protection`;
    try {
      const existing = await github<Existing>(rules, minted.token).catch((error: unknown) => {
        if (error instanceof GitHubError && error.status === 404) return null;
        throw error;
      });
      if (existing) {
        const enough = (existing.required_pull_request_reviews?.required_approving_review_count ?? 0) >= 1 && !existing.allow_force_pushes?.enabled && !existing.allow_deletions?.enabled;
        return enough ? { state: "on", branch } : { state: "error", branch, detail: KEEPS_RULES };
      }
      await github(rules, minted.token, { method: "PUT", body: PROTECTION });
      return { state: "on", branch };
    } catch (error) {
      if (error instanceof GitHubError && error.status === 403) return { state: "unavailable", branch, detail: UNAVAILABLE };
      return { state: "error", branch, detail: error instanceof Error ? error.message : "Branch protection failed" };
    }
  } finally {
    await revokeInstallationToken(minted.token);
  }
}

export const record = internalMutation({
  args: { projectId: v.id("projects"), repoUrl: v.string(), branch: v.string(), state: protectionState, detail: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("githubBranchProtections").withIndex("by_projectId", q => q.eq("projectId", a.projectId)).unique();
    const fields = { ...a, checkedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("githubBranchProtections", fields);
    return null;
  },
});

/** Protects a repository Origin just created; a refusal is recorded for the project's Repo tab, never thrown. */
export async function protectCreated(ctx: ActionCtx, found: Connection, projectId: Id<"projects">, repoUrl: string): Promise<void> {
  const repo = parseRepository(repoUrl);
  if (!repo) return;
  const outcome = await protectRepository(found, repo).catch((error: unknown): ProtectionResult => ({ state: "error", branch: "", detail: error instanceof Error ? error.message : "Branch protection failed" }));
  await ctx.runMutation(internal.githubProtection.record, { projectId, repoUrl, ...outcome });
}

export const status = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  returns: v.union(v.null(), v.object({ state: protectionState, branch: v.string(), detail: v.optional(v.string()), checkedAt: v.number() })),
  handler: async (ctx, a) => {
    const { project } = await requireMember(ctx, a.projectId, a.sessionToken);
    const row = await ctx.db.query("githubBranchProtections").withIndex("by_projectId", q => q.eq("projectId", a.projectId)).unique();
    if (!row || row.repoUrl.toLowerCase() !== (project.repoUrl ?? "").toLowerCase()) return null;
    return { state: row.state, branch: row.branch, ...(row.detail ? { detail: row.detail } : {}), checkedAt: row.checkedAt };
  },
});

/** Protects the default branch of a repository a project already uses, for repositories linked before Origin did this itself. */
export const protect = action({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  returns: result,
  handler: async (ctx, a): Promise<ProtectionResult> => {
    const { role, project } = await ctx.runQuery(internal.teamGitHub.projectAccess, a);
    if (!ADMIN_ROLES.has(role)) throw new Error("A project admin protects the repository's default branch");
    if (project.status && project.status !== "active") throw new Error("Reactivate the project before changing its repository");
    const repo = parseRepository(project.repoUrl);
    if (!repo || !project.repoUrl) throw new Error("Link a GitHub repository to this project first");
    if (!project.githubWorkspaceAccess) throw new Error("A workspace admin approves this repository in the project's Repo tab first");
    const found = project.teamId ? await connection(ctx, project.teamId) : null;
    if (!found) throw new Error(NOT_SHARED);
    if (repo.owner.toLowerCase() !== found.row.accountLogin.toLowerCase()) throw new Error(`${repo.owner}/${repo.repo} is outside ${found.row.accountLogin}, the GitHub account this workspace is connected to`);
    const outcome = await protectRepository(found, repo);
    await ctx.runMutation(internal.githubProtection.record, { projectId: project._id, repoUrl: project.repoUrl, ...outcome });
    return outcome;
  },
});
