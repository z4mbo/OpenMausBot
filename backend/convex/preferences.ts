import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireTeamMember } from "./lib/permissions";
import { workspaceProject } from "./lib/features";

const scope = { sessionToken: v.string(), teamId: v.id("teams") };
const fields = { assignments: v.boolean(), comments: v.boolean(), mentions: v.boolean(), mutedProjects: v.array(v.id("projects")), quietStart: v.string(), quietEnd: v.string(), timeZone: v.string() };
export const notifications = query({
  args: scope, returns: v.object(fields),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const row = await ctx.db.query("notificationPreferences").withIndex("by_teamId_and_userId", q => q.eq("teamId", args.teamId).eq("userId", user._id)).unique();
    return row ? { assignments: row.assignments, comments: row.comments, mentions: row.mentions, mutedProjects: row.mutedProjects, quietStart: row.quietStart, quietEnd: row.quietEnd, timeZone: row.timeZone } : { assignments: true, comments: true, mentions: true, mutedProjects: [], quietStart: "", quietEnd: "", timeZone: "UTC" };
  },
});
export const saveNotifications = mutation({
  args: { ...scope, ...fields }, returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    if ((args.quietStart || args.quietEnd) && (!time.test(args.quietStart) || !time.test(args.quietEnd))) throw new Error("Choose both quiet-hour times");
    try { new Intl.DateTimeFormat("en", { timeZone: args.timeZone }).format(0); } catch { throw new Error("Choose a valid time zone"); }
    if (args.mutedProjects.length > 200) throw new Error("Select up to 200 projects");
    for (const projectId of new Set(args.mutedProjects)) await workspaceProject(ctx, args.teamId, projectId);
    const existing = await ctx.db.query("notificationPreferences").withIndex("by_teamId_and_userId", q => q.eq("teamId", args.teamId).eq("userId", user._id)).unique();
    const { sessionToken: _token, ...values } = args;
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("notificationPreferences", { ...values, userId: user._id });
    return null;
  },
});
