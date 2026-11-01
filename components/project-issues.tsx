"use client";
import { errorText } from "@/lib/error-text";
import { isDraftColumn } from "@/lib/origin-columns";
import { ErrorBoundary } from "./error-boundary";


import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import clsx from "clsx";
import { ArrowLeft, CalendarDays, Check, CheckCircle2, Circle, Columns2, Columns3, ExternalLink, LinkIcon, GripVertical, List, Loader2, MoreHorizontal, Paperclip, Plus, Search, Trash2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { localApi } from "@/lib/client-api";
import { hasOpenKeyboardOverlay, isEditingTarget } from "@/lib/keyboard-navigation";
import { issueShortcut, matchesIssue, taskKey } from "../lib/project-issues";
import { TaskActionsMenu } from "./task-actions-menu";
import { IssueLabels, IssueRelations } from "./issue-relations";
import { ProjectIcon } from "./project-icon";
import { useMemberProfile, useWorkspace } from "./workspace-context";
import { GitHubIssueIndicator } from "./github-issue-indicator";
import { LocalAttachment } from "./local-attachment";
import { TaskPullRequest } from "./task-pull-request";
import { MemberPicker } from "./member-picker";
import { Dialog } from "./dialog";
import { IssueFields } from "./issue-fields";
import { PriorityIcon, StatusIcon, laneTone } from "./issue-icons";
import { IssueCommentBody, IssueCommentComposer } from "./issue-comments";
import { IssueFileUpload } from "./issue-file-upload";
import { useBoardScroll } from "./use-board-scroll";
import { useCardFlip, useIssueDrag, type DragSlot } from "./use-issue-drag";
import { compareTaskOrder, planTaskMove } from "../lib/task-order";
import { UserAvatar } from "./user-avatar";
import { ContentSkeleton } from "./content-skeleton";
import { RECONNECT_TO_CREATE, useWorkspaceOnline } from "./workspace-connection";


type ProjectWithUi = Doc<"projects"> & { memberRole: string; iconUrl?: string | null };
type Priority = "low" | "medium" | "high";
type AvatarUser = { username?: string; name: string; email: string; avatarUrl?: string | null };
type OpenReference = (projectId: Id<"projects">, taskId?: Id<"tasks">) => void;

function dueInfo(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const due = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  const label = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { label, tone: days < 0 ? "overdue" : days <= 1 ? "soon" : "later" };
}

type MoveTaskArgs = { projectId: Id<"projects">; sessionToken: string; taskId: Id<"tasks">; columnId: Id<"columns">; beforeTaskId?: Id<"tasks"> };

/** Mirrors `tasks.moveTask` on the cached board so a dropped card stays exactly where it was dropped. */
function moveTaskOnBoard(store: OptimisticLocalStore, args: MoveTaskArgs) {
  const query = { projectId: args.projectId, sessionToken: args.sessionToken };
  const board = store.getQuery(api.tasks.board, query);
  if (!board?.tasks.some(task => task._id === args.taskId)) return;
  const plan = planTaskMove(board.tasks.filter(task => task.columnId === args.columnId), args.taskId, args.beforeTaskId);
  if (plan.noop) return;
  const renumbered = new Map(plan.renumber.map(item => [item._id, item.order]));
  const tasks = board.tasks.map(task => task._id === args.taskId ? { ...task, columnId: args.columnId, order: plan.order, updatedAt: Date.now() }
    : renumbered.has(task._id) ? { ...task, order: renumbered.get(task._id)! } : task).sort(compareTaskOrder);
  store.setQuery(api.tasks.board, query, { ...board, tasks });
}

/** Active cards of a board lane in display order; cards whose column is hidden show in Todo (or the first lane). */
function activeLaneTasks(board: { columns: Doc<"columns">[]; tasks: Doc<"tasks">[] }, columnId: string, matches: (task: Doc<"tasks">) => boolean) {
  const columns = board.columns.filter(column => !(column.isDone ?? column.title.toLowerCase() === "done"));
  const ids = new Set<string>(columns.map(column => column._id));
  const fallback = columns.find(column => column.title.toLowerCase() === "todo") || columns[0];
  return board.tasks.filter(task => !task.done && matches(task) && (ids.has(task.columnId) ? task.columnId : fallback?._id) === columnId);
}

function sidebarUsername(user: Pick<AvatarUser, "username" | "name" | "email">) {
  return user.username || user.email.split("@")[0] || user.name;
}
function relativeTime(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(timestamp);
}
function fmtDate(timestamp?: number) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}
function parseGitHubRepo(repoUrl?: string) {
  if (!repoUrl) return null;
  const value = repoUrl.trim();
  const shorthand = value.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/i, "") };
  const match = value.match(/github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#]|$)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}
function githubRepoLabel(repoUrl?: string) {
  const parsed = parseGitHubRepo(repoUrl);
  return parsed ? `${parsed.owner}/${parsed.repo}` : "No repository";
}
function githubRepoHref(repoUrl?: string) {
  const parsed = parseGitHubRepo(repoUrl);
  return parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : null;
}
function githubNewIssueHref(repoUrl: string | undefined, title = "", body = "") {
  const repoHref = githubRepoHref(repoUrl);
  if (!repoHref) return null;
  const params = new URLSearchParams();
  if (title.trim()) params.set("title", title.trim());
  if (body.trim()) params.set("body", body.trim());
  const query = params.toString();
  return `${repoHref}/issues/new${query ? `?${query}` : ""}`;
}

function LoadingState({ label = "Loading" }: { label?: string }) {
  return <ContentSkeleton label={label} kind={label.includes("board") || label.includes("project") ? "board" : "list"} rows={4} />;
}
function EmptyBlock({ icon: Icon, title, body }: { icon: typeof Circle; title: string; body?: string }) {
  return (
    <div className="empty-block">
      <Icon size={20} />
      <h3>{title}</h3>
      {body && <p>{body}</p>}
    </div>
  );
}

export function BoardTab({ project, projectId, sessionToken, canEdit, userEmail, onCreateIssue, initialTaskId, onOpenReference }: { project: ProjectWithUi; projectId: Id<"projects">; sessionToken: string; canEdit: boolean; userEmail: string; onCreateIssue: () => void; initialTaskId?: Id<"tasks">; onOpenReference?: OpenReference }) {
  const online = useWorkspaceOnline();
  const openMember = useMemberProfile();
  const board = useQuery(api.tasks.board, { projectId, sessionToken });
  const projectMembers = useQuery(api.members.people, { projectId, sessionToken });
  const updateTask = useMutation(api.tasks.updateTask);
  const moveTask = useMutation(api.tasks.moveTask).withOptimisticUpdate(moveTaskOnBoard);
  const deleteTask = useMutation(api.tasks.deleteTask);
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(initialTaskId ?? null);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("project", projectId);
    if (selectedTaskId) url.searchParams.set("issue", selectedTaskId);
    else url.searchParams.delete("issue");
    window.history.replaceState(null, "", url);
  }, [projectId, selectedTaskId]);
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [boardNotice, setBoardNotice] = useState("");
  const [archive, setArchive] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [completedColumnId, setCompletedColumnId] = useState<Id<"columns"> | null>(null);
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const [columnEditor, setColumnEditor] = useState<Doc<"columns"> | "new" | null>(null);
  const boardScroll = useBoardScroll(Boolean(board) && !archive && layout === "board");
  const dnd = useIssueDrag({
    rootRef: boardScroll,
    enabled: canEdit,
    onMove: (taskId, target) => {
      if (!board?.tasks.some(task => task._id === taskId)) return;
      const before = activeLaneTasks(board, target.columnId, task => matchesIssue(task, filter, assigneeFilter)).filter(task => task._id !== taskId)[target.index];
      void moveTask({ projectId, sessionToken, taskId: taskId as Id<"tasks">, columnId: target.columnId as Id<"columns">, beforeTaskId: before?._id }).catch(error => setBoardNotice(errorText(error, "Could not move issue")));
    },
  });
  useCardFlip(boardScroll);
  const drag = dnd.drag;

  useEffect(() => {
    setBoardNotice("");
    setAssigneeFilter("");
  }, [projectId]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const action = issueShortcut(event, { canEdit, editing: isEditingTarget(event.target), overlayOpen: hasOpenKeyboardOverlay() });
      if (!action) return;
      event.preventDefault();
      if (action === "create") { if (online) onCreateIssue(); }
      else if (action === "search") setFilterOpen(true);
      else setLayout(action);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [canEdit, online, onCreateIssue]);

  if (!board) return <LoadingState label="Loading board" />;
  const assignees = new Map(board.assignees?.map(member => [member.email, member]));
  const visualColumns = board.columns.filter(column => !(column.isDone ?? column.title.toLowerCase() === "done")).map(column => ({ ...column, displayTitle: column.title }));
  const matches = (task: Doc<"tasks">) => matchesIssue(task, filter, assigneeFilter);
  const visibleColumnIds = new Set(visualColumns.map((column) => column._id));
  const fallbackColumn = visualColumns.find(column => column.title.toLowerCase() === "todo") || visualColumns[0];
  const columnForTask = (task: Doc<"tasks">) => visibleColumnIds.has(task.columnId) ? task.columnId : fallbackColumn?._id;
  const archivedTasks = board.tasks.filter(task => task.done && matches(task) && (!completedColumnId || columnForTask(task) === completedColumnId)).sort((a, b) => b.updatedAt - a.updatedAt);
  const showCompleted = (columnId: Id<"columns"> | null) => { setCompletedColumnId(columnId); setArchive(true); };
  const visibleTasks = (columnId: string) => activeLaneTasks(board, columnId, matches);
  /** Column cards with the dragged card shown in its target slot. */
  const displayTasks = (columnId: string, slot: DragSlot | null) => {
    const tasks = visibleTasks(columnId);
    if (!drag || !slot) return tasks;
    const moving = board.tasks.find(task => task._id === drag.taskId);
    const others = tasks.filter(task => task._id !== drag.taskId);
    if (moving && slot.columnId === columnId) others.splice(Math.min(slot.index, others.length), 0, moving);
    return others;
  };
  return (
    <section className="board-section" ref={boardScroll}>
      <div className="board-header">
        <div className="segmented-control"><span className="segment-glider" aria-hidden="true" /><button className={!archive ? "active" : ""} onClick={() => setArchive(false)}>Active<span>{board.tasks.filter(t => !t.done && matches(t)).length}</span></button><button className={archive ? "active" : ""} onClick={() => showCompleted(null)}>Completed<span>{board.tasks.filter(t => t.done && matches(t)).length}</span></button></div>
        <div className="board-header-actions">
          <div className="board-filter-control">
            <button ref={filterButton} className={`icon-button ${filter ? "selected" : ""}`} aria-label="Search issues" title="Search (/)" aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}><Search size={15} /></button>
            {filterOpen && <div className="board-filter-popover"><Search size={14} /><input autoFocus value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search issues" aria-label="Search project issues" onKeyDown={event => { if (event.key === "Escape") { setFilterOpen(false); filterButton.current?.focus(); } }} /><button className="icon-button" aria-label="Close issue filter" onClick={() => { setFilterOpen(false); filterButton.current?.focus(); }}><X size={14} /></button></div>}
          </div>
          <MemberPicker label="Issue assignee filter" members={[...new Map([...(board.assignees || []), ...(projectMembers || [])].map(member => [member.email, member])).values()]} value={assigneeFilter} onChange={setAssigneeFilter} allLabel="All issues" currentEmail={userEmail} />
          <div className="segmented-control issue-layout-switch" role="group" aria-label="Issue layout"><button aria-label="Board view" aria-pressed={layout === "board"} className={layout === "board" ? "active" : ""} onClick={() => setLayout("board")} title="Board (B)"><Columns3 size={14} /></button><button aria-label="List view" aria-pressed={layout === "list"} className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")} title="List (L)"><List size={14} /></button></div>
          {canEdit && <button disabled={!online} title={!online ? RECONNECT_TO_CREATE : "Add column"} className="icon-button board-column-button" aria-label="Add column" onClick={() => setColumnEditor("new")}><Columns2 size={15} /></button>}
          {canEdit && <button disabled={!online} title={!online ? RECONNECT_TO_CREATE : "Create issue (C)"} className="primary-button compact project-create-issue" onClick={onCreateIssue}><Plus size={14} /><span>Create issue</span></button>}
        </div>
      </div>
      {!canEdit ? <div className="notice">View only</div> : null}
      {boardNotice ? <div className="notice danger">{boardNotice}</div> : null}
      {archive ? <div className="archive-list">{completedColumnId && <div className="completed-scope"><span>{visualColumns.find(c => c._id === completedColumnId)?.title}</span><button className="ghost-button compact" onClick={() => showCompleted(null)}>All completed<X size={13} /></button></div>}{!archivedTasks.length && <EmptyBlock icon={CheckCircle2} title={filter ? "No matching issues" : "No completed issues"} />}{archivedTasks.map(task => <div key={task._id} className="archive-row"><CheckCircle2 size={16} /><button className="archive-issue" onClick={() => setSelectedTaskId(task._id)}><span>{taskKey(task._id)}</span><strong>{task.title}</strong></button><time>{fmtDate(task.updatedAt)}</time>{canEdit && <button className="ghost-button compact" onClick={async () => { const target = columnForTask(task); if (!target) { setBoardNotice("Add a workflow column before restoring an issue"); return; } try { if (!visibleColumnIds.has(task.columnId)) await moveTask({ projectId, sessionToken, taskId: task._id, columnId: target }); await updateTask({ projectId, sessionToken, taskId: task._id, done: false }); } catch (error) { setBoardNotice(errorText(error, "Could not restore issue")); } }}><ArrowLeft size={13} />Restore</button>}</div>)}</div> : layout === "list" ? <div className="issue-table-scroll"><table className="issue-table"><caption className="sr-only">Active project issues</caption><thead><tr><th scope="col">Issue</th><th scope="col" className="col-status">Status</th><th scope="col" className="col-priority">Priority</th><th scope="col" className="col-assignee">Assignee</th><th scope="col" className="col-due">Due</th></tr></thead><tbody>{board.tasks.filter(task => !task.done && matches(task)).map(task => <tr key={task._id} data-task-id={task._id}><td><button className="check-button" aria-label={`Complete ${task.title}`} disabled={!canEdit} onClick={() => void updateTask({ projectId, sessionToken, taskId: task._id, done: true }).catch(error => setBoardNotice(errorText(error, "Could not update issue")))}><Circle size={15} /></button><button className="issue-table-title" onClick={() => setSelectedTaskId(task._id)}><small>{taskKey(task._id)}</small><span>{task.title}</span></button></td><td className="col-status">{(() => { const title = visualColumns.find(column => column._id === columnForTask(task))?.title || ""; return <span className="issue-table-status"><StatusIcon title={title} />{title}</span>; })()}</td><td className="col-priority"><span className={clsx("priority", task.priority)}><PriorityIcon priority={task.priority} />{task.priority}</span></td><td className="col-assignee">{task.assignedToEmail ? <span className="issue-table-assignee"><UserAvatar user={assignees.get(task.assignedToEmail) || { name: task.assignedToName || task.assignedToEmail, email: task.assignedToEmail }} size="small" /><span>{task.assignedToName || task.assignedToEmail}</span></span> : <span className="muted">Unassigned</span>}</td><td className="col-due">{(() => { const due = dueInfo(task.dueDate); return due ? <span className={clsx("due-text", due.tone)}>{due.label}</span> : null; })()}</td></tr>)}</tbody></table>{!board.tasks.some(task => !task.done && matches(task)) && <EmptyBlock icon={Circle} title={filter || assigneeFilter ? "No matching issues" : "No active issues"} />}</div> : <div className={clsx("kanban-scroll", drag?.mode === "pointer" && "is-dragging")}>
        {visualColumns.map((column, index) => {
          const tasks = displayTasks(column._id, drag?.target ?? null);
          const completedCount = board.tasks.filter(task => task.done && matches(task) && columnForTask(task) === column._id).length;
          const prev = visualColumns[index - 1];
          const next = visualColumns[index + 1];
          return (
            <div
              data-testid="board-column"
              className={clsx("kanban-column", laneTone(column.displayTitle))}
              key={column._id}
              data-column-id={column._id}
              data-column-title={column.displayTitle}
              data-drop={drag?.target.columnId === column._id ? "" : undefined}
            >
              <div className="kanban-title">
                <div>
                  <span className="column-dot" />
                  <strong>{column.displayTitle}</strong>
                </div>
                <div className="kanban-tools">
                  <span>{tasks.length}</span>
                  {canEdit && <button className="icon-button" title={`Edit ${column.title} column`} aria-label={`Edit ${column.title} column`} onClick={() => setColumnEditor(column)}><MoreHorizontal size={15} /></button>}
                </div>
              </div>
              <div className="task-list">
                {tasks.length === 0 ? <div className="empty-lane">{completedCount ? <button className="archive-lane-link" aria-label={`View ${completedCount} completed issues in ${column.title}`} onClick={() => showCompleted(column._id)}><CheckCircle2 size={16} />{completedCount} completed</button> : filter ? "No matching issues" : "No issues"}</div> : null}
                {tasks.map((task) => (
                  <article
                    className={clsx("task-card", task.done && "done", drag?.taskId === task._id && (drag.mode === "pointer" ? "is-placeholder" : "is-moving"), canEdit && "can-drag")}
                    key={task._id}
                    data-task-id={task._id}
                    data-priority={task.priority}
                    onPointerDown={event => dnd.onPointerDown(event, task._id)}
                    onDragStart={event => event.preventDefault()}
                    onClick={() => setSelectedTaskId(task._id)}
                    tabIndex={0}
                    onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelectedTaskId(task._id); } }}
                  >
                    {(() => {
                      const member = task.assignedToEmail ? assignees.get(task.assignedToEmail) || { name: task.assignedToName || task.assignedToEmail, email: task.assignedToEmail } : null;
                      const due = dueInfo(task.dueDate);
                      return <>
                        <div className="task-card-head">
                          <span className="task-code">{taskKey(task._id)}<GitHubIssueIndicator number={task.githubIssueNumber} /></span>
                          {canEdit && <button className="drag-handle" type="button" aria-label={`Move ${task.title}`} aria-pressed={drag?.mode === "keyboard" && drag.taskId === task._id} onKeyDown={event => dnd.onHandleKeyDown(event, task._id)} onClick={event => dnd.onHandleClick(event, task._id)} onBlur={() => dnd.onHandleBlur(task._id)}><GripVertical size={13} /></button>}
                          {member && <button className="task-assignee-profile" title={sidebarUsername(member)} aria-label={`View ${sidebarUsername(member)} profile`} onClick={event => { event.stopPropagation(); openMember(member.email); }}><UserAvatar user={member} size="small" /></button>}
                        </div>
                        <div className="task-top">
                          <button
                            className="check-button"
                            aria-label={`Complete ${task.title}`}
                            type="button"
                            disabled={!canEdit}
                            onClick={(event) => {
                              event.stopPropagation();
                              void updateTask({ projectId, sessionToken, taskId: task._id, done: !task.done }).catch(error => setBoardNotice(errorText(error, "Could not update issue")));
                            }}
                          >
                            {task.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                          </button>
                          <strong>{task.title}</strong>
                        </div>
                        <div className="task-meta">
                          <span className={clsx("priority", task.priority)}><PriorityIcon priority={task.priority} />{task.priority}</span>
                          {due && <span className={clsx("due-chip", due.tone)} title={`Due ${task.dueDate}`}><CalendarDays size={12} />{due.label}</span>}
                          <TaskActionsMenu title={task.title} canEdit={canEdit} canMoveLeft={!!prev} canMoveRight={!!next} onMoveLeft={() => moveTask({ projectId, sessionToken, taskId: task._id, columnId: prev!._id })} onMoveRight={() => moveTask({ projectId, sessionToken, taskId: task._id, columnId: next!._id })} onDelete={() => deleteTask({ projectId, sessionToken, taskId: task._id })} onError={setBoardNotice} />
                        </div>
                      </>;
                    })()}
                  </article>
                ))}
              </div>
              {tasks.length > 0 && completedCount > 0 && <button className="archive-lane-link completed-lane-footer" aria-label={`View ${completedCount} completed issues in ${column.title}`} onClick={() => showCompleted(column._id)}><CheckCircle2 size={14} />{completedCount} completed</button>}
            </div>
          );
        })}
      </div>}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{dnd.announcement}</div>
      {columnEditor && <ColumnEditor column={columnEditor === "new" ? null : columnEditor} columns={visualColumns} projectId={projectId} sessionToken={sessionToken} onClose={() => setColumnEditor(null)} />}
      {selectedTaskId ? <TaskModal key={selectedTaskId} onOpenReference={(target, task) => { if (target === projectId && task) setSelectedTaskId(task); else { setSelectedTaskId(null); onOpenReference?.(target, task); } }} project={project} projectId={projectId} sessionToken={sessionToken} taskId={selectedTaskId} canEdit={canEdit} onClose={() => setSelectedTaskId(null)} /> : null}
    </section>
  );
}

function ColumnEditor({ column, columns, projectId, sessionToken, onClose }: { column: Doc<"columns"> | null; columns: Doc<"columns">[]; projectId: Id<"projects">; sessionToken: string; onClose: () => void }) {
  const online = useWorkspaceOnline();
  const [title, setTitle] = useState(column?.title || "");
  const [destination, setDestination] = useState(columns.find(c => c._id !== column?._id)?._id || "");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const create = useMutation(api.tasks.createColumn);
  const update = useMutation(api.tasks.updateColumn);
  const remove = useMutation(api.tasks.deleteColumn);
  return <Dialog title={column ? "Edit column" : "New column"} onClose={onClose}><form className="dialog-body stack-form" onSubmit={async e => { e.preventDefault(); if (!online) return; setBusy(true); try { if (column) await update({ projectId, sessionToken, columnId: column._id, title, isDone: false }); else await create({ projectId, sessionToken, title, isDone: false }); onClose(); } catch (error) { setError(errorText(error, "Could not save column")); } finally { setBusy(false); } }}><label>Name<input autoFocus value={title} onChange={e => setTitle(e.target.value)} required maxLength={60} /></label>{error && <p className="notice danger">{error}</p>}<div className="dialog-actions"><button className="primary-button compact" title={!online ? RECONNECT_TO_CREATE : undefined} disabled={busy || !online}>Save column</button>{column && columns.length > 1 && !isDraftColumn(column) && <button className="ghost-button danger compact" type="button" onClick={() => setDeleting(!deleting)}><Trash2 size={14} />Delete column</button>}</div>{deleting && column && <div className="column-delete-form"><label>Move its issues to<select value={destination} onChange={e => setDestination(e.target.value as Id<"columns">)}>{columns.filter(c => c._id !== column._id).map(c => <option key={c._id} value={c._id}>{c.title}</option>)}</select></label><button type="button" className="ghost-button danger" disabled={busy} onClick={async () => { setBusy(true); try { await remove({ projectId, sessionToken, columnId: column._id, moveToColumnId: destination as Id<"columns"> }); onClose(); } catch (error) { setError(errorText(error, "Could not delete column")); } finally { setBusy(false); } }}>Delete and move issues</button></div>}</form></Dialog>;
}

export function TaskModal(props: Parameters<typeof TaskModalContent>[0]) {
  return <ErrorBoundary resetKey={props.taskId} fallback={<Dialog title="Issue unavailable" onClose={props.onClose}><div className="dialog-body muted">This issue was deleted or you no longer have access to it.</div></Dialog>}><TaskModalContent {...props} /></ErrorBoundary>;
}

function TaskModalContent({
  project,
  projectId,
  sessionToken,
  taskId,
  canEdit,
  onClose,
  onOpenReference,
}: {
  project: ProjectWithUi;
  projectId: Id<"projects">;
  sessionToken: string;
  taskId: Id<"tasks">;
  canEdit: boolean;
  onClose: () => void;
  onOpenReference?: OpenReference;
}) {
  const details = useQuery(api.tasks.details, { projectId, sessionToken, taskId });
  const workspace = useWorkspace();
  const updateTask = useMutation(api.tasks.updateTask);
  const moveTask = useMutation(api.tasks.moveTask);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assignedToEmail, setAssignedToEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [columnId, setColumnId] = useState<Id<"columns"> | "">("");
  const [activityError, setActivityError] = useState("");
  const addAsset = useMutation(api.tasks.addAsset);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [githubState, setGithubState] = useState<"idle" | "creating" | "created" | "fallback" | "error">("idle");
  const [githubNotice, setGithubNotice] = useState("");
  const hydratedRef = useRef(false);
  const lastSaved = useRef({ title: "", description: "", priority: "medium" as Priority, assignedToEmail: "", dueDate: "" });
  const saving = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!details?.task) return;
    hydratedRef.current = false;
    setTitle(details.task.title);
    setDescription(details.task.description || "");
    setPriority(details.task.priority);
    setAssignedToEmail(details.task.assignedToEmail || "");
    setDueDate(details.task.dueDate || "");
    lastSaved.current = { title: details.task.title, description: details.task.description || "", priority: details.task.priority, assignedToEmail: details.task.assignedToEmail || "", dueDate: details.task.dueDate || "" };
    setColumnId(details.task.columnId);
    setSaveState("idle");
    setGithubState("idle");
    setGithubNotice("");
    const handle = window.setTimeout(() => { hydratedRef.current = true; }, 0);
    return () => window.clearTimeout(handle);
  }, [details?.task?._id]);

  const saveDraft = useCallback(() => {
    if (!canEdit || !hydratedRef.current) return Promise.resolve();
    const draft = { title: title.trim(), description, priority, assignedToEmail, dueDate };
    const save = saving.current.catch(() => {}).then(async () => {
      const patch: Partial<typeof draft> = {};
      for (const key of Object.keys(draft) as (keyof typeof draft)[]) {
        if (draft[key] !== lastSaved.current[key]) Object.assign(patch, { [key]: draft[key] });
      }
      if (!Object.keys(patch).length) return;
      if (!draft.title || patch.assignedToEmail === "" || patch.dueDate === "") {
        setSaveState("error"); throw new Error("Title, assignee and due date cannot be empty");
      }
      setSaveState("saving");
      try {
        await updateTask({ projectId, sessionToken, taskId, ...patch });
        lastSaved.current = draft; setSaveState("saved");
      } catch (error) { setSaveState("error"); throw error; }
    });
    saving.current = save;
    return save;
  }, [assignedToEmail, canEdit, description, dueDate, priority, projectId, sessionToken, taskId, title, updateTask]);
  useEffect(() => {
    if (!details?.task || !hydratedRef.current) return;
    const handle = window.setTimeout(() => { void saveDraft().catch(() => {}); }, 500);
    return () => window.clearTimeout(handle);
  }, [details?.task?._id, saveDraft]);
  const closeIssue = () => { void saveDraft().then(onClose).catch(error => setActivityError(errorText(error, "Could not save issue"))); };

  const changeColumn = async (value: string) => {
    if (!canEdit || !value) return;
    const nextColumnId = value as Id<"columns">;
    setColumnId(nextColumnId);
    setSaveState("saving");
    try {
      await moveTask({ projectId, sessionToken, taskId, columnId: nextColumnId });
      setSaveState("saved");
    } catch {
      setColumnId(details?.task.columnId || "");
      setSaveState("error");
    }
  };
  const openReference = (targetProject: Id<"projects">, targetTask?: Id<"tasks">) => { void saveDraft().then(() => { if (onOpenReference) { onOpenReference(targetProject, targetTask); return; } const url = new URL(window.location.href); url.search = new URLSearchParams({ project: targetProject, ...(targetTask ? { issue: targetTask } : {}) }).toString(); window.location.href = url.toString(); }).catch(() => setSaveState("error")); };
  const activity = details ? [...details.comments.map((item) => ({ kind: "comment" as const, at: item.createdAt, item })), ...details.assets.filter(item => !item.commentId).map((item) => ({ kind: "asset" as const, at: item.createdAt, item }))].sort((a, b) => a.at - b.at) : [];
  const linkedGitHubAsset = details?.assets.find((asset) => asset.url.includes("github.com") && /\/issues\/\d+/.test(asset.url));
  const linkedGitHubUrl = details?.task.githubIssueUrl || linkedGitHubAsset?.url;
  const githubIssueHref = details?.task
    ? githubNewIssueHref(
        project.repoUrl,
        details.task.title,
        [details.task.description, `Origin issue: ${taskKey(details.task._id)}`].filter(Boolean).join("\n\n"),
      )
    : null;
  const createGitHubIssue = async () => {
    if (!details?.task || !canEdit || !project.repoUrl) return;
    setGithubState("creating");
    setGithubNotice("");
    try {
      await saveDraft();
      const result = await localApi<{ ok: boolean; issueUrl: string; issueNumber: number; message: string }>("/api/github/issues", sessionToken, {
        method: "POST", json: { projectId, taskId },
      });
      setGithubState("created");
      setGithubNotice(result.message);
    } catch (error) {
      setGithubState("error");
      setGithubNotice(errorText(error, "GitHub issue creation failed"));
    }
  };
  const copyLink = async () => { const url = new URL(`/${workspace.slug}`, window.location.origin); url.searchParams.set("project", projectId); url.searchParams.set("issue", taskId); try { await navigator.clipboard.writeText(url.href); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setActivityError("Clipboard unavailable. Copy the issue URL from the address bar."); } };
  const dialogTitle = details ? `${taskKey(details.task._id)} / ${project.name}` : "Issue details";
  return <Dialog title={dialogTitle} className="issue-detail-dialog" onClose={closeIssue} heading={<div className="issue-detail-heading">
      <h2><ProjectIcon project={project} /><span>{project.name}</span>{details && <><span aria-hidden="true">/</span><span className="issue-detail-key">{taskKey(details.task._id)}</span></>}</h2>
      {details && <span className={clsx("issue-save-state", saveState === "error" && "danger")} aria-live="polite">{saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved. Check required fields." : ""}</span>}
      {details && <button type="button" className="icon-button" aria-label={copied ? "Issue link copied" : "Copy issue link"} title={copied ? "Copied" : "Copy link"} onClick={() => void copyLink()}>{copied ? <Check size={15} /> : <LinkIcon size={15} />}</button>}
    </div>}>
    {details ? <div className="issue-detail-layout">
      <section className="issue-description-section">
        {details.task.done && <span className="issue-completed-badge"><CheckCircle2 size={14} />Completed</span>}
        <textarea className="issue-title-input" aria-label="Issue title" autoFocus={canEdit} value={title} onChange={event => setTitle(event.target.value)} disabled={!canEdit} rows={1} maxLength={250} required />
        <textarea className="issue-detail-description" aria-label="Issue description" value={description} onChange={event => setDescription(event.target.value)} rows={4} placeholder="Add a description..." disabled={!canEdit} />
        <IssueRelations sessionToken={sessionToken} taskId={taskId} canEdit={canEdit} onOpen={openReference} />
      </section>
      <aside className="issue-detail-sidebar" aria-label="Issue properties">
        <IssueFields labeled columns={details.columns.filter(column => !(column.isDone ?? column.title.toLowerCase() === "done"))} members={details.members} columnId={columnId} onColumnChange={value => void changeColumn(value)} priority={priority} onPriorityChange={setPriority} assignee={assignedToEmail} onAssigneeChange={setAssignedToEmail} dueDate={dueDate} onDueDateChange={setDueDate} disabled={!canEdit} />
        <div className="issue-property"><span>Labels</span><IssueLabels sessionToken={sessionToken} taskId={taskId} canEdit={canEdit} /></div>
        {(project.repoUrl || linkedGitHubUrl) && <div className="issue-property issue-github-section"><span>GitHub</span><div>
          <span className="issue-repository-name">{githubRepoLabel(project.repoUrl)}</span>
          {linkedGitHubUrl ? <a className="ghost-button compact" href={linkedGitHubUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} />Open issue</a>
            : githubIssueHref && (details.task.githubTaskMode ?? project.githubTaskMode) !== "pull_request" ? <button className="ghost-button compact" type="button" onClick={createGitHubIssue} disabled={!canEdit || githubState === "creating"}>{githubState === "creating" ? <Loader2 className="spin" size={13} /> : <Plus size={13} />}{githubState === "creating" ? "Creating" : "Create GitHub issue"}</button>
            : null}
          <TaskPullRequest project={project} taskId={taskId} sessionToken={sessionToken} canEdit={canEdit} saveDraft={saveDraft} />
          {githubNotice && <small className={clsx("github-notice", githubState === "error" && "danger")}>{githubNotice}</small>}
        </div></div>}
        <dl className="issue-date-summary"><div><dt>Created</dt><dd>{fmtDate(details.task.createdAt)}</dd></div><div><dt>Updated</dt><dd>{fmtDate(details.task.updatedAt)}</dd></div></dl>
      </aside>
      <section className="issue-detail-activity">
        <IssueFileUpload projectId={projectId} taskId={taskId} sessionToken={sessionToken} disabled={!canEdit} onLink={url => { void addAsset({ projectId, taskId, sessionToken, type: "link", name: url, url }).catch(error => setActivityError(errorText(error, "Could not attach link"))); }}>
        <header><h3>Activity</h3></header>
        <div className="issue-timeline">
          {!activity.length && <p className="activity-empty">No comments yet</p>}
          {activity.map(entry => <article className="issue-timeline-entry" key={entry.item._id}>
            {entry.kind === "comment" ? <UserAvatar user={details.members.find(member => member.userId === entry.item.authorUserId) || { name: entry.item.authorName, email: entry.item.authorEmail }} size="small" /> : <span className="activity-avatar" aria-hidden="true"><Paperclip size={12} /></span>}
            <div className="activity-entry-content"><header><strong>{entry.kind === "comment" ? entry.item.authorName : "Attachment"}</strong><time dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString()}>{relativeTime(entry.at)}</time></header>
              {entry.kind === "comment" ? <><IssueCommentBody comment={entry.item} sessionToken={sessionToken} canEdit={canEdit} onOpenReference={openReference} /><div className="comment-media">{details.assets.filter(asset => asset.commentId === entry.item._id && asset.localFileId).map(asset => <LocalAttachment key={asset._id} file={{ id: asset.localFileId!, name: asset.name, size: asset.size || 0, contentType: asset.contentType || "application/octet-stream" }} sessionToken={sessionToken} scope={`teamId=${workspace._id}`} />)}</div></> : entry.item.localFileId ? <LocalAttachment file={{ id: entry.item.localFileId, name: entry.item.name, size: entry.item.size || 0, contentType: entry.item.contentType || "application/octet-stream" }} sessionToken={sessionToken} scope={`teamId=${workspace._id}`} /> : <a className="activity-attachment" href={entry.item.url} target="_blank" rel="noreferrer"><span>{entry.item.name}</span><ExternalLink size={13} /></a>}
            </div>
          </article>)}
        </div>
        </IssueFileUpload>
        {canEdit && <IssueCommentComposer key={taskId} projectId={projectId} taskId={taskId} sessionToken={sessionToken} members={details.members} />}
        {activityError && <div className="notice danger" role="alert">{activityError}</div>}
      </section>
    </div> : <div className="dialog-body"><LoadingState label="Opening issue" /></div>}
  </Dialog>;
}
