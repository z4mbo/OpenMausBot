import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { taskBranch } from "../../lib/task-branch";
import { hashToken } from "./auth";

export async function reserveTaskBranch(ctx: MutationCtx, task: Doc<"tasks">, requested?: string) {
  if (task.githubTaskBranch) { if (requested && requested !== task.githubTaskBranch) throw new Error("Task branch already reserved"); return task.githubTaskBranch; }
  const linked = await ctx.db.query("taskPullRequests").withIndex("by_taskId", q => q.eq("taskId", task._id)).first();
  if (requested && linked && requested !== linked.branch) throw new Error("Task already has a PR on another branch");
  let branch = requested ?? linked?.branch ?? taskBranch(task);
  const collision = await ctx.db.query("tasks").withIndex("by_githubTaskBranch", q => q.eq("githubTaskBranch", branch)).first();
  if (collision && collision._id !== task._id) {
    if (requested) throw new Error("Task branch already reserved");
    branch = `${branch}-${(await hashToken(task._id)).slice(0, 12)}`;
    const second = await ctx.db.query("tasks").withIndex("by_githubTaskBranch", q => q.eq("githubTaskBranch", branch)).first();
    if (second && second._id !== task._id) throw new Error("Task branch collision; choose a different task title");
  }
  await ctx.db.patch(task._id, { githubTaskBranch: branch });
  return branch;
}
