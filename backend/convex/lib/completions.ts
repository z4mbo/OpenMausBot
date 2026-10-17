import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function recordCompletion(ctx: MutationCtx, task: Doc<"tasks">, done: boolean, completedAt = Date.now()) {
  if (!done || task.done || task.completedAt) return;
  const project = await ctx.db.get(task.projectId);
  await ctx.db.patch(task._id, { completedAt });
  if (!project?.teamId) return;
  const existing = await ctx.db.query("taskCompletions").withIndex("by_taskId", q => q.eq("taskId", task._id)).unique();
  if (!existing) await ctx.db.insert("taskCompletions", {
    teamId: project.teamId, projectId: project._id, taskId: task._id,
    assignedToEmail: task.assignedToEmail, completedAt,
  });
}
