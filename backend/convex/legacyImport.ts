import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_OWNER_EMAIL } from "./lib/auth";
import { priorityValidator, projectIconTypeValidator, projectStatusValidator } from "./lib/validators";
import { createWorkspace } from "./workspaces";

// Admin-only, additive recovery. Source keys make retries safe without matching issue titles.
export const prepareWorkspace = internalMutation({
  args: {},
  returns: v.id("teams"),
  handler: async ctx => {
    const owner = await ctx.db.query("users").withIndex("by_email", q => q.eq("email", DEFAULT_OWNER_EMAIL)).unique();
    if (!owner) throw new Error("The destination owner account must already exist");
    const slug = process.env.ORIGIN_LEGACY_WORKSPACE_SLUG;
    if (!slug) throw new Error("Configure the destination workspace before importing");
    let team = await ctx.db.query("teams").withIndex("by_slug", q => q.eq("slug", slug)).unique();
    if (team && team.ownerUserId !== owner._id) throw new Error("Workspace belongs to a different account");
    if (!team) {
      team = await ctx.db.get((await createWorkspace(ctx, owner, slug, slug)).teamId);
    }
    if (!team) throw new Error("Workspace not found");
    const members = await ctx.db.query("teamMembers").withIndex("by_team", q => q.eq("teamId", team!._id)).take(201);
    if (members.length !== 1 || members[0].email !== owner.email || members[0].role !== "owner" || members[0].status !== "active") {
      throw new Error("Review workspace membership before importing private projects");
    }
    return team._id;
  },
});

export const importProject = internalMutation({
  args: {
    teamId: v.id("teams"),
    source: v.string(),
    order: v.number(),
    project: v.object({
      sourceId: v.string(), name: v.string(), description: v.optional(v.string()), repoUrl: v.optional(v.string()),
      status: projectStatusValidator, accent: v.string(), iconType: v.optional(projectIconTypeValidator), iconValue: v.optional(v.string()),
      createdAt: v.number(), updatedAt: v.number(),
    }),
    columns: v.array(v.object({ sourceId: v.string(), title: v.string(), order: v.number(), isDone: v.optional(v.boolean()) })),
    tasks: v.array(v.object({
      sourceId: v.string(), columnSourceId: v.string(), title: v.string(), description: v.optional(v.string()),
      priority: priorityValidator, assignedToEmail: v.optional(v.string()), assignedToName: v.optional(v.string()),
      done: v.boolean(), dueDate: v.optional(v.string()), order: v.number(), createdAt: v.number(), updatedAt: v.number(),
    })),
  },
  returns: v.object({ projectId: v.id("projects"), created: v.boolean(), imported: v.number(), skipped: v.number(), total: v.number() }),
  handler: async (ctx, args) => {
    const owner = await ctx.db.query("users").withIndex("by_email", q => q.eq("email", DEFAULT_OWNER_EMAIL)).unique();
    const team = await ctx.db.get(args.teamId);
    if (!owner || !team || team.ownerUserId !== owner._id || team.slug !== process.env.ORIGIN_LEGACY_WORKSPACE_SLUG) throw new Error("Invalid recovery workspace");
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(args.source)) throw new Error("Invalid source identifier");
    if (args.tasks.length > 500 || args.columns.length > 50) throw new Error("Split this import into smaller batches");
    const sourceKey = `${args.source}:${args.project.sourceId}`;
    const existingImport = await ctx.db.query("projects").withIndex("by_legacySourceKey", q => q.eq("legacySourceKey", sourceKey)).unique();
    const owned = await ctx.db.query("projects").withIndex("by_owner", q => q.eq("ownerEmail", owner.email)).take(501);
    if (owned.length > 500) throw new Error("Review large workspace before importing");
    const existing = existingImport ?? owned.find(p => p.name.toLowerCase() === args.project.name.toLowerCase() && (p.repoUrl || "") === (args.project.repoUrl || ""));
    if (existing && (existing.ownerEmail !== owner.email || (existing.teamId && existing.teamId !== team._id))) throw new Error("Matching project belongs to another workspace");
    if (existing?.legacySourceKey && existing.legacySourceKey !== sourceKey) throw new Error("Conflicting project source");
    const { sourceId: _sourceId, ...sourceProject } = args.project;
    const projectId = existing?._id ?? await ctx.db.insert("projects", {
      ...sourceProject, iconType: sourceProject.iconType === "image" ? "default" : sourceProject.iconType,
      ownerEmail: owner.email, teamId: team._id, order: args.order, legacySourceKey: sourceKey,
    });
    if (existing && !existingImport) {
      await ctx.db.patch(projectId, {
        teamId: team._id, legacySourceKey: sourceKey, order: args.order,
        ...(!existing.description && sourceProject.description ? { description: sourceProject.description } : {}),
      });
    }
    const membership = await ctx.db.query("members").withIndex("by_project_email", q => q.eq("projectId", projectId).eq("email", owner.email)).unique();
    if (!membership) await ctx.db.insert("members", { projectId, userId: owner._id, email: owner.email, name: owner.name, role: "owner", status: "active", createdAt: Date.now(), updatedAt: Date.now(), joinedAt: Date.now() });
    const columns = await ctx.db.query("columns").withIndex("by_project", q => q.eq("projectId", projectId)).take(100);
    const columnIds = new Map<string, Id<"columns">>();
    const isCompletedColumn = (column: { title: string; isDone?: boolean }) => column.isDone || /^(done|completed|archive|archived)$/i.test(column.title.trim());
    for (const column of args.columns.filter(c => !isCompletedColumn(c))) {
      const match = columns.find(c => c.title.trim().toLowerCase() === column.title.trim().toLowerCase() && !isCompletedColumn(c));
      const id = match?._id ?? await ctx.db.insert("columns", { projectId, title: column.title, order: column.order, isDone: false, createdAt: Date.now(), updatedAt: Date.now() });
      columnIds.set(column.sourceId, id);
    }
    let fallback = columnIds.get(args.columns.find(c => c.title.toLowerCase() === "todo")?.sourceId ?? "") ?? columnIds.values().next().value;
    if (!fallback) fallback = await ctx.db.insert("columns", { projectId, title: "Todo", order: 0, isDone: false, createdAt: Date.now(), updatedAt: Date.now() });
    // Legacy Done issues remain completed, associated with Todo for the new archive UI.
    for (const column of args.columns.filter(isCompletedColumn)) columnIds.set(column.sourceId, fallback);
    let imported = 0;
    let skipped = 0;
    for (const task of args.tasks) {
      const key = `${args.source}:${task.sourceId}`;
      const previous = await ctx.db.query("tasks").withIndex("by_legacySourceKey", q => q.eq("legacySourceKey", key)).unique();
      if (previous) {
        if (previous.projectId !== projectId) throw new Error("Conflicting issue source");
        skipped++;
        continue;
      }
      const columnId = columnIds.get(task.columnSourceId);
      if (!columnId) throw new Error("Issue references a missing source column");
      const { sourceId: _taskSourceId, columnSourceId: _columnSourceId, ...fields } = task;
      await ctx.db.insert("tasks", { ...fields, teamId: team._id, projectId, columnId, legacySourceKey: key });
      imported++;
    }
    const allTasks = await ctx.db.query("tasks").withIndex("by_project", q => q.eq("projectId", projectId)).take(2001);
    if (allTasks.length > 2000) throw new Error("Review large board before importing");
    await ctx.db.patch(projectId, { openIssueCount: allTasks.filter(t => !t.done).length });
    return { projectId, created: !existing, imported, skipped, total: allTasks.length };
  },
});
