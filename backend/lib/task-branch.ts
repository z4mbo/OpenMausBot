export function taskBranch(task: { _id: string; title: string; githubTaskBranch?: string }) {
  return task.githubTaskBranch ?? `origin/ORI-${task._id.slice(-4).toUpperCase()}-${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "") || "task"}`;
}
