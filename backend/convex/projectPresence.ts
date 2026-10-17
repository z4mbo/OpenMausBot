import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { projectMember, requireTeamMember } from "./lib/permissions";

export const update = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), clientId: v.string(), sequence: v.number(), projectId: v.union(v.id("projects"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    if (!args.clientId || args.clientId.length > 80 || !Number.isSafeInteger(args.sequence) || args.sequence < 0) throw new Error("Invalid presence session");
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.teamId !== args.teamId || !await projectMember(ctx, project, user)) throw new Error("Project is not in this workspace");
    }
    const existing = await ctx.db.query("projectPresence").withIndex("by_team_user_client", q => q.eq("teamId", args.teamId).eq("userId", user._id).eq("clientId", args.clientId)).unique();
    if (existing && existing.sequence >= args.sequence) return null;
    const data = { projectId: args.projectId ?? undefined, sequence: args.sequence, updatedAt: Date.now() };
    // Keep a short-lived tombstone so an in-flight heartbeat cannot undo a leave.
    if (existing) await ctx.db.patch(existing._id, data);
    else await ctx.db.insert("projectPresence", { teamId: args.teamId, userId: user._id, clientId: args.clientId, ...data });
    return null;
  },
});

export const list = query({
  args: { sessionToken: v.string(), teamId: v.id("teams"), activeSince: v.number() },
  returns: v.array(v.object({ userId: v.id("users"), projectId: v.id("projects"), name: v.string(), email: v.string(), username: v.optional(v.string()), avatarUrl: v.union(v.string(), v.null()), updatedAt: v.number() })),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    if (!Number.isFinite(args.activeSince)) throw new Error("Invalid presence window");
    const rows = await ctx.db.query("projectPresence").withIndex("by_team_updatedAt", q => q.eq("teamId", args.teamId).gt("updatedAt", args.activeSince)).order("desc").take(500);
    const seen = new Set<string>();
    const result = [];
    for (const row of rows) {
      if (!row.projectId || row.userId === user._id || seen.has(row.userId)) continue;
      const member = await ctx.db.get(row.userId);
      const project = await ctx.db.get(row.projectId);
      if (!member || member.status !== "active" || project?.teamId !== args.teamId || !await projectMember(ctx, project, user) || !await projectMember(ctx, project, member)) continue;
      seen.add(row.userId);
      result.push({ userId: member._id, projectId: row.projectId, name: member.name, username: member.username, email: member.email, avatarUrl: member.avatarStorageId ? await ctx.storage.getUrl(member.avatarStorageId) : null, updatedAt: row.updatedAt });
    }
    return result;
  },
});

export const cleanup = internalMutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const rows = await ctx.db.query("projectPresence").withIndex("by_updatedAt", q => q.lt("updatedAt", Date.now() - 300_000)).take(500);
    for (const row of rows) await ctx.db.delete(row._id);
    return null;
  },
});
