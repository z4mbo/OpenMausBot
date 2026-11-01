"use client";

import type { ReactNode } from "react";
import { CalendarDays, Circle } from "lucide-react";
import { PriorityIcon } from "./priority-icon";
import { MemberPicker } from "./member-picker";
import { IssueSelect } from "./issue-select";
import type { AvatarIdentity } from "./user-avatar";

export function IssueFields({ columns, members, columnId, onColumnChange, priority, onPriorityChange, assignee, onAssigneeChange, dueDate, onDueDateChange, disabled = false, labeled = false, children }: {
  columns: { _id: string; title: string }[]; members: (AvatarIdentity & { email: string })[];
  columnId: string; onColumnChange: (value: string) => void;
  priority: "" | "low" | "medium" | "high"; onPriorityChange: (value: "low" | "medium" | "high") => void;
  assignee: string; onAssigneeChange: (value: string) => void;
  dueDate: string; onDueDateChange: (value: string) => void; disabled?: boolean;
  /** Property rows with visible labels (issue sidebar) instead of a row of chips (composer). */
  labeled?: boolean;
  children?: ReactNode;
}) {
  const status = <IssueSelect label="Status" icon={<Circle size={14} />} value={columnId} onChange={onColumnChange} options={columns.map(column => ({ value: column._id, label: column.title }))} disabled={disabled} />;
  const priorityField = <IssueSelect label="Priority" icon={<PriorityIcon priority={priority} />} value={priority} onChange={value => onPriorityChange(value as "low" | "medium" | "high")} options={(["low", "medium", "high"] as const).map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), icon: <PriorityIcon priority={value} /> }))} disabled={disabled} />;
  const assigneeField = <div className="issue-assignee-field"><MemberPicker label="Assignee" members={members} value={assignee} onChange={onAssigneeChange} disabled={disabled} required /></div>;
  const due = <label className="issue-date-chip"><CalendarDays size={14} /><input aria-label="Due date" required type="date" value={dueDate} onChange={e => onDueDateChange(e.target.value)} disabled={disabled} /></label>;
  if (labeled) return <div className="issue-properties">
    <div className="issue-property"><span>Status</span>{status}</div>
    <div className="issue-property"><span>Priority</span>{priorityField}</div>
    <div className="issue-property"><span>Assignee</span>{assigneeField}</div>
    <div className="issue-property"><span>Due date</span>{due}</div>
    {children}
  </div>;
  return <div className="issue-field-grid issue-property-chips">{status}{priorityField}{assigneeField}{due}{children}</div>;
}
