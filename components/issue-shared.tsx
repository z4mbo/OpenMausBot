import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ContentSkeleton } from "./content-skeleton";

/** Types and pieces shared by the board (project-issues.tsx) and the issue view (issue-detail.tsx). */
export type ProjectWithUi = Doc<"projects"> & { memberRole: string; iconUrl?: string | null };
export type OpenReference = (projectId: Id<"projects">, taskId?: Id<"tasks">) => void;

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return <ContentSkeleton label={label} kind={label.includes("board") || label.includes("project") ? "board" : "list"} rows={4} />;
}
