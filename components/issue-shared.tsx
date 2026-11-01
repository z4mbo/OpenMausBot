import type { HTMLAttributes, SyntheticEvent } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ContentSkeleton } from "./content-skeleton";
import { Dialog } from "./dialog";
import { taskKey } from "@/lib/project-issues";

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

const STOP_CANCEL = { onCancel: (event: SyntheticEvent) => event.stopPropagation() } as HTMLAttributes<HTMLDivElement>;

/**
 * The one way to delete an issue (the board's card menu and the issue view's ⋯ menu): a confirm dialog naming the
 * issue, with Cancel and Delete. `onCancel` also runs for Escape and the close button.
 */
export function IssueDeleteDialog({ taskId, title, disabled, onCancel, onConfirm }: { taskId: string; title: string; disabled?: boolean; onCancel: () => void; onConfirm: () => void }) {
  // React passes a portaled dialog's cancel (Escape) on to the dialogs around it in the component tree; opened from the
  // issue view, Escape must close only this one. The hidden wrapper renders nothing; the dialog lives in a portal.
  return <div hidden {...STOP_CANCEL}><Dialog title="Delete issue" className="confirm-dialog" onClose={onCancel}>
    <div className="dialog-body">
      <p className="confirm-text"><span className="issue-key">{taskKey(taskId)}</span> {title}</p>
      <div className="dialog-actions">
        <button type="button" className="ghost-button compact" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button danger compact" autoFocus disabled={disabled} onClick={onConfirm}>Delete</button>
      </div>
    </div>
  </Dialog></div>;
}
