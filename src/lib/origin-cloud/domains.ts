import { cloudMutation, cloudQueryOnce } from "./client";
import type { CloudProject, CloudWorkspace } from "./types";

type Args = Record<string, unknown>;
type FeedbackPortal = { _id: string; projectId: string };

async function feedbackForProject(projectId: string): Promise<unknown> {
  const project = await cloudQueryOnce<{ teamId?: string }>("projects:get", { projectId });
  if (!project.teamId) return [];
  const portals = await cloudQueryOnce<FeedbackPortal[]>("feedback:portals", { teamId: project.teamId });
  const portal = portals.find((row) => row.projectId === projectId);
  if (!portal) return [];
  return cloudQueryOnce("feedback:list", { teamId: project.teamId, portalId: portal._id });
}

export const cloud = {
  workspaces: {
    list: () => cloudQueryOnce<CloudWorkspace[]>("workspaces:list"),
  },
  projects: {
    listForUser: (teamId?: string) => cloudQueryOnce<CloudProject[]>("projects:listForUser", teamId ? { teamId } : {}),
  },
  issues: {
    board: (projectId: string) => cloudQueryOnce("tasks:board", { projectId }),
    create: (args: Args) => cloudMutation("tasks:createTask", args),
    update: (args: Args) => cloudMutation("tasks:updateTask", args),
    move: (args: Args) => cloudMutation("tasks:moveTask", args),
    remove: (taskId: string, projectId: string) => cloudMutation("tasks:deleteTask", { projectId, taskId }),
    comment: (args: Args) => cloudMutation("tasks:addComment", args),
  },
  assets: {
    list: (projectId: string) => cloudQueryOnce("design:list", { projectId }),
  },
  vault: {
    list: (projectId: string) => cloudQueryOnce("credentials:list", { projectId }),
  },
  feedback: {
    list: feedbackForProject,
  },
  repo: {
    pullRequests: (projectId: string) => cloudQueryOnce("github:listPullRequests", { projectId }),
    commits: (projectId: string) => cloudQueryOnce("commits:list", { projectId }),
  },
};
