"use client";

import type { ReactNode } from "react";
import { Circle } from "lucide-react";
import { PriorityIcon, StatusIcon } from "./issue-icons";
import { MemberPicker } from "./member-picker";
import { IssueSelect } from "./issue-select";
import { DatePicker } from "./date-picker";
import type { AvatarIdentity } from "./user-avatar";

export type IssueFieldKey = "status" | "priority" | "assignee" | "dueDate";
type Priority = "low" | "medium" | "high";

export const PRIORITY_OPTIONS = (["high", "medium", "low"] as const).map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), icon: <PriorityIcon priority={value} /> }));

/**
 * Status, priority, assignee and due date. `labeled` renders property rows with visible labels (issue view sidebar);
 * otherwise a wrapping row of chips (composer). Each control opens the matching picker.
 */
export function IssueFields({ columns, members, columnId, onColumnChange, priority, onPriorityChange, assignee, onAssigneeChange, dueDate, onDueDateChange, done = false, disabled = false, labeled = false, currentEmail, errors, children }: {
  columns: { _id: string; title: string }[]; members: (AvatarIdentity & { email: string })[];
  columnId: string; onColumnChange: (value: string) => void;
  priority: "" | Priority; onPriorityChange: (value: Priority) => void;
  assignee: string; onAssigneeChange: (value: string) => void;
  dueDate: string; onDueDateChange: (value: string) => void; disabled?: boolean;
  /** The issue is completed: its due date is neutral. */
  done?: boolean;
  labeled?: boolean;
  /** Shown first in the assignee picker as "You". */
  currentEmail?: string;
  /** Inline validation or save errors, shown next to the field. */
  errors?: Partial<Record<IssueFieldKey, string>>;
  children?: ReactNode;
}) {
  const status = <IssueSelect label="Status" icon={<Circle size={14} />} value={columnId} onChange={onColumnChange} options={columns.map(column => ({ value: column._id, label: column.title, icon: <StatusIcon title={column.title} /> }))} disabled={disabled} caption="Status" />;
  const priorityField = <IssueSelect label="Priority" icon={<PriorityIcon priority={priority} />} value={priority} onChange={value => onPriorityChange(value as Priority)} options={PRIORITY_OPTIONS} disabled={disabled} caption="Priority" />;
  const assigneeField = <MemberPicker label="Assignee" placeholder={labeled ? "Unassigned" : "Assignee"} noneLabel="Unassigned" members={members} value={assignee} onChange={onAssigneeChange} currentEmail={currentEmail} disabled={disabled} caption="Assignee" />;
  const due = <DatePicker label="Due date" placeholder={labeled ? "No due date" : "Due date"} value={dueDate} onChange={onDueDateChange} disabled={disabled} done={done} />;
  const error = (key: IssueFieldKey) => errors?.[key] ? <small className="issue-field-error" role="alert">{errors[key]}</small> : null;
  if (labeled) return <div className="issue-properties">
    <div className="issue-property" data-field="status"><span>Status</span><div>{status}{error("status")}</div></div>
    <div className="issue-property" data-field="priority"><span>Priority</span><div>{priorityField}{error("priority")}</div></div>
    <div className="issue-property" data-field="assignee"><span>Assignee</span><div>{assigneeField}{error("assignee")}</div></div>
    <div className="issue-property" data-field="due"><span>Due date</span><div>{due}{error("dueDate")}</div></div>
    {children}
  </div>;
  return <>
    <div className="issue-property-chips">{status}{priorityField}{assigneeField}{due}{children}</div>
    {error("status")}{error("priority")}{error("assignee")}{error("dueDate")}
  </>;
}
