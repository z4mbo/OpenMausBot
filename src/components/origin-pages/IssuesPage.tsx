import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import {
  Bot as BotIcon, CalendarDays, CheckCircle2, ChevronRight, Circle, CircleDashed, Columns3, ExternalLink, GitBranch, GitPullRequest, GripVertical,
  List, Loader2, MessageCircle, MoreHorizontal, Plus, Search, SignalMedium, Trash2, UserRound,
} from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { ApiError } from "@/state/store";
import { consumeIssueFocus, useIssueFocus } from "@/lib/origin-issue-focus";
import { cn } from "@/lib/cn";
import { GlassHeader } from "../GlassScrollFrame";
import { Select } from "../Select";
import type {
  CloudBoard, CloudColumn, CloudPerson, CloudProject, CloudTask, CloudTaskDetails, CloudTaskPullRequest, Priority,
} from "./cloud-types";
import { errorText, fmtDate, githubRepoLabel, taskKey } from "./repo-url";
import {
  CloudGate, EmptyState, Field, Loading, Modal, Notice, PageHeader, Segmented, cardClass, chipButton, ghostButton, glassHeaderRow, iconButton, inputClass, primaryButton, underGlass, useAction,
  type OriginPageProps,
} from "./ui";
import {
  AgentChip, ChipSelect, ColumnIcon, DateChip, IssueChips, IssueDialog, PriorityIcon, ProjectDot, capitalize, isDoneColumn, issueDescriptionClass, issueTitleClass, memberOptions,
  priorityOptions, statusOptions,
  type CreatedIssue, type IssueAgent,
} from "./issue-fields";
import { orderForMove, stepTarget, useFlip, withPendingMoves, type PendingMove } from "./issue-order";
import { NewIssueComposer } from "./NewIssueComposer";
import { CompleteIssueDialog, completesThroughPullRequest, type IssueImplementer } from "./CompleteIssueDialog";
import { originGitHub } from "@/lib/origin-github";
import { DRAFT_COLUMN_TITLE, isDraftColumn, isLegacyIdeaColumn } from "../../../shared/origin-columns";
import { PersonAvatar } from "./PersonAvatar";
import { useCardDrag, type CardDrag, type DropTarget } from "./use-card-drag";

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
  githubIssueNumber?: number;
};

/** The project's Chief, handed an issue marked complete that still needs its pull request. */
export type IssueChief = { name: string; implement(issue: AssignableIssue): void };

export type IssuesPageProps = OriginPageProps & {
  /** The project's agents, offered wherever an issue can be handed off. */
  agents?: readonly IssueAgent[];
  /** Hands an issue to an agent; without `agentId` the host asks which one. */
  onAssignToAgent?(issue: AssignableIssue, agentId?: string): void;
  chief?: IssueChief;
};

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

export function toAssignable(task: Pick<CloudTask, "_id" | "title" | "description" | "priority" | "dueDate" | "labels" | "githubIssueUrl" | "githubIssueNumber" | "done" | "columnId">, project: { _id: string; name: string }, columns: readonly CloudColumn[]): AssignableIssue {
  return {
    id: task._id, key: taskKey(task._id), projectId: project._id, projectName: project.name, title: task.title, description: task.description,
    priority: task.priority, dueDate: task.dueDate, labels: task.labels ?? [], githubIssueUrl: task.githubIssueUrl, githubIssueNumber: task.githubIssueNumber,
    status: task.done ? "Done" : columns.find((column) => column._id === task.columnId)?.title ?? "",
  };
}

export function createdToAssignable(issue: CreatedIssue, projectName: string): AssignableIssue {
  return {
    id: issue.taskId, key: taskKey(issue.taskId), projectId: issue.projectId, projectName, title: issue.title, description: issue.description || undefined,
    priority: issue.priority, dueDate: issue.dueDate, labels: issue.labels, status: issue.status,
  };
}

export function IssuesPage({ onAssignToAgent, agents, chief, ...props }: IssuesPageProps) {
  return (
    <CloudGate {...props} label="Issues">
      {({ project, projectId, canEdit }) => <IssuesBoard project={project} projectId={projectId} canEdit={canEdit} agents={agents ?? []} onAssignToAgent={onAssignToAgent} chief={chief} />}
    </CloudGate>
  );
}

const isInProgressColumn = (column: CloudColumn) => !isDoneColumn(column) && column.title.toLowerCase().replace(/[\s_-]+/g, "") === "inprogress";

function handOver(chief: IssueChief | undefined, project: CloudProject, projectId: string, columns: readonly CloudColumn[], task: CloudTask): IssueImplementer | undefined {
  if (!chief) return undefined;
  return {
    name: chief.name,
    async start() {
      const inProgress = columns.find(isInProgressColumn);
      if (inProgress && task.columnId !== inProgress._id) await cloudMutation("tasks:moveTask", { projectId, taskId: task._id, columnId: inProgress._id });
      chief.implement(toAssignable(task, project, columns));
    },
  };
}

/** Deletes an issue and its GitHub issue; when GitHub cannot be reached, the person may still delete it in Origin alone. */
async function deleteIssue(projectId: string, task: CloudTask): Promise<string> {
  const deleteHere = () => cloudMutation("tasks:deleteTask", { projectId, taskId: task._id });
  if (!task.githubIssueUrl) {
    await deleteHere();
    return "";
  }
  try {
    return (await originGitHub.deleteIssue(projectId, task._id)).message;
  } catch (error) {
    const reachedGitHub = error instanceof ApiError && Boolean(error.body?.github);
    const reason = errorText(error, "GitHub request failed");
    if (reachedGitHub || !window.confirm(`GitHub issue #${task.githubIssueNumber} could not be removed: ${reason}\n\nDelete ${taskKey(task._id)} in Origin only and leave its GitHub issue as it is?`)) throw error;
    await deleteHere();
    return `Deleted ${taskKey(task._id)} in Origin only; GitHub issue #${task.githubIssueNumber} is unchanged.`;
  }
}

function IssuesBoard({ project, projectId, canEdit, agents, onAssignToAgent, chief }: {
  project: CloudProject; projectId: string; canEdit: boolean; agents: readonly IssueAgent[]; onAssignToAgent?(issue: AssignableIssue, agentId?: string): void; chief?: IssueChief;
}) {
  const board = useCloudQuery<CloudBoard>("tasks:board", { projectId });
  const people = useCloudQuery<CloudPerson[]>("members:people", { projectId });
  const [view, setView] = useState<"active" | "completed">("active");
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState<string | null>(null);
  const [columnEditor, setColumnEditor] = useState<CloudColumn | "new" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, PendingMove>>(new Map());
  const [moves, setMoves] = useState(0);
  const [notice, setNotice] = useState("");
  const [info, setInfo] = useState("");
  const [completing, setCompleting] = useState<string | null>(null);
  const ensured = useRef(false);
  const renamed = useRef(false);
  const mirrored = useRef(new Set<string>());
  const lanesRef = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const focus = useIssueFocus(projectId);
  const seed = useRef<(id: string, from: DOMRect) => void>(() => {});
  const placed = useRef<(taskId: string, target: DropTarget) => void>(() => {});
  const cardDrag = useCardDrag({ enabled: canEdit, root: lanesRef, onDrop: (taskId, target, from) => { seed.current(taskId, from); placed.current(taskId, target); } });
  const target = cardDrag.target;
  seed.current = useFlip(lanesRef, `${moves}:${target?.columnId ?? ""}:${target?.beforeTaskId ?? ""}`);

  useEffect(() => {
    if (!focus) return;
    setSelected(focus.issueId);
    consumeIssueFocus(focus);
  }, [focus]);

  useEffect(() => {
    if (!canEdit || !board || !project.repoUrl) return;
    const drafts = new Set(board.columns.filter(isDraftColumn).map((column) => column._id));
    const unlinked = board.tasks.filter((task) => !task.done && !task.githubIssueNumber && !drafts.has(task.columnId) && !mirrored.current.has(task._id)).map((task) => task._id);
    if (!unlinked.length) return;
    for (const id of unlinked) mirrored.current.add(id);
    void originGitHub.mirrorIssues(projectId, unlinked).catch(() => undefined);
  }, [board, canEdit, project.repoUrl, projectId]);

  useEffect(() => {
    const idea = !board?.columns.some(isDraftColumn) && board?.columns.find(isLegacyIdeaColumn);
    if (!canEdit || !idea || renamed.current) return;
    renamed.current = true;
    void cloudMutation("tasks:updateColumn", { projectId, columnId: idea._id, title: DRAFT_COLUMN_TITLE, isDone: false }).catch((error) => setNotice(errorText(error, "Could not rename the Idea column to Draft")));
  }, [board, canEdit, projectId]);

  useEffect(() => {
    if (!canEdit || !board || board.columns.length || ensured.current) return;
    ensured.current = true;
    void cloudMutation("tasks:ensureDefaultColumns", { projectId }).catch((error) => setNotice(errorText(error, "Could not create columns")));
  }, [board, canEdit, projectId]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (event.key === "c" && canEdit) { event.preventDefault(); setComposer(""); }
      if (event.key === "/") { event.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit]);

  if (!board) return <Loading label="Loading issues" variant="board" />;

  const tasks = withPendingMoves(board.tasks, pending);
  const columns = board.columns.filter((column) => !isDoneColumn(column));
  const visibleIds = new Set(columns.map((column) => column._id));
  const fallback = columns.find((column) => column.title.toLowerCase() === "todo") ?? columns[0];
  const newIssueColumn = columns.find(isDraftColumn) ?? fallback;
  const draftIds = new Set(columns.filter(isDraftColumn).map((column) => column._id));
  const laneOf = (task: CloudTask) => (visibleIds.has(task.columnId) ? task.columnId : fallback?._id);
  const needle = query.trim().toLowerCase();
  const matches = (task: CloudTask) => !needle || `${taskKey(task._id)} ${task.title} ${task.description ?? ""} ${task.assignedToName ?? ""}`.toLowerCase().includes(needle);
  const active = tasks.filter((task) => !task.done && matches(task));
  const completed = tasks.filter((task) => task.done && matches(task)).sort((a, b) => b.updatedAt - a.updatedAt);
  const assignees = new Map([...(board.assignees ?? []), ...(people ?? [])].map((person) => [person.email, person]));
  const lane = (columnId: string) => active.filter((task) => laneOf(task) === columnId);

  const report = (error: unknown) => setNotice(errorText(error, "Something went wrong"));
  const move = (taskId: string, columnId: string, beforeTaskId?: string) => {
    const order = orderForMove(tasks, taskId, columnId, beforeTaskId);
    setPending((current) => new Map(current).set(taskId, { columnId, order }));
    setMoves((count) => count + 1);
    const task = tasks.find((item) => item._id === taskId);
    const crossesDraft = Boolean(task && draftIds.has(task.columnId) !== draftIds.has(columnId));
    void cloudMutation("tasks:moveTask", { projectId, taskId, columnId, ...(beforeTaskId ? { beforeTaskId } : {}) })
      .then(() => { if (crossesDraft && task?.githubIssueNumber && project.repoUrl) void originGitHub.mirrorIssues(projectId, [taskId]).catch(() => undefined); })
      .catch(report)
      .finally(() => setPending((current) => { const next = new Map(current); next.delete(taskId); return next; }));
  };
  const setDone = (task: CloudTask, done: boolean) => {
    if (done && completesThroughPullRequest(project, task)) { setCompleting(task._id); return; }
    setMoves((count) => count + 1);
    void cloudMutation("tasks:updateTask", { projectId, taskId: task._id, done }).catch(report);
  };
  const remove = (task: CloudTask) => {
    const github = task.githubIssueUrl ? `\n\nIts GitHub issue #${task.githubIssueNumber} is deleted too, or closed as not planned if Origin's GitHub connection cannot delete it.` : "";
    if (!window.confirm(`Delete ${task.title}?${github}`)) return;
    if (selected === task._id) setSelected(null);
    setNotice("");
    setInfo("");
    void deleteIssue(projectId, task).then(setInfo, report);
  };
  const assign = onAssignToAgent ? (task: CloudTask, agentId?: string) => onAssignToAgent(toAssignable(task, project, board.columns), agentId) : undefined;
  placed.current = (taskId, drop) => {
    const task = tasks.find((item) => item._id === taskId);
    if (!task) return;
    const from = lane(laneOf(task) ?? "");
    const index = from.findIndex((item) => item._id === taskId);
    if (laneOf(task) === drop.columnId && drop.beforeTaskId === from[index + 1]?._id) setMoves((count) => count + 1);
    else move(taskId, drop.columnId, drop.beforeTaskId);
  };
  const keyMove = (event: KeyboardEvent<HTMLElement>, task: CloudTask) => {
    if (!canEdit || !event.altKey) return;
    const columnId = laneOf(task);
    if (!columnId) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const target = stepTarget(lane(columnId), task._id, event.key === "ArrowUp" ? -1 : 1);
      if (target) move(task._id, columnId, target.beforeTaskId);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const index = columns.findIndex((column) => column._id === columnId);
      const next = columns[index + (event.key === "ArrowLeft" ? -1 : 1)];
      if (next) move(task._id, next._id, lane(next._id)[0]?._id);
    } else return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-task-id="${task._id}"]`)?.focus());
  };
  const done = board.tasks.filter((task) => task.done).length;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden motion-safe:animate-[rise_0.24s_cubic-bezier(0.22,1,0.36,1)_backwards]" aria-label="Issues">
      <PageHeader title="Issues" count={board.tasks.length ? <ProgressRing done={done} total={board.tasks.length} /> : undefined}>
        <Segmented label="Issue state" value={view} onChange={setView}
          options={[{ value: "active", label: <><Circle size={13} />Active <span className="tabular-nums text-ink-tertiary">{active.length}</span></> }, { value: "completed", label: <><CheckCircle2 size={13} />Done <span className="tabular-nums text-ink-tertiary">{completed.length}</span></> }]} />
        {view === "active" && (
          <Segmented label="Layout" value={layout} onChange={setLayout}
            options={[{ value: "board", label: <Columns3 size={14} aria-label="Board view" />, title: "Board" }, { value: "list", label: <List size={14} aria-label="List view" />, title: "List" }]} />
        )}
        <label className="relative flex min-w-0 flex-1 items-center sm:flex-none">
          <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
          <input ref={search} className={cn(inputClass, "h-8 pl-8 sm:w-48")} placeholder="Search issues" aria-label="Search issues" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} />
        </label>
        {canEdit && <button type="button" className={primaryButton} disabled={!columns.length} onClick={() => setComposer(newIssueColumn?._id ?? "")} title="New issue (C)"><Plus size={14} />New issue</button>}
      </PageHeader>
      {(!canEdit || notice || info) && (
        <GlassHeader>
          <div className={cn("flex flex-col gap-2", glassHeaderRow)}>
            {!canEdit && <Notice>You have view-only access to this project.</Notice>}
            {notice && <Notice tone="danger">{notice}</Notice>}
            {info && <Notice>{info}</Notice>}
          </div>
        </GlassHeader>
      )}

      {view === "completed" ? (
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-6 md:px-6", underGlass)}>
          {!completed.length ? <EmptyState icon={<CheckCircle2 size={22} />} title="Nothing done yet" body={needle ? "No issues match your search." : "Completed issues land here, newest first."} /> : (
            <ul className={cn(cardClass, "divide-y divide-hairline/30 overflow-hidden")}>
              {completed.map((task) => (
                <li key={task._id} className="group flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors hover:bg-raised/30">
                  <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden="true" />
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => setSelected(task._id)}>
                    <span className="font-mono text-[11.5px] text-ink-tertiary">{taskKey(task._id)}</span>
                    <span className="truncate text-ink-secondary line-through decoration-ink-tertiary/60">{task.title}</span>
                  </button>
                  <time className="hidden text-[12px] text-ink-tertiary sm:block">{fmtDate(task.updatedAt)}</time>
                  {canEdit && <button type="button" className={ghostButton} onClick={() => setDone(task, false)}>Reopen</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : layout === "list" ? (
        <div className={cn("min-h-0 flex-1 overflow-auto px-4 pb-6 md:px-6", underGlass)}>
          {!active.length ? <EmptyState icon={<CircleDashed size={22} />} title={needle ? "No matching issues" : "No open issues"} body={needle ? "Try another search." : "Create an issue and hand it to one of the project's agents."} /> : (
            <div className={cn(cardClass, "overflow-hidden")}>
              {columns.map((column) => {
                const rows = lane(column._id);
                if (!rows.length) return null;
                return (
                  <div key={column._id}>
                    <div className={cn("flex items-center gap-2 px-4 py-2 text-[12.5px] font-medium text-ink-secondary", draftIds.has(column._id) ? "border-b border-dashed border-hairline/60" : "bg-raised/30")}>
                      <ColumnIcon column={column} size={12} />{column.title}<span className="tabular-nums text-ink-tertiary">{rows.length}</span>
                      {draftIds.has(column._id) && project.repoUrl && <NotOnGitHub />}
                    </div>
                    <ul className="divide-y divide-hairline/30">
                      {rows.map((task) => {
                        const person = task.assignedToEmail ? assignees.get(task.assignedToEmail) : undefined;
                        const due = dueInfo(task.dueDate);
                        return (
                          <li key={task._id} className="group flex items-center gap-3 px-4 py-2 text-[13px] transition-colors hover:bg-raised/30">
                            <PriorityIcon priority={task.priority} />
                            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => setSelected(task._id)}>
                              <span className="hidden font-mono text-[11.5px] text-ink-tertiary sm:inline">{taskKey(task._id)}</span>
                              <span className="truncate text-ink">{task.title}</span>
                            </button>
                            {due && <span className={cn("hidden text-[12px] sm:inline", due.tone)}>{due.label}</span>}
                            {person ? <span title={person.name}><PersonAvatar person={person} size={20} /></span> : <UserRound size={16} className="text-ink-tertiary" aria-label="Unassigned" />}
                            <TaskMenu task={task} columns={columns} canEdit={canEdit} agents={agents} onMove={(columnId) => move(task._id, columnId)} onDone={() => setDone(task, true)} onDelete={() => remove(task)} onAssign={assign} />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div ref={lanesRef} className={cn("flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto px-4 pb-4 md:px-6", underGlass)}>
          {columns.map((column) => {
            const items = lane(column._id);
            const here = target?.columnId === column._id ? target : null;
            const lifted = cardDrag.drag;
            const draft = draftIds.has(column._id);
            return (
              <div key={column._id} data-column-id={column._id} data-draft={draft || undefined}
                className={cn("flex w-[min(19rem,85vw)] shrink-0 snap-start flex-col rounded-2xl p-2 transition-[background-color,box-shadow] duration-200",
                  draft ? "border border-dashed border-hairline/70 bg-inset/20" : "bg-inset/50", lifted && (draft ? "bg-inset/40" : "bg-inset/70"), here && "bg-inset/90")}>
                <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                  <ColumnIcon column={column} size={12} strokeWidth={2.5} />
                  <strong className={cn("truncate text-[13px] font-semibold", draft ? "text-ink-secondary" : "text-ink")}>{column.title}</strong>
                  <span className="text-[12px] tabular-nums text-ink-tertiary">{items.length}</span>
                  {draft && project.repoUrl && <NotOnGitHub />}
                  <div className="ml-auto flex items-center">
                    {canEdit && <button type="button" className={iconButton} aria-label={`New issue in ${column.title}`} title="New issue" onClick={() => setComposer(column._id)}><Plus size={15} /></button>}
                    {canEdit && <button type="button" className={iconButton} aria-label={`Edit ${column.title} column`} title="Edit column" onClick={() => setColumnEditor(column)}><MoreHorizontal size={15} /></button>}
                  </div>
                </div>
                <ol data-lane-list className="flex min-h-[3rem] flex-1 flex-col gap-2 overflow-y-auto p-0.5" aria-label={`${column.title} issues`}>
                  {items.map((task) => lifted?.taskId === task._id ? null : (
                    <li key={task._id} className="flex flex-col gap-2">
                      {here?.beforeTaskId === task._id && lifted && <DropGap height={lifted.height} />}
                      {(
                        <TaskCard task={task} columns={columns} canEdit={canEdit} agents={agents} draft={draft}
                          assignee={task.assignedToEmail ? assignees.get(task.assignedToEmail) ?? { email: task.assignedToEmail, name: task.assignedToName ?? task.assignedToEmail } : undefined}
                          onOpen={() => { if (!cardDrag.justDropped()) setSelected(task._id); }}
                          onPointerDown={(event) => cardDrag.press(event, task._id)}
                          onKeyDown={(event) => keyMove(event, task)}
                          onMove={(columnId) => move(task._id, columnId)}
                          onDone={() => setDone(task, true)} onDelete={() => remove(task)} onAssign={assign} />
                      )}
                    </li>
                  ))}
                  {here && !here.beforeTaskId && lifted && <li><DropGap height={lifted.height} /></li>}
                  {!items.some((task) => task._id !== lifted?.taskId) && !here && (
                    <li className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-hairline/50 px-3 py-6 text-center text-[12.5px] text-ink-tertiary">
                      {needle ? "No matching issues" : canEdit ? "Drop issues here" : "No issues"}
                    </li>
                  )}
                </ol>
                {canEdit && (
                  <button type="button" onClick={() => setComposer(column._id)}
                    className="mt-1.5 flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-ink-tertiary outline-none transition-colors hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
                    <Plus size={14} />Add issue
                  </button>
                )}
              </div>
            );
          })}
          {canEdit && columns.length > 0 && (
            <button type="button" onClick={() => setColumnEditor("new")}
              className="flex h-12 w-56 shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-hairline/60 text-[13px] text-ink-secondary outline-none transition-colors hover:bg-raised/40 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
              <Plus size={14} />Add column
            </button>
          )}
          {!columns.length && (canEdit && !board.columns.length && !notice
            ? <Loading label="Preparing columns" variant="board" />
            : <EmptyState compact icon={<CircleDashed size={22} />} title="No open columns" body={canEdit ? "Add a column to start tracking issues." : "An editor has not set up this board yet."} />)}
          {cardDrag.drag && <DragGhost drag={cardDrag.drag} ghost={cardDrag.ghost} task={tasks.find((item) => item._id === cardDrag.drag!.taskId)} columns={columns}
            assignee={(task) => task.assignedToEmail ? assignees.get(task.assignedToEmail) ?? { email: task.assignedToEmail, name: task.assignedToName ?? task.assignedToEmail } : undefined} />}
        </div>
      )}

      {composer !== null && (
        <NewIssueComposer projects={[{ id: project._id, name: project.name, memberRole: project.memberRole }]} initialProjectId={projectId} initialColumnId={composer || undefined}
          agentsFor={onAssignToAgent ? () => agents : undefined} onClose={() => setComposer(null)}
          onCreated={(_projectId, taskId, issue) => {
            setComposer(null);
            if (issue.agentId && onAssignToAgent) onAssignToAgent(createdToAssignable(issue, project.name), issue.agentId);
            else setSelected(taskId);
          }} />
      )}
      {columnEditor && <ColumnEditor projectId={projectId} column={columnEditor === "new" ? null : columnEditor} columns={columns} onClose={() => setColumnEditor(null)} />}
      {completing && (() => {
        const task = board.tasks.find((item) => item._id === completing);
        return task ? <CompleteIssueDialog project={project} projectId={projectId} task={task} implementer={handOver(chief, project, projectId, board.columns, task)} onClose={() => setCompleting(null)} /> : null;
      })()}
      {selected && <IssueDetail key={selected} project={project} projectId={projectId} taskId={selected} canEdit={canEdit} agents={agents} chief={chief} onClose={() => setSelected(null)}
        onDelete={(task) => remove(task)} onAssign={assign} />}
    </section>
  );
}

function DropGap({ height }: { height: number }) {
  return <span aria-hidden="true" data-drop-gap className="block rounded-xl border-2 border-dashed border-accent/45 bg-accent/[0.06] motion-safe:animate-[pop-in_0.18s_cubic-bezier(0.22,1,0.36,1)]" style={{ height }} />;
}

type Assignee = { email: string; name: string; username?: string; avatarUrl?: string | null };

function DragGhost({ drag, ghost, task, columns, assignee }: {
  drag: CardDrag; ghost: RefObject<HTMLDivElement | null>; task?: CloudTask; columns: CloudColumn[]; assignee(task: CloudTask): Assignee | undefined;
}) {
  if (!task) return null;
  return (
    <div ref={ghost} aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[60]"
      style={{ width: drag.width, transform: `translate3d(${drag.x}px, ${drag.y}px, 0)` }}>
      <div className="rotate-[1.5deg] scale-[1.03] rounded-xl motion-safe:animate-[pop-in_0.16s_ease-out]">
        <TaskCard task={task} columns={columns} canEdit={false} agents={[]} lifted draft={columns.some((column) => column._id === task.columnId && isDraftColumn(column))} assignee={assignee(task)} />
      </div>
    </div>
  );
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="flex items-center gap-1.5" title={`${done} of ${total} issues done`}>
      <svg viewBox="0 0 36 36" className="size-4 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r="15" fill="none" strokeWidth="5" className="stroke-raised" />
        <circle cx="18" cy="18" r="15" fill="none" strokeWidth="5" pathLength={100} strokeLinecap="round" className="stroke-success transition-[stroke-dasharray] duration-500" style={{ strokeDasharray: `${percent} 100` }} />
      </svg>
      {done} of {total} done
    </span>
  );
}

export function TaskCard({ task, columns, canEdit, assignee, agents, lifted = false, draft = false, onOpen, onPointerDown, onKeyDown, onMove, onDone, onDelete, onAssign }: {
  task: CloudTask; columns: CloudColumn[]; canEdit: boolean; assignee?: Assignee; agents: readonly IssueAgent[];
  /** The copy that follows the pointer while the card is dragged. */
  lifted?: boolean;
  /** In the draft column, whose issues have no GitHub issue. */
  draft?: boolean;
  onOpen?(): void; onPointerDown?(event: PointerEvent<HTMLElement>): void; onKeyDown?(event: KeyboardEvent<HTMLElement>): void;
  onMove?(columnId: string): void; onDone?(): void; onDelete?(): void; onAssign?(task: CloudTask, agentId?: string): void;
}) {
  const due = dueInfo(task.dueDate);
  return (
    <article tabIndex={lifted ? -1 : 0} data-task-id={lifted ? undefined : task._id} data-flip-id={lifted ? undefined : task._id}
      aria-label={`${taskKey(task._id)} ${task.title}`}
      aria-keyshortcuts={canEdit ? "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight" : undefined}
      onPointerDown={onPointerDown}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen?.(); return; }
        onKeyDown?.(event);
      }}
      className={cn("group relative cursor-pointer rounded-xl border border-hairline/40 bg-panel p-3 outline-none transition-[border-color,background-color,box-shadow,opacity,transform] duration-150 hover:border-hairline hover:bg-raised/40 focus-visible:ring-2 focus-visible:ring-accent/60",
        canEdit && "cursor-grab select-none active:cursor-grabbing", lifted && "cursor-grabbing border-hairline")}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-tertiary">
        {canEdit && <GripVertical size={12} className="-ml-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100" aria-hidden="true" />}
        <span className="font-mono">{taskKey(task._id)}</span>
        {!draft && <GitHubBadge task={task} />}
        <div className="ml-auto flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 max-md:opacity-100" onClick={(event) => event.stopPropagation()}>
          {onAssign && agents.length > 0 && (
            <button type="button" className={cn(iconButton, "size-7")} aria-label={`Hand ${task.title} to an agent`} title="Hand to agent" onClick={() => onAssign(task)}><BotIcon size={14} /></button>
          )}
          {onMove && onDone && onDelete && <TaskMenu task={task} columns={columns} canEdit={canEdit} agents={agents} onMove={onMove} onDone={onDone} onDelete={onDelete} onAssign={onAssign} />}
        </div>
      </div>
      <div className="flex items-start gap-2">
        <button type="button" aria-label={`Complete ${task.title}`} disabled={!canEdit} title="Mark complete"
          className="group/check mt-px shrink-0 rounded-full text-ink-tertiary outline-none transition-colors hover:text-success focus-visible:ring-2 focus-visible:ring-accent/60 disabled:hover:text-ink-tertiary"
          onClick={(event) => { event.stopPropagation(); onDone?.(); }}>
          <Circle size={16} className="group-hover/check:hidden" /><CheckCircle2 size={16} className="hidden group-hover/check:block" />
        </button>
        <strong className="text-[13.5px] font-medium leading-snug text-ink [overflow-wrap:anywhere]">{task.title}</strong>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11.5px]">
        <span className="flex items-center gap-1 text-ink-secondary" title={`${capitalize(task.priority)} priority`}><PriorityIcon priority={task.priority} size={13} />{capitalize(task.priority)}</span>
        {due && <span className={cn("flex items-center gap-1", due.tone)} title={`Due ${task.dueDate}`}><CalendarDays size={12} aria-hidden="true" />{due.label}</span>}
        {assignee && <span className="ml-auto" title={assignee.name}><PersonAvatar person={assignee} size={20} /></span>}
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

function NotOnGitHub() {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-hairline/70 px-1.5 py-px text-[11px] font-normal text-ink-tertiary"
      title="Issues in Draft stay in Origin. Moving one to another column creates its GitHub issue.">
      <GitBranch size={11} aria-hidden="true" />Not on GitHub
    </span>
  );
}

function TaskMenu({ task, columns, canEdit, agents, onMove, onDone, onDelete, onAssign }: {
  task: CloudTask; columns: CloudColumn[]; canEdit: boolean; agents: readonly IssueAgent[]; onMove(columnId: string): void; onDone(): void; onDelete(): void; onAssign?(task: CloudTask, agentId?: string): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  if (!canEdit && !onAssign) return null;
  const item = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-ink-secondary outline-none hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink";
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div ref={root} className="relative">
      <button type="button" className={cn(iconButton, "size-7")} aria-label={`Actions for ${task.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={14} /></button>
      {open && (
        <div ref={menu} role="menu" className="absolute right-0 top-8 z-30 w-56 rounded-xl border border-hairline/60 bg-menu p-1 motion-safe:animate-pop-in"
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
            const index = items.indexOf(document.activeElement as HTMLElement);
            items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}>
          {onAssign && agents.length > 0 && <>
            <div className="px-2 pb-0.5 pt-1.5 text-[11px] text-ink-tertiary">Hand to agent</div>
            {agents.slice(0, 6).map((agent) => (
              <button key={agent.id} type="button" role="menuitem" className={item} onClick={pick(() => onAssign(task, agent.id))}>{agent.avatar}<span className="truncate">{agent.name}</span></button>
            ))}
          </>}
          {onAssign && !agents.length && <button type="button" role="menuitem" className={item} onClick={pick(() => onAssign(task))}><BotIcon size={14} />Hand to agent</button>}
          {canEdit && <>
            <div className="px-2 pb-0.5 pt-1.5 text-[11px] text-ink-tertiary">Move to</div>
            {columns.filter((column) => column._id !== task.columnId).map((column) => (
              <button key={column._id} type="button" role="menuitem" className={item} onClick={pick(() => onMove(column._id))}><ColumnIcon column={column} size={13} />{column.title}</button>
            ))}
            <div className="my-1 h-px bg-hairline/40" />
            <button type="button" role="menuitem" className={item} onClick={pick(onDone)}><CheckCircle2 size={14} />Mark complete</button>
            <button type="button" role="menuitem" className={cn(item, "text-danger hover:text-danger focus-visible:text-danger")} onClick={pick(onDelete)}><Trash2 size={14} />Delete</button>
          </>}
        </div>
      )}
    </div>
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
              <Select className="w-full" value={destination} onChange={(e) => setDestination(e.target.value)}>
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

function IssueDetail({ project, projectId, taskId, canEdit, agents, chief, onClose, onDelete, onAssign }: {
  project: CloudProject; projectId: string; taskId: string; canEdit: boolean; agents: readonly IssueAgent[]; chief?: IssueChief; onClose(): void; onDelete(task: CloudTask): void; onAssign?(task: CloudTask, agentId?: string): void;
}) {
  const details = useCloudQuery<CloudTaskDetails>("tasks:details", { projectId, taskId });
  const [draft, setDraft] = useState<{ title: string; description: string } | null>(null);
  const action = useAction();
  const [completing, setCompleting] = useState(false);
  const task = details?.task;

  useEffect(() => {
    if (!task || draft) return;
    setDraft({ title: task.title, description: task.description ?? "" });
  }, [task, draft]);

  const heading = (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-hairline/50 bg-raised/50 px-2.5 py-1 text-ink-secondary">
        <ProjectDot name={project.name} /><span className="max-w-[220px] truncate">{project.name}</span>
      </span>
      <ChevronRight size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
      <h2 className="whitespace-nowrap font-mono font-medium text-ink">{taskKey(taskId)}</h2>
      {task?.done && <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11.5px] text-success"><CheckCircle2 size={12} />Done</span>}
    </div>
  );
  if (!details || !task || !draft) return <IssueDialog label="Issue" heading={heading} onClose={onClose}><div className="px-6 pb-6"><Loading label="Opening issue" variant="inline" /></div></IssueDialog>;

  const columns = details.columns.filter((column) => !isDoneColumn(column));
  const inDraft = (columnId: string) => details.columns.some((column) => column._id === columnId && isDraftColumn(column));
  const dirty = draft.title !== task.title || draft.description !== (task.description ?? "");
  const update = (patch: Record<string, unknown>, fallback: string) => void action.run(() => cloudMutation("tasks:updateTask", { projectId, taskId, ...patch }), fallback);
  const save = () => {
    if (!dirty || !draft.title.trim() || action.busy) return;
    void action.run(() => cloudMutation("tasks:updateTask", {
      projectId, taskId,
      ...(draft.title !== task.title ? { title: draft.title } : {}),
      ...(draft.description !== (task.description ?? "") ? { description: draft.description } : {}),
    }), "Could not save issue");
  };
  const toggleDone = () => (!task.done && completesThroughPullRequest(project, task) ? setCompleting(true) : update({ done: !task.done }, "Could not update issue"));

  return (
    <IssueDialog label={`${taskKey(task._id)} ${task.title}`} heading={heading} onClose={onClose}
      canClose={() => !(dirty && canEdit) || window.confirm("Discard unsaved changes?")}>
      <div className="flex flex-col px-6 pb-5 pt-2 max-sm:px-5"
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); } }}>
        <textarea rows={1} aria-label="Issue title" placeholder="Issue title" value={draft.title} maxLength={250} disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, " ") })}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) event.preventDefault(); }}
          className={issueTitleClass} />
        <textarea aria-label="Issue description" placeholder={canEdit ? "Add a description…" : "No description"} value={draft.description} disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className={issueDescriptionClass} />
        <IssueChips>
          <ChipSelect label="Status" value={columns.some((c) => c._id === task.columnId) ? task.columnId : ""} options={statusOptions(columns)} icon={<CircleDashed size={14} aria-hidden="true" />}
            disabled={!canEdit || task.done} placeholder={task.done ? "Done" : undefined}
            onChange={(columnId) => void action.run(async () => {
              await cloudMutation("tasks:moveTask", { projectId, taskId, columnId });
              if (task.githubIssueNumber && project.repoUrl && inDraft(task.columnId) !== inDraft(columnId)) void originGitHub.mirrorIssues(projectId, [taskId]).catch(() => undefined);
            }, "Could not move issue")} />
          <ChipSelect label="Priority" value={task.priority} options={priorityOptions()} icon={<SignalMedium size={14} aria-hidden="true" />} disabled={!canEdit}
            onChange={(priority) => update({ priority }, "Could not change the priority")} />
          <ChipSelect label="Assignee" value={task.assignedToEmail ?? ""} options={memberOptions(details.members)} icon={<UserRound size={14} aria-hidden="true" />} disabled={!canEdit}
            onChange={(assignedToEmail) => update({ assignedToEmail }, "Could not change the assignee")} />
          <DateChip value={task.dueDate ?? ""} disabled={!canEdit} onChange={(dueDate) => { if (dueDate) update({ dueDate }, "Could not change the due date"); }} />
          {onAssign && !task.done && <AgentChip agents={agents} onPick={(agentId) => onAssign(task, agentId)} />}
          <GitHubChips project={project} projectId={projectId} task={task} canEdit={canEdit} draft={inDraft(task.columnId)} />
        </IssueChips>
        {action.error && <div className="mt-3"><Notice tone="danger">{action.error}</Notice></div>}
        {completing && <CompleteIssueDialog project={project} projectId={projectId} task={task} implementer={handOver(chief, project, projectId, details.columns, task)} onClose={() => setCompleting(false)} />}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-hairline/40 pt-4">
          <span className="text-[12px] text-ink-tertiary">
            {canEdit && dirty ? "Ctrl+Enter to save" : `Created ${fmtDate(task.createdAt)} · Updated ${fmtDate(task.updatedAt)}`}
          </span>
          {canEdit && (
            <div className="ml-auto flex items-center gap-2">
              {dirty ? <>
                <button type="button" className={cn(ghostButton, "rounded-full")} onClick={() => setDraft(null)}>Discard</button>
                <button type="button" className={cn(primaryButton, "rounded-full px-4")} disabled={action.busy || !draft.title.trim()} onClick={save}>
                  {action.busy ? <Loader2 size={14} className="animate-spin" /> : null}Save changes
                </button>
              </> : <>
                <button type="button" className={cn(iconButton, "hover:text-danger")} aria-label="Delete issue" title="Delete issue" onClick={() => onDelete(task)}><Trash2 size={15} /></button>
                <button type="button" className={cn(ghostButton, "rounded-full px-4")} onClick={toggleDone}>
                  {task.done ? <Circle size={14} /> : <CheckCircle2 size={14} />}{task.done ? "Reopen issue" : "Mark complete"}
                </button>
              </>}
            </div>
          )}
        </div>
      </div>
      <Comments projectId={projectId} taskId={taskId} details={details} canEdit={canEdit} />
    </IssueDialog>
  );
}

function GitHubChips({ project, projectId, task, canEdit, draft }: { project: CloudProject; projectId: string; task: CloudTask; canEdit: boolean; draft: boolean }) {
  const prs = useCloudQuery<CloudTaskPullRequest[]>("taskPRs:list", { taskId: task._id });
  const [message, setMessage] = useState("");
  const action = useAction();
  const mode = task.githubTaskMode ?? project.githubTaskMode ?? "issue";
  if (!project.repoUrl && !task.githubIssueUrl && !prs?.length) return null;
  const create = () => action.run(async () => {
    const [result] = (await originGitHub.mirrorIssues(projectId, [task._id])).results;
    if (result?.error) throw new Error(result.error);
    setMessage(result?.issueNumber ? `Created GitHub issue #${result.issueNumber}` : "");
  }, "GitHub issue creation failed");
  return <>
    {task.githubIssueUrl ? (
      <a className={chipButton} href={task.githubIssueUrl} target="_blank" rel="noreferrer" title={`${githubRepoLabel(project.repoUrl)} issue #${task.githubIssueNumber}`}>
        <GitBranch size={14} aria-hidden="true" className="shrink-0" />#{task.githubIssueNumber}
        <span className={task.githubIssueState === "closed" ? "text-ink-tertiary" : "text-success"}>{task.githubIssueState ?? "open"}</span>
        <ExternalLink size={12} aria-hidden="true" className="shrink-0 opacity-60" />
      </a>
    ) : project.repoUrl && mode === "issue" && canEdit && !draft ? (
      <button type="button" className={chipButton} disabled={action.busy} onClick={() => void create()} title={githubRepoLabel(project.repoUrl)}>
        {action.busy ? <Loader2 size={14} className="animate-spin" /> : <GitBranch size={14} aria-hidden="true" />}Create GitHub issue
      </button>
    ) : null}
    {prs?.map((pr) => (
      <a key={pr._id} className={chipButton} href={pr.url} target="_blank" rel="noreferrer"
        title={`Checks: ${pr.checks} · Review: ${pr.review} · Mergeable: ${pr.mergeable == null ? "unknown" : pr.mergeable ? "yes" : "no"}`}>
        <GitPullRequest size={14} aria-hidden="true" className="shrink-0" />PR #{pr.number}<span className="capitalize text-ink-tertiary">{pr.state}</span>
      </a>
    ))}
    {message && <span className="text-[12px] text-ink-secondary" role="status">{message}</span>}
    {action.error && <span className="text-[12px] text-danger" role="alert">{action.error}</span>}
  </>;
}

function Comments({ projectId, taskId, details, canEdit }: { projectId: string; taskId: string; details: CloudTaskDetails; canEdit: boolean }) {
  const [body, setBody] = useState("");
  const action = useAction();
  const entries = [
    ...details.comments.map((comment) => ({ id: comment._id, at: comment.createdAt, author: comment.authorName, email: comment.authorEmail, body: comment.body as ReactNode })),
    ...details.assets.filter((asset) => !asset.commentId).map((asset) => ({
      id: asset._id, at: asset.createdAt, author: "Attachment", email: "",
      body: <a href={asset.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">{asset.name}<ExternalLink size={11} /></a> as ReactNode,
    })),
  ].sort((a, b) => a.at - b.at);
  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!body.trim()) return;
    if (await action.run(() => cloudMutation("tasks:addComment", { projectId, taskId, body }), "Could not send comment")) setBody("");
  };
  return (
    <section className="border-t border-hairline/40 px-6 pb-6 pt-4 max-sm:px-5" aria-label="Activity">
      <h4 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink"><MessageCircle size={14} />Activity <span className="font-normal tabular-nums text-ink-tertiary">{entries.length}</span></h4>
      <ol className="flex flex-col gap-3">
        {!entries.length && <li className="text-[12.5px] text-ink-tertiary">No comments yet. Agents post their progress here too.</li>}
        {entries.map((entry) => (
          <li key={entry.id} className="flex gap-2.5 motion-safe:animate-msg-in">
            <PersonAvatar person={{ name: entry.author, email: entry.email || entry.author }} size={24} />
            <div className="min-w-0 flex-1 rounded-xl border border-hairline/40 px-3 py-2">
              <header className="mb-0.5 flex items-center gap-2 text-[12px]">
                <strong className="font-medium text-ink">{entry.author}</strong>
                <time className="text-ink-tertiary" dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
              </header>
              <div className="whitespace-pre-wrap break-words text-[13px] text-ink-secondary">{entry.body}</div>
            </div>
          </li>
        ))}
      </ol>
      {canEdit && (
        <form onSubmit={submit} className="mt-3 rounded-xl border border-hairline/60 transition-colors focus-within:border-accent/60">
          <textarea className="block min-h-[72px] w-full resize-none bg-transparent px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" placeholder="Leave a comment…" aria-label="Comment" value={body} maxLength={8000} disabled={action.busy}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event); }} />
          <div className="flex items-center gap-2 px-2 pb-2">
            {action.error ? <span className="text-[12px] text-danger" role="alert">{action.error}</span> : <span className="text-[11.5px] text-ink-tertiary">Ctrl+Enter to send</span>}
            <button className={cn(primaryButton, "ml-auto h-7 min-h-7 rounded-full px-3")} disabled={action.busy || !body.trim()}>{action.busy ? <Loader2 size={13} className="animate-spin" /> : null}Comment</button>
          </div>
        </form>
      )}
    </section>
  );
}
