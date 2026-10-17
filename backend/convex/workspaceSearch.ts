import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMember, requireTeamMember, visibleProjectRows } from "./lib/permissions";
import { workspaceProject } from "./lib/features";

export const issues = query({
  args: { sessionToken: v.string(), teamId: v.id("teams"), text: v.string(), projectId: v.optional(v.id("projects")), done: v.optional(v.boolean()) },
  returns: v.array(v.object({ _id: v.id("tasks"), projectId: v.id("projects"), title: v.string(), done: v.boolean(), milestoneId: v.optional(v.id("milestones")) })),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    if (args.projectId) await workspaceProject(ctx, args.teamId, args.projectId);
    if (args.projectId) await requireMember(ctx, args.projectId, args.sessionToken);
    const text = args.text.trim().slice(0, 160);
    const rows = text ? await ctx.db.query("tasks").withSearchIndex("search_title", q => {
      const search = q.search("title", text).eq("teamId", args.teamId);
      return args.projectId ? args.done === undefined ? search.eq("projectId", args.projectId) : search.eq("projectId", args.projectId).eq("done", args.done) : args.done === undefined ? search : search.eq("done", args.done);
    }).take(50) : args.projectId
      ? args.done === undefined ? await ctx.db.query("tasks").withIndex("by_project", q => q.eq("projectId", args.projectId!)).order("desc").take(50) : await ctx.db.query("tasks").withIndex("by_project_and_done", q => q.eq("projectId", args.projectId!).eq("done", args.done!)).order("desc").take(50)
      : await ctx.db.query("tasks").withIndex("by_teamId_and_done", q => q.eq("teamId", args.teamId).eq("done", args.done ?? false)).order("desc").take(50);
    return (await visibleProjectRows(ctx, rows, user)).map(({ _id, projectId, title, done, milestoneId }) => ({ _id, projectId, title, done, milestoneId }));
  },
});

export const documents = query({
  args: { sessionToken: v.string(), teamId: v.id("teams"), text: v.string() },
  returns: v.array(v.object({ _id: v.id("wikiPages"), title: v.string(), projectId: v.id("projects") })),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const text = args.text.trim().slice(0, 160);
    const [recent, content] = await Promise.all([
      text ? ctx.db.query("wikiPages").withSearchIndex("search_title", q => q.search("title", text).eq("teamId", args.teamId)).take(20) : ctx.db.query("wikiPages").withIndex("by_teamId_and_updatedAt", q => q.eq("teamId", args.teamId)).order("desc").take(20),
      text ? ctx.db.query("wikiPages").withSearchIndex("search_content", q => q.search("content", text).eq("teamId", args.teamId)).take(20) : [],
    ]);
    const matches = [...new Map([...recent, ...content].map(row => [row._id, row])).values()];
    return (await visibleProjectRows(ctx, matches, user)).slice(0, 20).map(({ _id, title, projectId }) => ({ _id, title, projectId }));
  },
});
