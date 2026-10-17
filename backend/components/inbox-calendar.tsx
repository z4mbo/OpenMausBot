"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarDays, ChevronLeft, ChevronRight, Circle, CheckCircle2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "./workspace-context";
import { ContentSkeleton } from "./content-skeleton";
import { IssueSelect } from "./issue-select";

function day(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function InboxCalendar({ sessionToken, onOpenTask, mine, done, project, priority, search }: { sessionToken: string; onOpenTask: (projectId: Id<"projects">, taskId: Id<"tasks">) => void; mine: boolean; done: boolean; project: string; priority: string; search: string }) {
  const workspace = useWorkspace();
  const [anchor, setAnchor] = useState(() => day(new Date()));
  const [mode, setMode] = useState<"week" | "month">("week");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const current = new Date(`${anchor}T12:00:00`);
  const start = new Date(current);
  if (mode === "month") start.setDate(1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const length = mode === "month" ? 42 : 7;
  const days = Array.from({ length }, (_, i) => { const date = new Date(start); date.setDate(date.getDate() + i); return date; });
  const calendar = useQuery(api.inbox.calendar, { sessionToken, teamId: workspace._id, start: day(start), end: day(days[length - 1]), mine });
  const update = useMutation(api.tasks.updateTask);
  const move = (amount: number) => { const date = new Date(current); if (mode === "month") { date.setDate(1); date.setMonth(date.getMonth() + amount); } else date.setDate(date.getDate() + amount * 7); setAnchor(day(date)); };
  return <section className="inbox-calendar" aria-label="Issue calendar">
    <div className="feature-toolbar">
      <div className="feature-toolbar-spacer" />
      <button className="ghost-button compact" onClick={() => setAnchor(day(new Date()))}><CalendarDays size={14} />Today</button>
      <IssueSelect label="Calendar range" value={mode} onChange={value => setMode(value as typeof mode)} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
      <button className="icon-button" aria-label="Previous period" title="Previous period" onClick={() => move(-1)}><ChevronLeft size={17} /></button>
      <span className="calendar-period">{current.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
      <button className="icon-button" aria-label="Next period" title="Next period" onClick={() => move(1)}><ChevronRight size={17} /></button>
    </div>
    {notice && <p className="notice danger" role="alert">{notice}</p>}
    {calendar?.truncated && <p className="notice">Showing the first 500 scheduled issues. Use the issue list for the complete workload.</p>}
    {!calendar ? <ContentSkeleton rows={7} /> : <div className={`calendar-grid ${mode}`} aria-busy={pending}>{days.map(date => {
      const key = day(date); const tasks = calendar.tasks.filter(task => task.dueDate === key && Boolean(task.done) === done && (!project || task.projectId === project) && (!priority || task.priority === priority) && `${task.title} ${task.projectName}`.toLowerCase().includes(search.trim().toLowerCase()));
      return <section className={`calendar-day ${key === day(new Date()) ? "today" : ""} ${date.getMonth() !== current.getMonth() ? "other-month" : ""}`} key={key} aria-label={date.toLocaleDateString(undefined, { dateStyle: "full" })}
        onDragOver={event => { if (workspace.role !== "viewer") event.preventDefault(); }} onDrop={async event => {
          event.preventDefault(); if (pending || workspace.role === "viewer") return;
          const task = calendar.tasks.find(t => t._id === event.dataTransfer.getData("application/x-origin-issue"));
          if (!task || task.dueDate === key) return;
          setPending(true); setNotice("");
          try { await update({ sessionToken, projectId: task.projectId, taskId: task._id, dueDate: key }); }
          catch (error) { setNotice(error instanceof Error ? error.message : "Could not reschedule issue"); }
          finally { setPending(false); }
        }}>
        <time dateTime={key}><span>{date.toLocaleDateString(undefined, { weekday: "short" })}</span><strong>{date.getDate()}</strong></time>
        <div>{tasks.map(task => <button className={`calendar-task ${task.done ? "done" : ""}`} key={task._id} draggable={workspace.role !== "viewer" && !pending} onDragStart={event => event.dataTransfer.setData("application/x-origin-issue", task._id)} onClick={() => onOpenTask(task.projectId, task._id)} title={task.title}>
          {task.done ? <CheckCircle2 size={13} /> : <Circle className={`priority-${task.priority}`} size={13} />}<span><strong>{task.title}</strong><small>{task.projectName}</small></span>
        </button>)}{!tasks.length && <span className="calendar-empty">No issues</span>}</div>
      </section>;
    })}</div>}
  </section>;
}
