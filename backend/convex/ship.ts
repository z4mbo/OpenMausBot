import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, requireAdmin, requireMember } from "./lib/permissions";
import { cleanText } from "./lib/features";
import { mergedPull, shipProvider } from "./shipTables";
import { isReleaseTag, SHIP_LIMITS } from "../../shared/origin-ship";

type Ctx = QueryCtx | MutationCtx;

const TARGETS_MAX = 12;
const RELEASES_SHOWN = 30;
const AGENT_NAME_MAX = 80;
/** A publish the app never finished, after a crash or a lost connection, may be retried after this long. */
const PUBLISH_STALE_MS = 5 * 60_000;

const agentInput = v.object({ botId: v.string(), name: v.string() });

async function editorOf(ctx: Ctx, projectId: Id<"projects">, sessionToken: string) {
  const access = await requireMember(ctx, projectId, sessionToken);
  if (!canEdit(access.member)) throw new Error("Edit role required");
  return access;
}

async function targetOf(ctx: Ctx, projectId: Id<"projects">, targetId: Id<"shipTargets">) {
  const target = await ctx.db.get(targetId);
  if (!target || target.projectId !== projectId) throw new Error("Deploy target not found");
  return target;
}

async function releaseOf(ctx: Ctx, projectId: Id<"projects">, releaseId: Id<"shipReleases">) {
  const release = await ctx.db.get(releaseId);
  if (!release || release.projectId !== projectId) throw new Error("Release not found");
  return release;
}

function optionalText(value: string | undefined, max: number, label: string) {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (text.length > max) throw new Error(`${label} must be at most ${max} characters`);
  return text || undefined;
}

function siteAddress(value: string | undefined) {
  const text = optionalText(value, SHIP_LIMITS.url, "Site address");
  if (!text) return undefined;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error("Site address must be a full https:// address"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Site address must be a full https:// address");
  return url.toString().replace(/\/$/, "");
}

function releaseView(release: Doc<"shipReleases">, approver: string | undefined) {
  return {
    _id: release._id, tag: release.tag, title: release.title, notes: release.notes, status: release.status, pulls: release.pulls, announce: release.announce,
    ...(release.baseTag ? { baseTag: release.baseTag } : {}), ...(release.targetId ? { targetId: release.targetId } : {}),
    ...(release.agentName ? { agentName: release.agentName } : {}), ...(approver ? { approvedByName: approver } : {}),
    ...(release.releaseUrl ? { releaseUrl: release.releaseUrl } : {}), ...(release.deployNote ? { deployNote: release.deployNote } : {}),
    ...(release.broadcastPostId ? { broadcastPostId: release.broadcastPostId } : {}), ...(release.error ? { error: release.error } : {}),
    ...(release.publishedAt ? { publishedAt: release.publishedAt } : {}), createdAt: release.createdAt, updatedAt: release.updatedAt,
  };
}

export const overview = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { member, project } = await requireMember(ctx, args.projectId, args.sessionToken);
    const targets = await ctx.db.query("shipTargets").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).take(TARGETS_MAX);
    const releases = await ctx.db.query("shipReleases").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(RELEASES_SHOWN);
    const names = new Map<Id<"users">, string>();
    for (const release of releases) {
      if (release.approvedBy && !names.has(release.approvedBy)) names.set(release.approvedBy, (await ctx.db.get(release.approvedBy))?.name ?? "");
    }
    return {
      canEdit: canEdit(member), isAdmin: member.role === "owner" || member.role === "admin", repoUrl: project.repoUrl ?? null,
      targets: targets.map((target) => ({
        _id: target._id, provider: target.provider, name: target.name, ref: target.ref, branch: target.branch,
        ...(target.account ? { account: target.account } : {}), ...(target.siteUrl ? { siteUrl: target.siteUrl } : {}), createdAt: target.createdAt, updatedAt: target.updatedAt,
      })),
      releases: releases.map((release) => releaseView(release, release.approvedBy ? names.get(release.approvedBy) || undefined : undefined)),
    };
  },
});

export const saveTarget = mutation({
  args: {
    sessionToken: v.string(), projectId: v.id("projects"), targetId: v.optional(v.id("shipTargets")),
    provider: shipProvider, name: v.string(), ref: v.string(), account: v.optional(v.string()), branch: v.string(), siteUrl: v.optional(v.string()),
  },
  returns: v.id("shipTargets"),
  handler: async (ctx, args) => {
    const { user } = await requireAdmin(ctx, args.projectId, args.sessionToken);
    const fields = {
      provider: args.provider,
      name: cleanText(args.name, SHIP_LIMITS.name, "Name"),
      ref: cleanText(args.ref, SHIP_LIMITS.ref, args.provider === "github-actions" ? "Workflow file" : "Project"),
      account: optionalText(args.account, SHIP_LIMITS.account, "Account"),
      branch: cleanText(args.branch, SHIP_LIMITS.branch, "Branch"),
      siteUrl: siteAddress(args.siteUrl),
    };
    if (/[\s?#]/.test(fields.ref) || /\s/.test(fields.branch)) throw new Error("Project and branch cannot contain spaces");
    if (fields.provider === "cloudflare" && !fields.account) throw new Error("Cloudflare Pages needs the account ID");
    if (fields.provider === "github-actions" && !/^[\w.-]+\.ya?ml$|^\d+$/.test(fields.ref)) throw new Error("Give the workflow file name, like deploy.yml");
    const now = Date.now();
    if (args.targetId) {
      await targetOf(ctx, args.projectId, args.targetId);
      await ctx.db.patch(args.targetId, { ...fields, updatedAt: now });
      return args.targetId;
    }
    const existing = await ctx.db.query("shipTargets").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).take(TARGETS_MAX);
    if (existing.length >= TARGETS_MAX) throw new Error(`A project ships to at most ${TARGETS_MAX} targets`);
    return ctx.db.insert("shipTargets", { projectId: args.projectId, ...fields, createdBy: user._id, createdAt: now, updatedAt: now });
  },
});

export const removeTarget = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), targetId: v.id("shipTargets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.projectId, args.sessionToken);
    await targetOf(ctx, args.projectId, args.targetId);
    const releases = await ctx.db.query("shipReleases").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(200);
    for (const release of releases) if (release.targetId === args.targetId && release.status !== "published") await ctx.db.patch(release._id, { targetId: undefined });
    await ctx.db.delete(args.targetId);
    return null;
  },
});

export const saveRelease = mutation({
  args: {
    sessionToken: v.string(), projectId: v.id("projects"), releaseId: v.optional(v.id("shipReleases")),
    tag: v.string(), title: v.optional(v.string()), notes: v.string(), baseTag: v.optional(v.string()), pulls: v.optional(v.array(mergedPull)),
    targetId: v.optional(v.union(v.id("shipTargets"), v.null())), announce: v.optional(v.boolean()), agent: v.optional(agentInput),
  },
  returns: v.id("shipReleases"),
  handler: async (ctx, args) => {
    const { user } = await editorOf(ctx, args.projectId, args.sessionToken);
    const tag = args.tag.trim();
    if (!isReleaseTag(tag)) throw new Error("Give the tag as letters, digits, dots and hyphens, like v1.4.0");
    const notes = args.notes.trim();
    if (notes.length > SHIP_LIMITS.notes) throw new Error(`Notes must be at most ${SHIP_LIMITS.notes} characters`);
    if (args.pulls && args.pulls.length > SHIP_LIMITS.pulls) throw new Error(`A release lists at most ${SHIP_LIMITS.pulls} pull requests`);
    if (args.targetId) await targetOf(ctx, args.projectId, args.targetId);
    const others = await ctx.db.query("shipReleases").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).take(500);
    if (others.some((release) => release._id !== args.releaseId && release.status !== "failed" && release.tag.toLowerCase() === tag.toLowerCase())) throw new Error(`${tag} is already a release of this project`);
    const title = optionalText(args.title, SHIP_LIMITS.title, "Title") ?? tag;
    const agent = args.agent ? { agentName: args.agent.name.trim().slice(0, AGENT_NAME_MAX) || "Agent", agentBotId: args.agent.botId.slice(0, AGENT_NAME_MAX) } : {};
    const now = Date.now();
    if (!args.releaseId) {
      return ctx.db.insert("shipReleases", {
        projectId: args.projectId, tag, title, notes, status: "draft", pulls: args.pulls ?? [], announce: args.announce ?? false,
        ...(args.baseTag?.trim() ? { baseTag: args.baseTag.trim().slice(0, SHIP_LIMITS.tag) } : {}), ...(args.targetId ? { targetId: args.targetId } : {}),
        ...agent, createdBy: user._id, createdAt: now, updatedAt: now,
      });
    }
    const release = await releaseOf(ctx, args.projectId, args.releaseId);
    if (release.status === "publishing" || release.status === "published") throw new Error(`${release.tag} is already ${release.status}`);
    await ctx.db.patch(release._id, {
      tag, title, notes, status: "draft", error: undefined, updatedAt: now, ...agent,
      ...(args.pulls ? { pulls: args.pulls } : {}), ...(args.baseTag !== undefined ? { baseTag: args.baseTag.trim().slice(0, SHIP_LIMITS.tag) || undefined } : {}),
      ...(args.targetId !== undefined ? { targetId: args.targetId ?? undefined } : {}), ...(args.announce !== undefined ? { announce: args.announce } : {}),
    });
    return release._id;
  },
});

export const removeRelease = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), releaseId: v.id("shipReleases") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await editorOf(ctx, args.projectId, args.sessionToken);
    const release = await releaseOf(ctx, args.projectId, args.releaseId);
    if (release.status === "publishing" || release.status === "published") throw new Error("A published release stays in the history");
    await ctx.db.delete(release._id);
    return null;
  },
});

/** A project admin's approval: the release moves to publishing, so a second approval cannot create the tag twice. */
export const beginPublish = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), releaseId: v.id("shipReleases") },
  handler: async (ctx, args) => {
    const { user, project } = await requireAdmin(ctx, args.projectId, args.sessionToken);
    const release = await releaseOf(ctx, args.projectId, args.releaseId);
    const now = Date.now();
    const stale = release.status === "publishing" && now - release.updatedAt > PUBLISH_STALE_MS;
    if (release.status !== "draft" && release.status !== "failed" && !stale) throw new Error(`${release.tag} is already ${release.status}`);
    if (!project.repoUrl) throw new Error("Link a GitHub repository to this project first");
    await ctx.db.patch(release._id, { status: "publishing", approvedBy: user._id, approvedAt: now, error: undefined, updatedAt: now });
    const target = release.targetId ? await ctx.db.get(release.targetId) : null;
    return {
      tag: release.tag, title: release.title, notes: release.notes, announce: release.announce, repoUrl: project.repoUrl, projectName: project.name,
      ...(target && target.projectId === args.projectId ? { targetId: target._id } : {}),
      ...(release.agentName ? { agentName: release.agentName } : {}), ...(release.agentBotId ? { agentBotId: release.agentBotId } : {}),
    };
  },
});

export const finishPublish = mutation({
  args: {
    sessionToken: v.string(), projectId: v.id("projects"), releaseId: v.id("shipReleases"),
    releaseUrl: v.optional(v.string()), error: v.optional(v.string()), deployNote: v.optional(v.string()), broadcastPostId: v.optional(v.id("broadcastPosts")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.projectId, args.sessionToken);
    const release = await releaseOf(ctx, args.projectId, args.releaseId);
    if (release.status !== "publishing") throw new Error(`${release.tag} is not being published`);
    if (args.broadcastPostId) {
      const post = await ctx.db.get(args.broadcastPostId);
      if (!post || post.projectId !== args.projectId) throw new Error("Post not found");
    }
    const now = Date.now();
    const published = Boolean(args.releaseUrl);
    await ctx.db.patch(release._id, {
      status: published ? "published" : "failed", updatedAt: now,
      ...(published ? { releaseUrl: args.releaseUrl!.slice(0, SHIP_LIMITS.url), publishedAt: now } : {}),
      ...(args.error ? { error: args.error.slice(0, 500) } : {}),
      ...(args.deployNote ? { deployNote: args.deployNote.slice(0, 500) } : {}),
      ...(args.broadcastPostId ? { broadcastPostId: args.broadcastPostId } : {}),
    });
    return null;
  },
});
