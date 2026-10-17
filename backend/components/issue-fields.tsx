"use client";

import type { ReactNode } from "react";
import { Circle, ChartNoAxesColumnIncreasing } from "lucide-react";
import { MemberPicker } from "./member-picker";
import { IssueSelect } from "./issue-select";
import type { AvatarIdentity } from "./user-avatar";

export function IssueFields({ columns, members, columnId, onColumnChange, priority, onPriorityChange, assignee, onAssigneeChange, dueDate, onDueDateChange, disabled = false, children }: {
  columns: { _id: string; title: string }[]; members: (AvatarIdentity & { email: string })[];
  columnId: string; onColumnChange: (value: string) => void;
  priority: "" | "low" | "medium" | "high"; onPriorityChange: (value: "low" | "medium" | "high") => void;
  assignee: string; onAssigneeChange: (value: string) => void;
  dueDate: string; onDueDateChange: (value: string) => void; disabled?: boolean;
  children?: ReactNode;
}) {
  return <div className="issue-field-grid issue-property-chips">
    <IssueSelect label="Status" icon={<Circle size={15} />} value={columnId} onChange={onColumnChange} options={columns.map(column => ({ value: column._id, label: column.title }))} disabled={disabled} />
    <IssueSelect label="Priority" icon={<ChartNoAxesColumnIncreasing size={15} />} value={priority} onChange={value => onPriorityChange(value as "low" | "medium" | "high")} options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} disabled={disabled} />
    <div className="issue-assignee-field"><MemberPicker label="Assignee" members={members} value={assignee} onChange={onAssigneeChange} disabled={disabled} required /></div>
    <label className="issue-date-chip"><input aria-label="Due date" title="Due date" required type="date" value={dueDate} onChange={e => onDueDateChange(e.target.value)} disabled={disabled} /></label>
    {children}
  </div>;
}
