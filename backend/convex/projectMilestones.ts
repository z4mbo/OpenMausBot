import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, requireMember, touchProject } from "./lib/permissions";
import { cleanText, validDay } from "./lib/features";
import { MILESTONE_LIMITS, compareMilestones } from "../../shared/origin-milestones";

const status = v.union(v.literal("planned"), v.literal("active"), v.literal("completed"));
const summary = v.object({ _id: v.id("milestones"), title: v.string(), description: v.string(), targetDate: v.string(), status, done: v.number(), total: v.number() });

async function projectMilestones(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">): Promise<Doc<"milestones">[]> {
  return (await ctx.db.query("milestones").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(MILESTONE_LIMITS.perProject + 1))
    .sort((a, b) => compareMilestones({ targetDate: a.targetDate, createdAt: a.createdAt }, { targetDate: b.targetDate, createdAt: b.createdAt }));
}

async function requireEditor(ctx: MutationCtx, projectId: Id<"projects">, sessionToken: string) {
  const access = await requireMember(ctx, projectId, sessionToken);
  if (!canEdit(access.member)) throw new Error("Edit role required");
  if (!access.project.teamId) throw new Error("Milestones need a project in a workspace");
  return { ...access, teamId: access.project.teamId };
}

async function projectMilestone(ctx: MutationCtx, projectId: Id<"projects">, milestoneId: Id<"milestones">) {
  const milestone = await ctx.db.get(milestoneId);
  if (!milestone || milestone.projectId !== projectId) throw new Error("Milestone not found");
  return milestone;
}

const targetDayOf = (value: string | undefined) => (value?.trim() ? validDay(value.trim()) : "");

export const list = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  returns: v.object({ canEdit: v.boolean(), milestones: v.array(summary) }),
  handler: async (ctx, args) => {
    const { member } = await requireMember(ctx, args.projectId, args.sessionToken);
    const milestones = await Promise.all((await projectMilestones(ctx, args.projectId)).map(async (row) => {
      const tasks = await ctx.db.query("tasks").withIndex("by_milestoneId", (q) => q.eq("milestoneId", row._id)).take(MILESTONE_LIMITS.issues);
      const own = tasks.filter((task) => task.projectId === args.projectId);
      return { _id: row._id, title: row.title, description: row.description, targetDate: row.targetDate, status: row.status, done: own.filter((task) => task.done).length, total: own.length };
    }));
    return { canEdit: canEdit(member), milestones };
  },
});

export const save = mutation({
  args: {
    sessionToken: v.string(), projectId: v.id("projects"), milestoneId: v.optional(v.id("milestones")),
    title: v.optional(v.string()), description: v.optional(v.string()), targetDate: v.optional(v.string()), status: v.optional(status),
  },
  returns: v.id("milestones"),
  handler: async (ctx, args) => {
    const { teamId } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const fields = {
      ...(args.title !== undefined ? { title: cleanText(args.title, MILESTONE_LIMITS.title, "Milestone name") } : {}),
      ...(args.description !== undefined ? { description: args.description.trim().slice(0, MILESTONE_LIMITS.description) } : {}),
      ...(args.targetDate !== undefined ? { targetDate: targetDayOf(args.targetDate) } : {}),
      ...(args.status ? { status: args.status } : {}),
      updatedAt: Date.now(),
    };
    if (args.milestoneId) {
      const milestone = await projectMilestone(ctx, args.projectId, args.milestoneId);
      await ctx.db.patch(milestone._id, fields);
      return milestone._id;
    }
    if (args.title === undefined) throw new Error("A new milestone needs a name");
    if ((await projectMilestones(ctx, args.projectId)).length >= MILESTONE_LIMITS.perProject) throw new Error(`A project has up to ${MILESTONE_LIMITS.perProject} milestones`);
    const id = await ctx.db.insert("milestones", { teamId, projectId: args.projectId, title: "", description: "", targetDate: "", status: "planned", ...fields, createdAt: Date.now() });
    await touchProject(ctx, args.projectId);
    return id;
  },
});

/** Puts issues of this project in a milestone, or takes them out of theirs with `milestoneId` null. */
export const assign = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), milestoneId: v.union(v.id("milestones"), v.null()), taskIds: v.array(v.id("tasks")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const taskIds = [...new Set(args.taskIds)];
    if (taskIds.length > MILESTONE_LIMITS.assignAtOnce) throw new Error(`Assign up to ${MILESTONE_LIMITS.assignAtOnce} issues at once`);
    const milestone = args.milestoneId ? await projectMilestone(ctx, args.projectId, args.milestoneId) : null;
    const tasks = await Promise.all(taskIds.map((id) => ctx.db.get(id)));
    if (tasks.some((task) => !task || task.projectId !== args.projectId)) throw new Error("Issues must belong to this project");
    if (milestone) {
      const held = await ctx.db.query("tasks").withIndex("by_milestoneId", (q) => q.eq("milestoneId", milestone._id)).take(MILESTONE_LIMITS.issues);
      const joining = tasks.filter((task) => task!.milestoneId !== milestone._id).length;
      if (held.length + joining > MILESTONE_LIMITS.issues) throw new Error(`A milestone holds up to ${MILESTONE_LIMITS.issues} issues; split it`);
    }
    const now = Date.now();
    for (const task of tasks) await ctx.db.patch(task!._id, { milestoneId: milestone?._id, updatedAt: now });
    return null;
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), milestoneId: v.id("milestones") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const milestone = await projectMilestone(ctx, args.projectId, args.milestoneId);
    const tasks = await ctx.db.query("tasks").withIndex("by_milestoneId", (q) => q.eq("milestoneId", milestone._id)).take(MILESTONE_LIMITS.issues + 1);
    for (const task of tasks) await ctx.db.patch(task._id, { milestoneId: undefined });
    await ctx.db.delete(milestone._id);
    await touchProject(ctx, args.projectId);
    return null;
  },
});
