import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ContentSkeleton } from "./content-skeleton";

/** Types and pieces shared by the board (project-issues.tsx) and the issue view (issue-detail.tsx). */
export type ProjectWithUi = Doc<"projects"> & { memberRole: string; iconUrl?: string | null };
export type OpenReference = (projectId: Id<"projects">, taskId?: Id<"tasks">) => void;

export function fmtDate(timestamp?: number) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return <ContentSkeleton label={label} kind={label.includes("board") || label.includes("project") ? "board" : "list"} rows={4} />;
}

/**
 * The issue a composer just created, for the board to focus its card once it shows. The composer may switch projects
 * first, so a board that mounts right after the create still gets it.
 */
let createdIssue: { taskId: string; at: number } | null = null;
const createdListeners = new Set<(taskId: string) => void>();
export function announceCreatedIssue(taskId: string) {
  createdIssue = { taskId, at: Date.now() };
  createdListeners.forEach(listener => listener(taskId));
}
export function subscribeCreatedIssue(listener: (taskId: string) => void) {
  if (createdIssue && Date.now() - createdIssue.at < 3000) listener(createdIssue.taskId);
  createdListeners.add(listener);
  return () => { createdListeners.delete(listener); };
}
