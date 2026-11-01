"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ContentSkeleton } from "./content-skeleton";
import { Dialog } from "./dialog";
import { taskKey } from "@/lib/project-issues";

/** Types and pieces shared by the board (project-issues.tsx) and the issue view (issue-detail.tsx). */
export type ProjectWithUi = Doc<"projects"> & { memberRole: string; iconUrl?: string | null };
export type OpenReference = (projectId: Id<"projects">, taskId?: Id<"tasks">) => void;

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

/**
 * The one way to delete an issue (the board's card menu and the issue view's ⋯ menu): a confirm dialog naming the
 * issue, with Cancel and Delete. `onCancel` also runs for Escape and the close button.
 */
export function IssueDeleteDialog({ taskId, title, disabled, onCancel, onConfirm }: { taskId: string; title: string; disabled?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog title="Delete issue" className="confirm-dialog" onClose={onCancel}>
    <div className="dialog-body">
      <p className="confirm-text"><span className="issue-key">{taskKey(taskId)}</span> {title}</p>
      <div className="dialog-actions">
        <button type="button" className="ghost-button compact" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-button danger compact" autoFocus disabled={disabled} onClick={onConfirm}>Delete</button>
      </div>
    </div>
  </Dialog>;
}

/**
 * The one confirmation toast for issue actions (Completed, Moved to, Link copied), on the board and in the issue view.
 * Any surface calls `showIssueToast`; the first mounted `IssueToastHost` (the board, else an open issue) shows it.
 */
export type IssueToast = { id: number; text: string; icon?: ReactNode; undo?: () => void };
const TOAST_MS = 5000;
let toastSeq = 0;
let toastState: { toast: IssueToast | null; hosts: number[] } = { toast: null, hosts: [] };
const toastListeners = new Set<() => void>();
const setToastState = (next: Partial<typeof toastState>) => { toastState = { ...toastState, ...next }; toastListeners.forEach(listener => listener()); };
const subscribeToast = (listener: () => void) => { toastListeners.add(listener); return () => { toastListeners.delete(listener); }; };
let toastTimer: number | undefined;
export function showIssueToast(text: string, undo?: () => void, icon?: ReactNode) {
  const toast = { id: ++toastSeq, text, undo, icon };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { if (toastState.toast?.id === toast.id) setToastState({ toast: null }); }, TOAST_MS);
  setToastState({ toast });
}
export function dismissIssueToast() { window.clearTimeout(toastTimer); setToastState({ toast: null }); }

let hostSeq = 0;
export function IssueToastHost() {
  const [id] = useState(() => ++hostSeq);
  useEffect(() => {
    setToastState({ hosts: [...toastState.hosts, id] });
    return () => setToastState({ hosts: toastState.hosts.filter(host => host !== id) });
  }, [id]);
  const state = useSyncExternalStore(subscribeToast, () => toastState, () => toastState);
  if (!state.toast || state.hosts[0] !== id) return null;
  return <ToastView key={state.toast.id} toast={state.toast} />;
}

/** A top-layer popover, so it shows above an open issue (a modal dialog) as well as on the board. */
function ToastView({ toast }: { toast: IssueToast }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    try { element?.showPopover(); } catch { /* Already shown or unsupported: it still renders in place. */ }
    return () => { try { if (element?.matches(":popover-open")) element.hidePopover(); } catch { /* gone */ } };
  }, []);
  return createPortal(<div ref={ref} popover="manual" className="board-toast" role="status">
    <span className="board-toast-icon">{toast.icon ?? <Check size={14} />}</span>
    <span>{toast.text}</span>
    {toast.undo && <button type="button" onClick={() => { toast.undo?.(); dismissIssueToast(); }}>Undo</button>}
  </div>, document.body);
}
