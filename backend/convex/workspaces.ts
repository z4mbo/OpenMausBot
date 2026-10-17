import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";
import { DEFAULT_OWNER_EMAIL, requireUser } from "./lib/auth";
import { changeOpenIssueCount, requireTeamAdmin, requireTeamMember } from "./lib/permissions";

const inviteRole = v.union(v.literal("admin"), v.literal("member"), v.literal("viewer"));
const reservedSlugs = new Set(["api", "login", "signup", "join", "settings", "new", "_next", "favicon.ico", "feedback", "privacy", "terms", "oauth", "docs"]);

export async function createWorkspace(ctx: MutationCtx, user: { _id: Id<"users">; email: string; name: string }, name: string, requestedSlug?: string) {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 60) throw new Error("Workspace name must be between 1 and 60 characters");
  const base = (requestedSlug || cleanName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  if (base.length < 2 || reservedSlugs.has(base)) throw new Error("Choose a different workspace URL (at least 2 characters)");
  let slug = base;
  if (await ctx.db.query("teams").withIndex("by_slug", q => q.eq("slug", slug)).unique()) {
    if (requestedSlug) throw new Error("That workspace URL is already taken");
    slug = `${base}-${crypto.randomUUID().slice(0, 6)}`;
  }
  const now = Date.now();
  const teamId = await ctx.db.insert("teams", { name: cleanName, slug, ownerUserId: user._id, createdAt: now, updatedAt: now });
  await ctx.db.insert("teamMembers", { teamId, userId: user._id, email: user.email, name: user.name, role: "owner", status: "active", createdAt: now, updatedAt: now, joinedAt: now });
  return { teamId, slug };
}

export const list = query({
  args: { sessionToken: v.string() },
  returns: v.array(v.object({ _id: v.id("teams"), name: v.string(), slug: v.string(), role: v.string() })),
  handler: async (ctx, { sessionToken }) => {
    const user = await requireUser(ctx, sessionToken);
    const memberships = await ctx.db.query("teamMembers").withIndex("by_email", q => q.eq("email", user.email)).take(100);
    const teams = await Promise.all(memberships.filter(m => m.status === "active").map(async member => {
      const team = await ctx.db.get(member.teamId);
      return team ? { _id: team._id, name: team.name, slug: team.slug || team._id, role: member.role } : null;
    }));
    return teams.filter((team): team is NonNullable<typeof team> => team !== null);
  },
});

export const create = mutation({
  args: { sessionToken: v.string(), name: v.string(), slug: v.optional(v.string()) },
  returns: v.object({ teamId: v.id("teams"), slug: v.string() }),
  handler: async (ctx, args) => createWorkspace(ctx, await requireUser(ctx, args.sessionToken), args.name, args.slug),
});

export const ensureLegacyWorkspace = mutation({
  args: { sessionToken: v.string() },
  returns: v.union(v.id("teams"), v.null()),
  handler: async (ctx, { sessionToken }) => {
    const user = await requireUser(ctx, sessionToken);
    if (user.email !== DEFAULT_OWNER_EMAIL) return null;
    const owned = await ctx.db.query("projects").withIndex("by_owner", q => q.eq("ownerEmail", user.email)).take(500);
    const slug = process.env.ORIGIN_LEGACY_WORKSPACE_SLUG;
    if (!slug) return null;
    const team = await ctx.db.query("teams").withIndex("by_slug", q => q.eq("slug", slug)).unique();
    if (!team || team.ownerUserId !== user._id) return null;
    for (const project of owned) {
      if (!project.teamId) await ctx.db.patch(project._id, { teamId: team._id, order: project._creationTime });
      if (project.openIssueCount === undefined) await changeOpenIssueCount(ctx, project._id, 0);
    }
    return team._id;
  },
});

export const access = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  returns: v.object({ teamId: v.id("teams"), slug: v.string(), role: v.string() }),
  handler: async (ctx, args) => {
    const { member } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Workspace not found");
    return { teamId: team._id, slug: team.slug || team._id, role: member.role };
  },
});

export const members = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  returns: v.array(v.object({ _id: v.id("teamMembers"), userId: v.optional(v.id("users")), name: v.string(), username: v.optional(v.string()), email: v.string(), role: v.string(), avatarUrl: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const members = await ctx.db.query("teamMembers").withIndex("by_team", q => q.eq("teamId", args.teamId)).take(200);
    return Promise.all(members.filter(m => m.status === "active").map(async m => {
      const user = m.userId ? await ctx.db.get(m.userId) : null;
      return { _id: m._id, userId: m.userId, name: user?.name || m.name, username: user?.username, email: m.email, role: m.role, avatarUrl: user?.avatarStorageId ? await ctx.storage.getUrl(user.avatarStorageId) : null };
    }));
  },
});

export const update = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), name: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireTeamAdmin(ctx, args.teamId, args.sessionToken);
    if (!args.name.trim() || args.name.length > 60) throw new Error("Enter a name under 60 characters");
    await ctx.db.patch(args.teamId, { name: args.name.trim(), updatedAt: Date.now() });
    return null;
  },
});

export const createInvite = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), projectId: v.optional(v.id("projects")), email: v.optional(v.string()), role: inviteRole },
  returns: v.object({ token: v.string(), expiresAt: v.number(), teamName: v.string() }),
  handler: async (ctx, args) => {
    const { user } = await requireTeamAdmin(ctx, args.teamId, args.sessionToken);
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Workspace not found");
    if (args.projectId) {
      if ((await ctx.db.get(args.projectId))?.teamId !== team._id) throw new Error("Project not found");
      if (args.role === "admin") throw new Error("Project links cannot grant workspace admin access");
    }
    const email = args.email?.trim().toLowerCase() || undefined;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const expiresAt = Date.now() + 7 * 86400000;
    await ctx.db.insert("workspaceInvites", { teamId: args.teamId, projectId: args.projectId, token, email, role: args.role, createdBy: user._id, expiresAt, revoked: false, createdAt: Date.now() });
    return { token, expiresAt, teamName: team.name };
  },
});

export const invitePreview = query({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ name: v.string(), role: v.string(), email: v.optional(v.string()) })),
  handler: async (ctx, { token }) => {
    const invite = await ctx.db.query("workspaceInvites").withIndex("by_token", q => q.eq("token", token)).unique();
    if (!invite || invite.revoked || invite.expiresAt < Date.now()) return null;
    const team = await ctx.db.get(invite.teamId);
    const project = invite.projectId ? await ctx.db.get(invite.projectId) : null;
    if (invite.projectId && project?.teamId !== team?._id) return null;
    return team ? { name: project ? `${team.name} / ${project.name}` : team.name, role: invite.role, email: invite.email } : null;
  },
});

export const acceptInvite = mutation({
  args: { sessionToken: v.string(), token: v.string() },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const invite = await ctx.db.query("workspaceInvites").withIndex("by_token", q => q.eq("token", args.token)).unique();
    if (!invite || invite.revoked || invite.expiresAt < Date.now()) throw new Error("This invitation has expired or was revoked");
    if (invite.email && invite.email !== user.email) throw new Error(`Sign in with ${invite.email} to accept this invitation`);
    const team = await ctx.db.get(invite.teamId);
    if (!team) throw new Error("Workspace no longer exists");
    const project = invite.projectId ? await ctx.db.get(invite.projectId) : null;
    if (invite.projectId && (!project || project.teamId !== team._id)) throw new Error("Project no longer exists");
    const member = await ctx.db.query("teamMembers").withIndex("by_team_email", q => q.eq("teamId", team._id).eq("email", user.email)).unique();
    const now = Date.now();
    if (!member) await ctx.db.insert("teamMembers", { teamId: team._id, userId: user._id, email: user.email, name: user.name, role: invite.role, status: "active", createdAt: now, updatedAt: now, joinedAt: now });
    else if (member.status !== "active") await ctx.db.patch(member._id, { userId: user._id, status: "active", role: invite.role, updatedAt: now, joinedAt: now });
    if (project) {
      const existing = await ctx.db.query("members").withIndex("by_project_email", q => q.eq("projectId", project._id).eq("email", user.email)).unique();
      const role = invite.role === "viewer" ? "viewer" as const : "member" as const;
      if (!existing) await ctx.db.insert("members", { projectId: project._id, userId: user._id, email: user.email, name: user.name, role, status: "active", createdAt: now, updatedAt: now, joinedAt: now });
      else if (existing.status !== "active") await ctx.db.patch(existing._id, { userId: user._id, role, status: "active", inviteToken: undefined, updatedAt: now, joinedAt: now });
    }
    if (invite.email) await ctx.db.patch(invite._id, { revoked: true });
    return { slug: team.slug || team._id };
  },
});

export const invitations = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") }, returns: v.any(),
  handler: async (ctx, args) => {
    await requireTeamAdmin(ctx, args.teamId, args.sessionToken);
    return (await ctx.db.query("workspaceInvites").withIndex("by_teamId", q => q.eq("teamId", args.teamId)).order("desc").take(100)).filter(i => !i.revoked && i.expiresAt > Date.now());
  },
});

export const revokeInvite = mutation({
  args: { sessionToken: v.string(), inviteId: v.id("workspaceInvites") }, returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new Error("Invitation not found");
    await requireTeamAdmin(ctx, invite.teamId, args.sessionToken);
    await ctx.db.patch(invite._id, { revoked: true });
    return null;
  },
});

export const sendEmailInvite = action({
  args: { sessionToken: v.string(), teamId: v.id("teams"), email: v.string(), role: inviteRole },
  returns: v.object({ inviteLink: v.string(), sent: v.boolean() }),
  handler: async (ctx, args): Promise<{ inviteLink: string; sent: boolean }> => {
    const invitation = await ctx.runMutation(api.workspaces.createInvite, args);
    const inviteLink = `${process.env.ORIGIN_SITE_URL || process.env.ORIGIN_PUBLIC_URL || "http://localhost:3000"}/join/${invitation.token}`;
    if (!process.env.RESEND_API_KEY) return { inviteLink, sent: false };
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.INVITE_FROM_EMAIL || "Origin <onboarding@resend.dev>", to: args.email, subject: `Join ${invitation.teamName} on Origin`, text: `You've been invited to ${invitation.teamName}. Join your workspace: ${inviteLink}\nThis invitation expires in 7 days.` }) });
    return { inviteLink, sent: response.ok };
  },
});
