"use client";

import { memo, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import clsx from "clsx";
import { CalendarDays, Check, Circle, MoreHorizontal, UserRound } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { displayName, formatDue } from "@/lib/format";
import { taskKey } from "@/lib/project-issues";
import { GitHubIssueIndicator } from "./github-issue-indicator";
import { PriorityIcon } from "./issue-icons";
import { UserAvatar } from "./user-avatar";
import type { TaskMenuAnchor, TaskMenuView } from "./task-actions-menu";

export type CardPerson = { email: string; name?: string; username?: string; avatarUrl?: string | null };
const PRIORITY_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

export type IssueCardProps = {
  task: Doc<"tasks">;
  assignee: CardPerson | null;
  canEdit: boolean;
  tabStop: boolean;
  selected: boolean;
  completing?: "checked";
  dragState?: "placeholder" | "moving";
  keyboardMoving: boolean;
  menuOpen: boolean;
  onOpen: (taskId: Doc<"tasks">["_id"]) => void;
  onComplete: (task: Doc<"tasks">) => void;
  onMenu: (task: Doc<"tasks">, view: TaskMenuView, anchor: TaskMenuAnchor, from: HTMLElement) => void;
  /** Opens the due date popover anchored to the clicked chip. */
  onDueDate: (task: Doc<"tasks">, from: HTMLElement) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>, task: Doc<"tasks">) => void;
  onFocus: (taskId: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, taskId: string) => void;
  onHandleKeyDown: (event: ReactKeyboardEvent<HTMLElement>, taskId: string) => void;
  onHandleClick: (event: ReactMouseEvent<HTMLElement>, taskId: string) => void;
  onHandleBlur: (taskId: string) => void;
};

const box = (element: Element): TaskMenuAnchor => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; };

/**
 * One board card. The card is a single Tab stop that opens the issue; its chips edit priority, due date and assignee in
 * place. Inner controls are pointer targets only (tabIndex -1): keyboard users get the same actions from the menu
 * (Shift+F10 / context-menu key) and the issue view.
 */
export const IssueCard = memo(function IssueCard({ task, assignee, canEdit, tabStop, selected, completing, dragState, keyboardMoving, menuOpen, onOpen, onComplete, onMenu, onDueDate, onKeyDown, onFocus, onPointerDown, onHandleKeyDown, onHandleClick, onHandleBlur }: IssueCardProps) {
  const key = taskKey(task._id);
  const due = formatDue(task.dueDate);
  const done = task.done || Boolean(completing);
  const chip = (view: TaskMenuView) => (event: ReactMouseEvent<HTMLButtonElement>) => { event.stopPropagation(); onMenu(task, view, box(event.currentTarget), event.currentTarget); };
  const name = assignee ? displayName(assignee) : "";
  return (
    <article
      className={clsx("task-card", canEdit && "can-drag", done && "done", selected && "is-selected", menuOpen && "has-menu",
        completing && "is-completing",
        dragState === "placeholder" && "is-placeholder", dragState === "moving" && "is-moving")}
      data-task-id={task._id}
      data-priority={task.priority}
      tabIndex={tabStop ? 0 : -1}
      aria-label={`${key} ${task.title}`}
      aria-current={selected ? "true" : undefined}
      onPointerDown={event => onPointerDown(event, task._id)}
      onDragStart={event => event.preventDefault()}
      onClick={() => onOpen(task._id)}
      onFocus={event => { if (event.target === event.currentTarget) onFocus(task._id); }}
      onKeyDown={event => onKeyDown(event, task)}
      onContextMenu={event => {
        if (!canEdit || (event.target as Element).closest("input")) return;
        event.preventDefault();
        onMenu(task, "root", { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY }, event.currentTarget);
      }}
    >
      <div className="task-card-head">
        <span className="task-code">{key}<GitHubIssueIndicator number={task.githubIssueNumber} /></span>
        {canEdit && <button className="drag-handle" type="button" tabIndex={-1} aria-label={`Move ${task.title}`} aria-pressed={keyboardMoving} onKeyDown={event => onHandleKeyDown(event, task._id)} onClick={event => onHandleClick(event, task._id)} onBlur={() => onHandleBlur(task._id)} />}
        {canEdit
          ? <button type="button" tabIndex={-1} className={clsx("task-assignee", !assignee && "is-empty")} aria-label={assignee ? `Assignee: ${name}` : "Assign"} title={name || undefined} aria-haspopup="menu" onClick={chip("assignee")}>
            {assignee ? <UserAvatar user={assignee} size="small" /> : <UserRound size={12} />}
          </button>
          : assignee && <span className="task-assignee" title={name}><UserAvatar user={assignee} size="small" /></span>}
      </div>
      <div className="task-top">
        <button className="check-button" type="button" tabIndex={-1} aria-label={done ? `Completed ${task.title}` : `Complete ${task.title}`} disabled={!canEdit || done} onClick={event => { event.stopPropagation(); onComplete(task); }}>
          {done ? <span className="check-done"><Check size={10} strokeWidth={3} /></span> : <Circle size={15} />}
        </button>
        <strong>{task.title}</strong>
      </div>
      <div className="task-meta">
        {canEdit
          ? <button type="button" tabIndex={-1} className={clsx("task-chip priority", task.priority)} aria-label={`Priority: ${PRIORITY_LABEL[task.priority] ?? task.priority}`} aria-haspopup="menu" onClick={chip("priority")}><PriorityIcon priority={task.priority} />{PRIORITY_LABEL[task.priority] ?? task.priority}</button>
          : <span className={clsx("task-chip priority", task.priority)}><PriorityIcon priority={task.priority} />{PRIORITY_LABEL[task.priority] ?? task.priority}</span>}
        {due && (canEdit
          ? <button type="button" tabIndex={-1} className={clsx("task-chip due-chip", due.tone)} aria-label={`Due ${due.label}`} aria-haspopup="dialog" onClick={event => { event.stopPropagation(); onDueDate(task, event.currentTarget); }}><CalendarDays size={12} />{due.label}</button>
          : <span className={clsx("task-chip due-chip", due.tone)}><CalendarDays size={12} />{due.label}</span>)}
        {canEdit && <button type="button" tabIndex={-1} className="icon-button task-menu-button task-actions" aria-label={`Issue options for ${task.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={event => { event.stopPropagation(); onMenu(task, "root", box(event.currentTarget), event.currentTarget); }}><MoreHorizontal size={14} /></button>}
      </div>
    </article>
  );
});
