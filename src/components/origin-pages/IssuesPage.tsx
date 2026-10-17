import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Select } from "../Select";
import {
  Bot as BotIcon, Bug, CalendarDays, CheckCircle2, Circle, CircleDot, Columns3, ExternalLink, Flag, GitBranch, GitPullRequest, GripVertical,
  List, Loader2, MessageCircle, MoreHorizontal, Plus, Search, Tag, Trash2, X,
} from "lucide-react";
import { cloudAction, cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import type {
  CloudBoard, CloudColumn, CloudIssueRelations, CloudPerson, CloudProject, CloudTask, CloudTaskDetails, CloudTaskPullRequest, Priority,
} from "./cloud-types";
import { errorText, fmtDate, githubRepoLabel, taskKey } from "./repo-url";
import {
  CloudGate, EmptyState, Field, Loading, Modal, Notice, PageHeader, Segmented, cardClass, ghostButton, iconButton, inputClass, primaryButton, useAction,
  type OriginPageProps,
} from "./ui";

/** What the Issues page hands to `onAssignToAgent`. */
export type AssignableIssue = {
  id: string;
  key: string;
  projectId: string;
  projectName: string;
  title: string;
  description?: string;
  priority: Priority;
  dueDate?: string;
  labels: string[];
  status: string;
  githubIssueUrl?: string;
};

export type IssuesPageProps = OriginPageProps & { onAssignToAgent?(issue: AssignableIssue): void };

const PRIORITIES: readonly Priority[] = ["low", "medium", "high"];
const priorityTone: Record<Priority, string> = { low: "text-ink-tertiary", medium: "text-warning", high: "text-danger" };

function isDoneColumn(column: CloudColumn): boolean {
  return column.isDone ?? column.title.trim().toLowerCase() === "done";
}

function dueInfo(value?: string): { label: string; tone: string } | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const due = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  const label = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { label, tone: days < 0 ? "text-danger" : days <= 1 ? "text-warning" : "text-ink-secondary" };
}

function parseLabels(value: string): string[] {
  return [...new Set(value.split(",").map((label) => label.trim()).filter(Boolean))].slice(0, 20);
}

function toAssignable(task: CloudTask, project: CloudProject, columns: CloudColumn[]): AssignableIssue {
  return {
    id: task._id, key: taskKey(task._id), projectId: project._id, projectName: project.name, title: task.title, description: task.description,
    priority: task.priority, dueDate: task.dueDate, labels: task.labels ?? [], githubIssueUrl: task.githubIssueUrl,
    status: task.done ? "Done" : columns.find((column) => column._id === task.columnId)?.title ?? "",
  };
}

export function IssuesPage({ onAssignToAgent, ...props }: IssuesPageProps) {
  return (
    <CloudGate {...props} label="Issues">
      {({ project, projectId, canEdit }) => <IssuesBoard project={project} projectId={projectId} canEdit={canEdit} onAssignToAgent={onAssignToAgent} />}
    </CloudGate>
  );
}

function IssuesBoard({ project, projectId, canEdit, onAssignToAgent }: { project: CloudProject; projectId: string; canEdit: boolean; onAssignToAgent?(issue: AssignableIssue): void }) {
  const board = useCloudQuery<CloudBoard>("tasks:board", { projectId });
  const people = useCloudQuery<CloudPerson[]>("members:people", { projectId });
  const [view, setView] = useState<"active" | "completed">("active");
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState<string | null>(null);
  const [columnEditor, setColumnEditor] = useState<CloudColumn | "new" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const ensured = useRef(false);

  useEffect(() => {
    if (!canEdit || !board || board.columns.length || ensured.current) return;
    ensured.current = true;
    void cloudMutation("tasks:ensureDefaultColumns", { projectId }).catch((error) => setNotice(errorText(error, "Could not create columns")));
  }, [board, canEdit, projectId]);

  if (!board) return <Loading label="Loading issues" />;

  const columns = board.columns.filter((column) => !isDoneColumn(column));
  const visibleIds = new Set(columns.map((column) => column._id));
  const fallback = columns.find((column) => column.title.toLowerCase() === "todo") ?? columns[0];
  const laneOf = (task: CloudTask) => (visibleIds.has(task.columnId) ? task.columnId : fallback?._id);
  const needle = query.trim().toLowerCase();
  const matches = (task: CloudTask) => !needle || `${taskKey(task._id)} ${task.title} ${task.description ?? ""} ${task.assignedToName ?? ""} ${(task.labels ?? []).join(" ")}`.toLowerCase().includes(needle);
  const active = board.tasks.filter((task) => !task.done && matches(task));
  const completed = board.tasks.filter((task) => task.done && matches(task)).sort((a, b) => b.updatedAt - a.updatedAt);
  const assignees = new Map([...(board.assignees ?? []), ...(people ?? [])].map((person) => [person.email, person]));

  const report = (error: unknown) => setNotice(errorText(error, "Something went wrong"));
  const move = (taskId: string, columnId: string, beforeTaskId?: string) => {
    void cloudMutation("tasks:moveTask", { projectId, taskId, columnId, ...(beforeTaskId ? { beforeTaskId } : {}) }).catch(report);
  };
  const setDone = (task: CloudTask, done: boolean) => {
    void cloudMutation("tasks:updateTask", { projectId, taskId: task._id, done }).catch(report);
  };
  const remove = (task: CloudTask) => {
    if (!window.confirm(`Delete ${task.title}?`)) return;
    if (selected === task._id) setSelected(null);
    void cloudMutation("tasks:deleteTask", { projectId, taskId: task._id }).catch(report);
  };
  const assign = onAssignToAgent ? (task: CloudTask) => onAssignToAgent(toAssignable(task, project, board.columns)) : undefined;
  const drop = (columnId: string, beforeTaskId?: string) => {
    if (canEdit && dragging && dragging !== beforeTaskId) move(dragging, columnId, beforeTaskId);
    setDragging(null);
  };
  const done = board.tasks.filter((task) => task.done).length;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden p-6" aria-label="Issues">
      <PageHeader title="Issues" count={board.tasks.length ? `${done} of ${board.tasks.length} done` : undefined}>
        <Segmented label="Issue state" value={view} onChange={setView}
          options={[{ value: "active", label: <><Circle size={13} />Active {active.length}</> }, { value: "completed", label: <><CheckCircle2 size={13} />Completed {completed.length}</> }]} />
        {view === "active" && (
          <Segmented label="Layout" value={layout} onChange={setLayout}
            options={[{ value: "board", label: <Columns3 size={14} aria-label="Board view" /> }, { value: "list", label: <List size={14} aria-label="List view" /> }]} />
        )}
        <label className="relative flex items-center">
          <Search size={14} className="pointer-events-none absolute left-2 text-ink-tertiary" aria-hidden="true" />
          <input className={cn(inputClass, "w-44 pl-7")} placeholder="Search issues" aria-label="Search issues" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {canEdit && <button type="button" className={ghostButton} onClick={() => setColumnEditor("new")}><Columns3 size={14} />Column</button>}
        {canEdit && <button type="button" className={primaryButton} disabled={!columns.length} onClick={() => setComposer(fallback?._id ?? "")}><CircleDot size={14} />New issue</button>}
      </PageHeader>
      {!canEdit && <div className="mb-3"><Notice>You have view-only access to this project.</Notice></div>}
      {notice && <div className="mb-3"><Notice tone="danger">{notice}</Notice></div>}

      {view === "completed" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!completed.length ? <EmptyState icon={<CheckCircle2 size={24} />} title="No completed issues" body={needle ? "No issues match your search." : "Completed work will appear here."} /> : (
            <div className={cn(cardClass, "divide-y divide-hairline/30")}>
              {completed.map((task) => (
                <div key={task._id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <CheckCircle2 size={15} className="shrink-0 text-success" aria-hidden="true" />
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setSelected(task._id)}>
                    <span className="font-mono text-[11.5px] text-ink-tertiary">{taskKey(task._id)}</span>
                    <span className="truncate text-ink">{task.title}</span>
                  </button>
                  <time className="text-[12px] text-ink-tertiary">{fmtDate(task.updatedAt)}</time>
                  {canEdit && <button type="button" className={ghostButton} onClick={() => setDone(task, false)}>Restore</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : layout === "list" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {!active.length ? <EmptyState icon={<Circle size={24} />} title="No active issues" body="Create an issue or adjust your search." /> : (
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="text-[12px] text-ink-tertiary">
                <tr>{["Issue", "Status", "Assignee", "Priority", "Due", ""].map((head) => <th key={head} scope="col" className="border-b border-hairline/40 px-3 py-2 font-medium">{head}</th>)}</tr>
              </thead>
              <tbody>
                {active.map((task) => (
                  <tr key={task._id} className="hover:bg-raised/30">
                    <td className="border-b border-hairline/30 px-3 py-2">
                      <button type="button" className="flex items-center gap-3 text-left" onClick={() => setSelected(task._id)}>
                        <span className="font-mono text-[11.5px] text-ink-tertiary">{taskKey(task._id)}</span><span className="text-ink">{task.title}</span>
                      </button>
                    </td>
                    <td className="border-b border-hairline/30 px-3 py-2 text-ink-secondary">{columns.find((column) => column._id === laneOf(task))?.title}</td>
                    <td className="border-b border-hairline/30 px-3 py-2 text-ink-secondary">{task.assignedToName || task.assignedToEmail || "Unassigned"}</td>
                    <td className={cn("border-b border-hairline/30 px-3 py-2 capitalize", priorityTone[task.priority])}>{task.priority}</td>
                    <td className="border-b border-hairline/30 px-3 py-2 text-ink-secondary">{task.dueDate || "—"}</td>
                    <td className="border-b border-hairline/30 px-3 py-2 text-right">
                      <TaskMenu task={task} columns={columns} canEdit={canEdit} onMove={(columnId) => move(task._id, columnId)} onDone={() => setDone(task, true)} onDelete={() => remove(task)} onAssign={assign} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {columns.map((column) => {
            const tasks = active.filter((task) => laneOf(task) === column._id);
            return (
              <div key={column._id} data-column-id={column._id}
                className={cn("flex w-72 shrink-0 flex-col rounded-xl bg-inset/60 p-2", dragging && canEdit && "ring-1 ring-hairline/60")}
                onDragOver={(event) => { if (canEdit && dragging) event.preventDefault(); }}
                onDrop={() => drop(column._id)}>
                <div className="flex items-center gap-2 px-1.5 pb-2 pt-1">
                  <strong className="truncate text-[13px] font-semibold text-ink">{column.title}</strong>
                  <span className="text-[12px] text-ink-tertiary">{tasks.length}</span>
                  <div className="ml-auto flex items-center">
                    {canEdit && <button type="button" className={iconButton} aria-label={`New issue in ${column.title}`} title="New issue" onClick={() => setComposer(column._id)}><Plus size={14} /></button>}
                    {canEdit && <button type="button" className={iconButton} aria-label={`Edit ${column.title} column`} title="Edit column" onClick={() => setColumnEditor(column)}><MoreHorizontal size={14} /></button>}
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                  {!tasks.length && <p className="px-2 py-6 text-center text-[12.5px] text-ink-tertiary">{needle ? "No matching issues" : "No issues"}</p>}
                  {tasks.map((task) => (
                    <TaskCard key={task._id} task={task} columns={columns} canEdit={canEdit} dragging={dragging === task._id}
                      assignee={task.assignedToEmail ? assignees.get(task.assignedToEmail)?.name ?? task.assignedToName ?? task.assignedToEmail : undefined}
                      onOpen={() => setSelected(task._id)} onDragStart={() => setDragging(task._id)} onDragEnd={() => setDragging(null)}
                      onDropBefore={() => drop(column._id, task._id)} onMove={(columnId) => move(task._id, columnId)}
                      onDone={() => setDone(task, true)} onDelete={() => remove(task)} onAssign={assign} />
                  ))}
                </div>
              </div>
            );
          })}
          {!columns.length && <Loading label="Preparing columns" />}
        </div>
      )}

      {composer !== null && <IssueComposer projectId={projectId} columns={columns} people={people ?? []} initialColumnId={composer} onClose={() => setComposer(null)} onCreated={(id) => { setComposer(null); setSelected(id); }} />}
      {columnEditor && <ColumnEditor projectId={projectId} column={columnEditor === "new" ? null : columnEditor} columns={columns} onClose={() => setColumnEditor(null)} />}
      {selected && <IssueDetail key={selected} project={project} projectId={projectId} taskId={selected} canEdit={canEdit} onClose={() => setSelected(null)}
        onDelete={(task) => remove(task)} onAssign={assign} />}
    </section>
  );
}

function TaskCard({ task, columns, canEdit, dragging, assignee, onOpen, onDragStart, onDragEnd, onDropBefore, onMove, onDone, onDelete, onAssign }: {
  task: CloudTask; columns: CloudColumn[]; canEdit: boolean; dragging: boolean; assignee?: string;
  onOpen(): void; onDragStart(): void; onDragEnd(): void; onDropBefore(): void; onMove(columnId: string): void; onDone(): void; onDelete(): void; onAssign?(task: CloudTask): void;
}) {
  const due = dueInfo(task.dueDate);
  return (
    <article draggable={canEdit} tabIndex={0} data-task-id={task._id}
      onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragOver={(event) => { if (canEdit) event.preventDefault(); }}
      onDrop={(event) => { event.stopPropagation(); onDropBefore(); }}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(); } }}
      className={cn("group cursor-pointer rounded-xl border border-hairline/40 bg-panel p-3 outline-none transition-colors hover:border-hairline focus-visible:ring-2 focus-visible:ring-accent/60", dragging && "opacity-40")}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-tertiary">
        {canEdit && <GripVertical size={12} className="-ml-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100" aria-hidden="true" />}
        <span className="font-mono">{taskKey(task._id)}</span>
        <GitHubBadge task={task} />
        <div className="ml-auto" onClick={(event) => event.stopPropagation()}>
          <TaskMenu task={task} columns={columns} canEdit={canEdit} onMove={onMove} onDone={onDone} onDelete={onDelete} onAssign={onAssign} />
        </div>
      </div>
      <div className="flex items-start gap-2">
        <button type="button" aria-label={`Complete ${task.title}`} disabled={!canEdit} className="mt-0.5 shrink-0 text-ink-tertiary hover:text-success disabled:hover:text-ink-tertiary"
          onClick={(event) => { event.stopPropagation(); onDone(); }}>
          <Circle size={15} />
        </button>
        <strong className="text-[13px] font-medium leading-snug text-ink">{task.title}</strong>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px]">
        <span className={cn("flex items-center gap-1 capitalize", priorityTone[task.priority])}><Flag size={11} aria-hidden="true" />{task.priority}</span>
        {due && <span className={cn("flex items-center gap-1", due.tone)} title={`Due ${task.dueDate}`}><CalendarDays size={11} aria-hidden="true" />{due.label}</span>}
        {(task.labels ?? []).map((label) => <span key={label} className="rounded-full bg-raised px-1.5 py-px text-ink-secondary">{label}</span>)}
        {assignee && <span className="ml-auto truncate text-ink-secondary" title={assignee}>{assignee}</span>}
      </div>
    </article>
  );
}

function GitHubBadge({ task }: { task: CloudTask }) {
  if (!task.githubIssueNumber) return null;
  return (
    <span className={cn("flex items-center gap-0.5", task.githubIssueState === "closed" ? "text-ink-tertiary" : "text-success")} title={`GitHub issue #${task.githubIssueNumber} is ${task.githubIssueState ?? "open"}`}>
      <GitBranch size={11} aria-hidden="true" />#{task.githubIssueNumber}
    </span>
  );
}

function TaskMenu({ task, columns, canEdit, onMove, onDone, onDelete, onAssign }: {
  task: CloudTask; columns: CloudColumn[]; canEdit: boolean; onMove(columnId: string): void; onDone(): void; onDelete(): void; onAssign?(task: CloudTask): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  if (!canEdit && !onAssign) return null;
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink";
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div ref={root} className="relative">
      <button type="button" className={iconButton} aria-label={`Actions for ${task.title}`} aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={14} /></button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-30 w-52 rounded-xl border border-hairline/60 bg-menu p-1 shadow-xl">
          {onAssign && <button type="button" role="menuitem" className={item} onClick={pick(() => onAssign(task))}><BotIcon size={14} />Assign to agent</button>}
          {canEdit && <>
            <div className="px-2 pb-0.5 pt-1.5 text-[11px] text-ink-tertiary">Move to</div>
            {columns.filter((column) => column._id !== task.columnId).map((column) => (
              <button key={column._id} type="button" role="menuitem" className={item} onClick={pick(() => onMove(column._id))}><Columns3 size={14} />{column.title}</button>
            ))}
            <button type="button" role="menuitem" className={item} onClick={pick(onDone)}><CheckCircle2 size={14} />Mark complete</button>
            <button type="button" role="menuitem" className={cn(item, "text-danger hover:text-danger")} onClick={pick(onDelete)}><Trash2 size={14} />Delete</button>
          </>}
        </div>
      )}
    </div>
  );
}

function PropertyFields({ columns, people, columnId, onColumn, priority, onPriority, assignee, onAssignee, dueDate, onDueDate, disabled }: {
  columns: CloudColumn[]; people: CloudPerson[]; columnId: string; onColumn(value: string): void; priority: Priority | ""; onPriority(value: Priority): void;
  assignee: string; onAssignee(value: string): void; dueDate: string; onDueDate(value: string): void; disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Field label="Status">
        <Select className={inputClass} value={columnId} onChange={(e) => onColumn(e.target.value)} disabled={disabled}>
          {columns.map((column) => <option key={column._id} value={column._id}>{column.title}</option>)}
        </Select>
      </Field>
      <Field label="Priority">
        <Select className={inputClass} value={priority} onChange={(e) => onPriority(e.target.value as Priority)} disabled={disabled} required>
          <option value="" disabled>Choose…</option>
          {PRIORITIES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
        </Select>
      </Field>
      <Field label="Assignee">
        <Select className={inputClass} value={assignee} onChange={(e) => onAssignee(e.target.value)} disabled={disabled} required>
          <option value="" disabled>Choose a member</option>
          {people.map((person) => <option key={person.email} value={person.email}>{person.name || person.email}</option>)}
        </Select>
      </Field>
      <Field label="Due date">
        <input className={inputClass} type="date" value={dueDate} onChange={(e) => onDueDate(e.target.value)} disabled={disabled} required />
      </Field>
    </div>
  );
}

function IssueComposer({ projectId, columns, people, initialColumnId, onClose, onCreated }: {
  projectId: string; columns: CloudColumn[]; people: CloudPerson[]; initialColumnId: string; onClose(): void; onCreated(taskId: string): void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columnId, setColumnId] = useState(initialColumnId || columns[0]?._id || "");
  const [priority, setPriority] = useState<Priority | "">("medium");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [labels, setLabels] = useState("");
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!priority) return;
    let taskId = "";
    const ok = await action.run(async () => {
      taskId = await cloudMutation<string>("tasks:createTask", { projectId, columnId, title, description, priority, assignedToEmail: assignee, dueDate });
      const chosen = parseLabels(labels);
      if (chosen.length) await cloudMutation("issueRelations:labels", { taskId, labels: chosen });
    }, "Could not create issue");
    if (ok) onCreated(taskId);
  };
  return (
    <Modal title="New issue" onClose={() => { if (!action.busy) onClose(); }}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={cn(inputClass, "text-[15px] font-medium")} placeholder="Issue title" aria-label="Issue title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={250} autoFocus disabled={action.busy} />
        <textarea className={inputClass} placeholder="Add a description…" aria-label="Issue description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} disabled={action.busy} />
        <PropertyFields columns={columns} people={people} columnId={columnId} onColumn={setColumnId} priority={priority} onPriority={setPriority}
          assignee={assignee} onAssignee={setAssignee} dueDate={dueDate} onDueDate={setDueDate} disabled={action.busy} />
        <Field label="Labels">
          <input className={inputClass} placeholder="bug, frontend" value={labels} onChange={(e) => setLabels(e.target.value)} disabled={action.busy} />
        </Field>
        {!people.length && <Notice>Add a member to this project before creating issues: every issue needs an assignee.</Notice>}
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose} disabled={action.busy}>Cancel</button>
          <button className={primaryButton} disabled={action.busy || !title.trim() || !priority || !assignee || !dueDate || !columnId}>
            {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Create issue
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ColumnEditor({ projectId, column, columns, onClose }: { projectId: string; column: CloudColumn | null; columns: CloudColumn[]; onClose(): void }) {
  const [title, setTitle] = useState(column?.title ?? "");
  const others = columns.filter((item) => item._id !== column?._id);
  const [destination, setDestination] = useState(others[0]?._id ?? "");
  const action = useAction();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await action.run(() => column
      ? cloudMutation("tasks:updateColumn", { projectId, columnId: column._id, title, isDone: false })
      : cloudMutation("tasks:createColumn", { projectId, title, isDone: false }), "Could not save column");
    if (ok) onClose();
  };
  const remove = async () => {
    if (!column) return;
    const ok = await action.run(() => cloudMutation("tasks:deleteColumn", { projectId, columnId: column._id, moveToColumnId: destination }), "Could not delete column");
    if (ok) onClose();
  };
  return (
    <Modal title={column ? "Edit column" : "New column"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Name"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={60} autoFocus /></Field>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <button className={primaryButton} disabled={action.busy || !title.trim()}>Save column</button>
        {column && others.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 border-t border-hairline/40 pt-3">
            <Field label="Delete column and move its issues to">
              <Select className={inputClass} value={destination} onChange={(e) => setDestination(e.target.value)}>
                {others.map((item) => <option key={item._id} value={item._id}>{item.title}</option>)}
              </Select>
            </Field>
            <button type="button" className={cn(ghostButton, "text-danger")} disabled={action.busy} onClick={() => void remove()}><Trash2 size={14} />Delete column</button>
          </div>
        )}
      </form>
    </Modal>
  );
}

function IssueDetail({ project, projectId, taskId, canEdit, onClose, onDelete, onAssign }: {
  project: CloudProject; projectId: string; taskId: string; canEdit: boolean; onClose(): void; onDelete(task: CloudTask): void; onAssign?(task: CloudTask): void;
}) {
  const details = useCloudQuery<CloudTaskDetails>("tasks:details", { projectId, taskId });
  const relations = useCloudQuery<CloudIssueRelations>("issueRelations:list", { taskId });
  const [draft, setDraft] = useState<{ title: string; description: string; priority: Priority; assignee: string; dueDate: string } | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const action = useAction();
  const task = details?.task;

  useEffect(() => {
    if (!task || draft) return;
    setDraft({ title: task.title, description: task.description ?? "", priority: task.priority, assignee: task.assignedToEmail ?? "", dueDate: task.dueDate ?? "" });
  }, [task, draft]);

  if (!details || !task || !draft) return <Modal title="Issue" onClose={onClose} wide><Loading label="Opening issue" /></Modal>;

  const columns = details.columns.filter((column) => !isDoneColumn(column));
  const dirty = draft.title !== task.title || draft.description !== (task.description ?? "") || draft.priority !== task.priority
    || draft.assignee !== (task.assignedToEmail ?? "") || draft.dueDate !== (task.dueDate ?? "");
  const labels = relations?.labels ?? task.labels ?? [];
  const save = () => action.run(() => cloudMutation("tasks:updateTask", {
    projectId, taskId,
    ...(draft.title !== task.title ? { title: draft.title } : {}),
    ...(draft.description !== (task.description ?? "") ? { description: draft.description } : {}),
    ...(draft.priority !== task.priority ? { priority: draft.priority } : {}),
    ...(draft.assignee && draft.assignee !== task.assignedToEmail ? { assignedToEmail: draft.assignee } : {}),
    ...(draft.dueDate && draft.dueDate !== task.dueDate ? { dueDate: draft.dueDate } : {}),
  }), "Could not save issue");
  const setLabels = (next: string[]) => void action.run(() => cloudMutation("issueRelations:labels", { taskId, labels: next }), "Could not update labels");
  const close = () => { if (dirty && canEdit && !window.confirm("Discard unsaved changes?")) return; onClose(); };

  return (
    <Modal title={<span><span className="font-mono text-ink-tertiary">{taskKey(task._id)}</span> · {project.name}</span>} onClose={close} wide>
      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <div className="flex min-w-0 flex-col gap-3">
          {task.done && <span className="flex items-center gap-1.5 text-[12.5px] text-success"><CheckCircle2 size={14} />Completed</span>}
          <textarea className={cn(inputClass, "text-[16px] font-semibold")} rows={2} aria-label="Issue title" value={draft.title} maxLength={250} disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea className={inputClass} rows={7} aria-label="Issue description" placeholder="Add a description…" value={draft.description} disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={primaryButton} disabled={!dirty || action.busy || !draft.title.trim()} onClick={() => void save()}>
                {action.busy ? <Loader2 size={14} className="animate-spin" /> : null}Save changes
              </button>
              {dirty && <button type="button" className={ghostButton} onClick={() => setDraft(null)}>Discard</button>}
            </div>
          )}
          {action.error && <Notice tone="danger">{action.error}</Notice>}
          <Comments projectId={projectId} taskId={taskId} details={details} canEdit={canEdit} />
        </div>
        <aside className="flex flex-col gap-4" aria-label="Issue properties">
          <PropertyFields columns={columns} people={details.members} columnId={columns.some((c) => c._id === task.columnId) ? task.columnId : ""}
            onColumn={(columnId) => void action.run(() => cloudMutation("tasks:moveTask", { projectId, taskId, columnId }), "Could not move issue")}
            priority={draft.priority} onPriority={(priority) => setDraft({ ...draft, priority })}
            assignee={draft.assignee} onAssignee={(assignee) => setDraft({ ...draft, assignee })}
            dueDate={draft.dueDate} onDueDate={(dueDate) => setDraft({ ...draft, dueDate })} disabled={!canEdit} />
          <Section icon={<Tag size={13} />} title="Labels">
            <div className="flex flex-wrap gap-1.5">
              {labels.map((label) => (
                <span key={label} className="flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-[12px] text-ink-secondary">
                  {label}
                  {canEdit && <button type="button" aria-label={`Remove label ${label}`} className="hover:text-ink" onClick={() => setLabels(labels.filter((item) => item !== label))}><X size={11} /></button>}
                </span>
              ))}
              {!labels.length && <span className="text-[12px] text-ink-tertiary">No labels</span>}
            </div>
            {canEdit && (
              <form className="mt-2" onSubmit={(event) => { event.preventDefault(); const next = parseLabels([...labels, labelInput].join(",")); setLabelInput(""); setLabels(next); }}>
                <input className={inputClass} placeholder="Add label and press Enter" aria-label="Add label" value={labelInput} maxLength={32} onChange={(e) => setLabelInput(e.target.value)} />
              </form>
            )}
          </Section>
          <GitHubSection project={project} projectId={projectId} task={task} canEdit={canEdit} />
          <dl className="grid grid-cols-2 gap-1 text-[12px]">
            <dt className="text-ink-tertiary">Created</dt><dd className="text-ink-secondary">{fmtDate(task.createdAt)}</dd>
            <dt className="text-ink-tertiary">Updated</dt><dd className="text-ink-secondary">{fmtDate(task.updatedAt)}</dd>
          </dl>
          <div className="flex flex-col gap-2 border-t border-hairline/40 pt-3">
            {onAssign && <button type="button" className={ghostButton} onClick={() => onAssign(task)}><BotIcon size={14} />Assign to agent</button>}
            {canEdit && <button type="button" className={ghostButton} onClick={() => void action.run(() => cloudMutation("tasks:updateTask", { projectId, taskId, done: !task.done }), "Could not update issue")}>
              {task.done ? <Circle size={14} /> : <CheckCircle2 size={14} />}{task.done ? "Reopen issue" : "Mark complete"}
            </button>}
            {canEdit && <button type="button" className={cn(ghostButton, "text-danger")} onClick={() => onDelete(task)}><Trash2 size={14} />Delete issue</button>}
          </div>
        </aside>
      </div>
    </Modal>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary">{icon}{title}</h4>
      {children}
    </section>
  );
}

function GitHubSection({ project, projectId, task, canEdit }: { project: CloudProject; projectId: string; task: CloudTask; canEdit: boolean }) {
  const prs = useCloudQuery<CloudTaskPullRequest[]>("taskPRs:list", { taskId: task._id });
  const [manualUrl, setManualUrl] = useState("");
  const [message, setMessage] = useState("");
  const action = useAction();
  const mode = task.githubTaskMode ?? project.githubTaskMode ?? "issue";
  const create = () => action.run(async () => {
    const result = await cloudAction<{ ok: boolean; issueUrl: string; manualUrl: string; message: string }>("github:createIssueForTask", { projectId, taskId: task._id });
    setMessage(result.message);
    setManualUrl(result.ok ? "" : result.manualUrl);
  }, "GitHub issue creation failed");
  return (
    <Section icon={<GitBranch size={13} />} title="GitHub">
      <p className="mb-1.5 truncate text-[12px] text-ink-tertiary">{githubRepoLabel(project.repoUrl)}</p>
      {task.githubIssueUrl ? (
        <a className={cn(ghostButton, "w-full justify-start")} href={task.githubIssueUrl} target="_blank" rel="noreferrer">
          <Bug size={14} />Issue #{task.githubIssueNumber}
          <span className={cn("ml-auto text-[11.5px]", task.githubIssueState === "closed" ? "text-ink-tertiary" : "text-success")}>{task.githubIssueState ?? "open"}</span>
          <ExternalLink size={12} />
        </a>
      ) : project.repoUrl && mode === "issue" && canEdit ? (
        <button type="button" className={cn(ghostButton, "w-full")} disabled={action.busy} onClick={() => void create()}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Create GitHub issue
        </button>
      ) : null}
      {prs?.map((pr) => (
        <div key={pr._id} className="mt-2 rounded-lg bg-inset px-2.5 py-2 text-[12px]">
          <a href={pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-ink hover:underline">
            <GitPullRequest size={13} />PR #{pr.number}<span className="ml-auto capitalize text-ink-secondary">{pr.state}</span>
          </a>
          <p className="mt-1 text-ink-tertiary">Checks: {pr.checks} · Review: {pr.review} · Mergeable: {pr.mergeable == null ? "unknown" : pr.mergeable ? "yes" : "no"}</p>
        </div>
      ))}
      {message && <p className="mt-1.5 text-[12px] text-ink-secondary" role="status">{message}</p>}
      {manualUrl && <a className="mt-1 inline-flex items-center gap-1 text-[12px] text-accent-text hover:underline" href={manualUrl} target="_blank" rel="noreferrer">Open a prefilled GitHub issue<ExternalLink size={11} /></a>}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Section>
  );
}

function Comments({ projectId, taskId, details, canEdit }: { projectId: string; taskId: string; details: CloudTaskDetails; canEdit: boolean }) {
  const [body, setBody] = useState("");
  const action = useAction();
  const entries = [
    ...details.comments.map((comment) => ({ id: comment._id, at: comment.createdAt, author: comment.authorName, body: comment.body as ReactNode })),
    ...details.assets.filter((asset) => !asset.commentId).map((asset) => ({
      id: asset._id, at: asset.createdAt, author: "Attachment",
      body: <a href={asset.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">{asset.name}<ExternalLink size={11} /></a> as ReactNode,
    })),
  ].sort((a, b) => a.at - b.at);
  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!body.trim()) return;
    if (await action.run(() => cloudMutation("tasks:addComment", { projectId, taskId, body }), "Could not send comment")) setBody("");
  };
  return (
    <section className="mt-2 border-t border-hairline/40 pt-3" aria-label="Activity">
      <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink"><MessageCircle size={14} />Activity <span className="font-normal text-ink-tertiary">{entries.length}</span></h4>
      <div className="flex flex-col gap-2.5">
        {!entries.length && <p className="text-[12.5px] text-ink-tertiary">No activity yet.</p>}
        {entries.map((entry) => (
          <article key={entry.id} className="rounded-lg bg-inset/70 px-3 py-2">
            <header className="mb-0.5 flex items-center gap-2 text-[12px]">
              <strong className="font-medium text-ink">{entry.author}</strong>
              <time className="text-ink-tertiary" dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
            </header>
            <div className="whitespace-pre-wrap break-words text-[13px] text-ink-secondary">{entry.body}</div>
          </article>
        ))}
      </div>
      {canEdit && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
          <textarea className={inputClass} rows={3} placeholder="Leave a comment…" aria-label="Comment" value={body} maxLength={8000} disabled={action.busy}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event); }} />
          {action.error && <Notice tone="danger">{action.error}</Notice>}
          <button className={cn(primaryButton, "self-end")} disabled={action.busy || !body.trim()}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : null}Comment</button>
        </form>
      )}
    </section>
  );
}
