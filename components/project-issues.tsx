"use client";
import { errorText } from "@/lib/error-text";
import { isDraftColumn } from "@/lib/origin-columns";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import clsx from "clsx";
import { Check, CheckCircle2, Circle, Columns3, List, MoreHorizontal, PencilLine, Plus, Search, Trash2, Undo2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { formatDate } from "@/lib/format";
import { hasOpenKeyboardOverlay, isEditingTarget } from "@/lib/keyboard-navigation";
import { issueShortcut, matchesIssue, taskKey } from "../lib/project-issues";
import { MenuScrim, TaskMenu, type TaskMenuAnchor, type TaskMenuView } from "./task-actions-menu";
import { IssueCard, IssueRow, type CardPerson } from "./issue-card";
import { DatePopover } from "./date-picker";
import { MemberPicker } from "./member-picker";
import { Dialog } from "./dialog";
import { StatusIcon, laneTone } from "./issue-icons";
import { useBoardScroll } from "./use-board-scroll";
import { swallowNextClick, useCardFlip, useIssueDrag } from "./use-issue-drag";
import { isSheetLayout } from "./use-anchored-popover";
import { compareTaskOrder, planTaskMove } from "../lib/task-order";
import { RECONNECT_TO_CREATE, useWorkspaceOnline } from "./workspace-connection";
import { TaskModal } from "./issue-detail";
import { IssueComposer } from "./issue-composer";
import { LoadingState, subscribeCreatedIssue, type OpenReference, type ProjectWithUi } from "./issue-shared";

type Task = Doc<"tasks">;
type Column = Doc<"columns">;
type Priority = "low" | "medium" | "high";
type MoveTaskArgs = { projectId: Id<"projects">; sessionToken: string; taskId: Id<"tasks">; columnId: Id<"columns">; beforeTaskId?: Id<"tasks"> };
type UpdateTaskArgs = { projectId: Id<"projects">; sessionToken: string; taskId: Id<"tasks">; priority?: Priority; assignedToEmail?: string; dueDate?: string; done?: boolean };
type MenuState = { taskId: Id<"tasks">; view: TaskMenuView; anchor: TaskMenuAnchor; from: HTMLElement };
type Toast = { id: number; text: string; icon?: ReactNode; undo?: () => void };

/** How long a completed card stays (checked) before it collapses, and how long the collapse takes. */
const COMPLETE_HOLD_MS = 600;
const COLLAPSE_MS = 220;
let toastSeq = 0;
const LONG_PRESS_MS = 350;
const TOUCH_SLOP = 8;

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

/** Applies a card quick edit (priority, assignee, due date, done) to the cached board right away. */
function updateTaskOnBoard(store: OptimisticLocalStore, args: UpdateTaskArgs) {
  const query = { projectId: args.projectId, sessionToken: args.sessionToken };
  const board = store.getQuery(api.tasks.board, query);
  if (!board?.tasks.some(task => task._id === args.taskId)) return;
  const tasks = board.tasks.map(task => task._id !== args.taskId ? task : {
    ...task,
    ...(args.priority !== undefined ? { priority: args.priority } : {}),
    ...(args.dueDate !== undefined ? { dueDate: args.dueDate } : {}),
    ...(args.done !== undefined ? { done: args.done } : {}),
    ...(args.assignedToEmail !== undefined ? { assignedToEmail: args.assignedToEmail, assignedToName: board.assignees.find(person => person.email === args.assignedToEmail)?.name } : {}),
    updatedAt: Date.now(),
  });
  store.setQuery(api.tasks.board, query, { ...board, tasks });
}

const isDone = (column: Column) => column.isDone ?? column.title.toLowerCase() === "done";

/** Active cards of a board lane in display order; cards whose column is hidden show in Todo (or the first lane). */
function activeLaneTasks(board: { columns: Column[]; tasks: Task[] }, columnId: string, matches: (task: Task) => boolean) {
  const columns = board.columns.filter(column => !isDone(column));
  const ids = new Set<string>(columns.map(column => column._id));
  const fallback = columns.find(column => column.title.toLowerCase() === "todo") || columns[0];
  return board.tasks.filter(task => !task.done && matches(task) && (ids.has(task.columnId) ? task.columnId : fallback?._id) === columnId);
}

const layoutKey = (projectId: string) => `origin.issueLayout.${projectId}`;
function readLayout(projectId: string): "board" | "list" {
  try { return typeof window !== "undefined" && localStorage.getItem(layoutKey(projectId)) === "list" ? "list" : "board"; } catch { return "board"; }
}

/**
 * After a tap closes a popover that dismisses on press (the card due date), the click the browser makes for that tap
 * must not open the card or button underneath. Swallows that one click if the popover is gone by then.
 */
function swallowTapThrough(popoverSelector: string) {
  const block = (event: MouseEvent) => {
    remove();
    if (document.querySelector(popoverSelector)) return;
    event.preventDefault(); event.stopPropagation();
  };
  const remove = () => {
    window.removeEventListener("click", block, { capture: true });
    window.removeEventListener("pointerdown", remove, { capture: true });
  };
  window.setTimeout(() => window.addEventListener("pointerdown", remove, { capture: true, once: true }), 0);
  window.addEventListener("click", block, { capture: true });
  window.setTimeout(remove, 800);
}

/** A board card or list row. */
const cardElement = (root: ParentNode | null | undefined, taskId: string) => root?.querySelector<HTMLElement>(`:is(.kanban-scroll, .issue-table) [data-task-id="${CSS.escape(taskId)}"]`) ?? null;

/** Scrolls the board's own scroll areas (never the page around them) just enough to show `element`. */
function revealInBoard(element: HTMLElement) {
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (let scroller = element.parentElement; scroller && !scroller.classList.contains("board-section"); scroller = scroller.parentElement) {
    const style = getComputedStyle(scroller);
    const scrollsX = /auto|scroll/.test(style.overflowX) && scroller.scrollWidth > scroller.clientWidth;
    const scrollsY = /auto|scroll/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight;
    if (!scrollsX && !scrollsY) continue;
    const box = scroller.getBoundingClientRect();
    // Horizontally, bring in the whole lane (a phone shows one lane at a time).
    const target = (scrollsX && element.closest("[data-column-id]")) || element;
    const rect = target.getBoundingClientRect(), own = element.getBoundingClientRect();
    const left = !scrollsX ? 0 : rect.left < box.left ? rect.left - box.left : rect.right > box.right ? Math.min(rect.right - box.right, rect.left - box.left) : 0;
    const top = !scrollsY ? 0 : own.top < box.top ? own.top - box.top - 8 : own.bottom > box.bottom ? own.bottom - box.bottom + 8 : 0;
    if (left || top) scroller.scrollBy({ left, top, behavior: smooth ? "smooth" : "auto" });
  }
}

function EmptyBlock({ icon: Icon, title }: { icon: typeof Circle; title: string }) {
  return <div className="empty-block"><Icon size={20} /><h3>{title}</h3></div>;
}

export function BoardTab({ project, projectId, sessionToken, canEdit, userEmail, onCreateIssue, initialTaskId, onOpenReference }: { project: ProjectWithUi; projectId: Id<"projects">; sessionToken: string; canEdit: boolean; userEmail: string; onCreateIssue: () => void; initialTaskId?: Id<"tasks">; onOpenReference?: OpenReference }) {
  const online = useWorkspaceOnline();
  const board = useQuery(api.tasks.board, { projectId, sessionToken });
  const projectMembers = useQuery(api.members.people, { projectId, sessionToken });
  const updateTask = useMutation(api.tasks.updateTask).withOptimisticUpdate(updateTaskOnBoard);
  const moveTask = useMutation(api.tasks.moveTask).withOptimisticUpdate(moveTaskOnBoard);
  const deleteTask = useMutation(api.tasks.deleteTask);
  const createColumn = useMutation(api.tasks.createColumn);
  const updateColumn = useMutation(api.tasks.updateColumn);

  const [layout, setLayoutState] = useState<"board" | "list">(() => readLayout(projectId));
  const setLayout = (next: "board" | "list") => {
    setLayoutState(next);
    try { localStorage.setItem(layoutKey(projectId), next); } catch { /* storage unavailable: keep it for this visit */ }
  };
  const [boardNotice, setBoardNotice] = useState("");
  const [archive, setArchive] = useState(false);
  // The open issue lives in the URL; opening one from the board adds a history entry so Back closes it.
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(initialTaskId ?? null);
  const pushedIssue = useRef<string | null>(null);
  const boardScroll = useBoardScroll(Boolean(board) && !archive && layout === "board");
  const openTask = (taskId: Id<"tasks">) => {
    setSelectedTaskId(taskId);
    const url = new URL(window.location.href);
    url.searchParams.set("project", projectId);
    url.searchParams.set("issue", taskId);
    window.history.pushState({ originIssue: taskId }, "", url);
    pushedIssue.current = taskId;
  };
  const closeTask = () => {
    const closing = selectedTaskId;
    if (closing && pushedIssue.current === closing && window.history.state?.originIssue === closing) window.history.back();
    else {
      const url = new URL(window.location.href);
      url.searchParams.delete("issue");
      window.history.replaceState(window.history.state, "", url);
    }
    pushedIssue.current = null;
    setSelectedTaskId(null);
    // Give focus back to the card the issue was opened from.
    if (closing) requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      cardElement(boardScroll.current, closing)?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    const onPop = () => {
      const issue = new URL(window.location.href).searchParams.get("issue");
      pushedIssue.current = issue && window.history.state?.originIssue === issue ? issue : null;
      setSelectedTaskId(issue as Id<"tasks"> | null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("project", projectId);
    if (selectedTaskId) url.searchParams.set("issue", selectedTaskId);
    else url.searchParams.delete("issue");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [projectId, selectedTaskId]);

  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const filterBox = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** The card whose due date popover is open, anchored to its due chip (or the card). */
  const [datePick, setDatePick] = useState<{ taskId: Id<"tasks">; anchor: { current: HTMLElement } } | null>(null);
  const [completing, setCompleting] = useState<Record<string, "checked">>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [columnDelete, setColumnDelete] = useState<Column | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  /**
   * Lanes shown open at some point during this visit. Only lanes that were already empty when the board first drew
   * fold; a lane emptied later (a drop, a completion, a move) stays open, so nothing slides after a card settles.
   */
  const [openLanes, setOpenLanes] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [laneCreate, setLaneCreate] = useState<Id<"columns"> | null>(null);
  /** A card to focus quietly once it is on the board (a new issue). */
  const [revealId, setRevealId] = useState<string | null>(null);
  useEffect(() => subscribeCreatedIssue(setRevealId), []);

  // A tap outside the card's date popover only closes it (mouse presses behave as before).
  useEffect(() => {
    if (!datePick) return;
    const guard = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (event.pointerType === "mouse" || target?.closest?.(".date-picker-popover") || datePick.anchor.current.contains(target)) return;
      swallowTapThrough(".date-picker-popover");
    };
    document.addEventListener("pointerdown", guard, true);
    return () => document.removeEventListener("pointerdown", guard, true);
  }, [datePick]);

  const showToast = (text: string, undo?: () => void, icon?: ReactNode) => setToast({ id: ++toastSeq, text, undo, icon });
  const dnd = useIssueDrag({
    rootRef: boardScroll,
    enabled: canEdit,
    onMove: (taskId, target) => {
      if (!board?.tasks.some(task => task._id === taskId)) return;
      const before = activeLaneTasks(board, target.columnId, task => matchesIssue(task, filter, assigneeFilter)).filter(task => task._id !== taskId)[target.index];
      void moveTask({ projectId, sessionToken, taskId: taskId as Id<"tasks">, columnId: target.columnId as Id<"columns">, beforeTaskId: before?._id }).catch(error => setBoardNotice(errorText(error, "Could not move issue")));
    },
    onPressMenu: (taskId, card) => {
      const rect = card.getBoundingClientRect();
      setFocusId(taskId);
      setMenu({ taskId: taskId as Id<"tasks">, view: "root", anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, from: card });
    },
  });
  useCardFlip(boardScroll);
  const drag = dnd.drag;
  // Remember every lane that has cards (or that a dragged card opened), so it never folds under the person later.
  if (board) {
    const open = board.columns.filter(column => activeLaneTasks(board, column._id, () => true).length).map(column => column._id as string);
    if (drag) open.push(drag.target.columnId);
    if (!open.every(id => openLanes.has(id))) setOpenLanes(new Set([...openLanes, ...open]));
  }

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
    // setLayout only writes state and storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, online, onCreateIssue, projectId]);

  // The search popover closes on an outside press; an active query stays visible as a chip.
  useEffect(() => {
    if (!filterOpen) return;
    const dismiss = (event: PointerEvent) => { if (!filterBox.current?.contains(event.target as Node)) setFilterOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [filterOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(current => current?.id === toast.id ? null : current), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(timer => window.clearTimeout(timer)), []);
  const later = (run: () => void, ms: number) => { timers.current.push(window.setTimeout(run, ms)); };

  /** The card to focus once `taskId` leaves its lane: the next one, else the previous one. */
  const neighbourOf = (taskId: string) => {
    const card = cardElement(boardScroll.current, taskId);
    const cards = card?.parentElement ? [...card.parentElement.querySelectorAll<HTMLElement>(":scope > [data-task-id]")] : [];
    const index = cards.indexOf(card!);
    return (cards[index + 1] ?? cards[index - 1])?.dataset.taskId ?? null;
  };
  const focusCard = (taskId: string | null) => {
    if (!taskId) return;
    setFocusId(taskId);
    requestAnimationFrame(() => cardElement(boardScroll.current, taskId)?.focus({ preventScroll: true }));
  };

  // A new issue: once its card is on the board, focus it without a ring and bring it into view.
  useEffect(() => {
    if (!revealId || !board) return;
    // Two frames: after the composer has closed and handed focus back.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setRevealId(null);
        // Nothing to show when it was created in another project or is filtered out.
        const card = cardElement(boardScroll.current, revealId);
        if (!card) return;
        setFocusId(revealId);
        card.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
        revealInBoard(card);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [revealId, board, boardScroll]);

  /** Touch long-press on a list row opens its menu, as it does on a card. */
  const press = useRef<(() => void) | null>(null);
  useEffect(() => () => press.current?.(), []);

  if (!board) return <LoadingState label="Loading board" />;

  const people = new Map<string, CardPerson>();
  for (const person of [...(board.assignees || []), ...(projectMembers || [])]) people.set(person.email, { email: person.email, name: person.name, username: person.username, avatarUrl: person.avatarUrl });
  const assigneeOf = (task: Task): CardPerson | null => task.assignedToEmail ? people.get(task.assignedToEmail) ?? { email: task.assignedToEmail, name: task.assignedToName } : null;
  const visualColumns = board.columns.filter(column => !isDone(column));
  const matches = (task: Task) => matchesIssue(task, filter, assigneeFilter);
  const visibleColumnIds = new Set<string>(visualColumns.map(column => column._id));
  const fallbackColumn = visualColumns.find(column => column.title.toLowerCase() === "todo") || visualColumns[0];
  const columnForTask = (task: Task) => visibleColumnIds.has(task.columnId) ? task.columnId : fallbackColumn?._id;
  const toneOf = (column: Column) => isDraftColumn(column) ? "draft" : laneTone(column.title);
  const archivedTasks = board.tasks.filter(task => task.done && matches(task)).sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
  const visibleTasks = (columnId: string) => activeLaneTasks(board, columnId, matches);
  const activeTasks = visualColumns.flatMap(column => visibleTasks(column._id));
  const boardHasActive = board.tasks.some(task => !task.done);
  const tabStopId = activeTasks.some(task => task._id === focusId) ? focusId : activeTasks[0]?._id ?? null;
  /** Column cards with the dragged card shown in its target slot. */
  const displayTasks = (columnId: string) => {
    const tasks = visibleTasks(columnId);
    const slot = drag?.target;
    if (!drag || !slot) return tasks;
    const moving = board.tasks.find(task => task._id === drag.taskId);
    const others = tasks.filter(task => task._id !== drag.taskId);
    if (moving && slot.columnId === columnId) others.splice(Math.min(slot.index, others.length), 0, moving);
    return others;
  };
  const report = (fallback: string) => (error: unknown) => setBoardNotice(errorText(error, fallback));
  const update = (taskId: Id<"tasks">, patch: Omit<UpdateTaskArgs, "projectId" | "sessionToken" | "taskId">, fallback = "Could not update issue") =>
    updateTask({ projectId, sessionToken, taskId, ...patch }).catch(report(fallback));

  const complete = (task: Task) => {
    if (!canEdit || completing[task._id]) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hadFocus = Boolean(document.activeElement?.closest(`[data-task-id="${CSS.escape(task._id)}"]`));
    setCompleting(current => ({ ...current, [task._id]: "checked" }));
    const clear = () => setCompleting(current => { const rest = { ...current }; delete rest[task._id]; return rest; });
    const commit = () => {
      const next = neighbourOf(task._id);
      updateTask({ projectId, sessionToken, taskId: task._id, done: true })
        .then(() => clear())
        .then(() => showToast("Completed", () => void updateTask({ projectId, sessionToken, taskId: task._id, done: false }).then(() => { setToast(null); focusCard(task._id); }).catch(report("Could not restore issue"))))
        .catch(error => { clear(); cardElement(boardScroll.current, task._id)?.getAnimations().forEach(animation => animation.cancel()); report("Could not complete issue")(error); });
      if (hadFocus || document.activeElement === document.body) focusCard(next);
    };
    if (reduced) { later(commit, 150); return; }
    later(() => {
      const found = cardElement(boardScroll.current, task._id);
      // Cards fold away; list rows simply leave.
      const card = found?.classList.contains("task-card") ? found : null;
      const lane = card?.parentElement;
      if (card && lane) {
        // The collapse moves the cards below for real; the lane tells useCardFlip not to animate those moves again.
        lane.setAttribute("data-collapsing", "");
        later(() => lane.removeAttribute("data-collapsing"), COLLAPSE_MS + 600);
        card.classList.add("is-collapsing");
        const gap = parseFloat(getComputedStyle(card.parentElement!).rowGap) || 0;
        card.animate([
          { height: `${card.offsetHeight}px`, opacity: 1, marginBottom: "0px" },
          { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px", marginBottom: `${-gap}px` },
        ], { duration: COLLAPSE_MS, easing: "cubic-bezier(.2, .8, .2, 1)", fill: "forwards" });
      }
      later(commit, card ? COLLAPSE_MS : 0);
    }, COMPLETE_HOLD_MS);
  };

  const openMenu = (taskId: string, view: TaskMenuView, anchor: TaskMenuAnchor, from: HTMLElement) => {
    if (!canEdit) return;
    setFocusId(taskId);
    setMenu({ taskId: taskId as Id<"tasks">, view, anchor, from });
  };
  const onRowPointerDown = (event: ReactPointerEvent<HTMLElement>, taskId: string) => {
    press.current?.();
    if (!canEdit || event.pointerType !== "touch" || !event.isPrimary || (event.target as Element).closest("button, a, input")) return;
    const row = event.currentTarget, startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
    let fired = false;
    const move = (pointer: PointerEvent) => { if (pointer.pointerId === pointerId && !fired && Math.hypot(pointer.clientX - startX, pointer.clientY - startY) > TOUCH_SLOP) stop(); };
    const up = (pointer: PointerEvent) => { if (pointer.pointerId !== pointerId) return; if (fired) swallowNextClick(pointer.timeStamp); stop(); };
    const blockMenu = (menuEvent: Event) => menuEvent.preventDefault();
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("contextmenu", blockMenu);
      if (press.current === stop) press.current = null;
    };
    const timer = window.setTimeout(() => {
      if (!row.isConnected) { stop(); return; }
      fired = true;
      navigator.vibrate?.(8);
      const rect = row.getBoundingClientRect();
      openMenu(taskId, "root", { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, row);
    }, LONG_PRESS_MS);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("contextmenu", blockMenu);
    press.current = stop;
  };
  const closeMenu = (restoreFocus: boolean) => {
    const current = menu;
    setMenu(null);
    if (restoreFocus && current) requestAnimationFrame(() => (current.from.isConnected ? current.from.closest<HTMLElement>("[data-task-id]") ?? current.from : cardElement(boardScroll.current, current.taskId))?.focus({ preventScroll: true }));
  };
  /** Status from the menu. On a phone the card leaves the lane on screen, so say where it went (with Undo). */
  const moveToLane = (task: Task, columnId: string) => {
    const from = columnForTask(task);
    if (!from || columnId === from) return;
    const lane = visualColumns.find(column => column._id === columnId);
    const siblings = activeLaneTasks(board, from, () => true);
    const after = siblings[siblings.findIndex(item => item._id === task._id) + 1];
    const announce = isSheetLayout() && layout === "board" && lane;
    void moveTask({ projectId, sessionToken, taskId: task._id, columnId: columnId as Id<"columns"> }).then(() => {
      if (!announce) return;
      showToast(`Moved to ${lane.title}`, () => void moveTask({ projectId, sessionToken, taskId: task._id, columnId: from as Id<"columns">, ...(after ? { beforeTaskId: after._id } : {}) }).catch(report("Could not move issue")), <StatusIcon title={toneOf(lane) === "draft" ? "Draft" : lane.title} />);
    }, report("Could not move issue"));
  };
  const menuTask = menu ? board.tasks.find(task => task._id === menu.taskId) : undefined;
  const datePickTask = datePick ? board.tasks.find(task => task._id === datePick.taskId) : undefined;

  const onCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>, task: Task) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const card = event.currentTarget;
    const row = card.matches("tr");
    if (event.key === "Enter") { event.preventDefault(); openTask(task._id); return; }
    if (event.key === " ") { event.preventDefault(); if (canEdit && !row) dnd.pickUp(task._id); else openTask(task._id); return; }
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const rect = card.getBoundingClientRect();
      openMenu(task._id, "root", { left: rect.left + 12, top: rect.top, right: rect.right, bottom: rect.bottom }, card);
      return;
    }
    if (event.shiftKey) return;
    // The list is one lane of rows; the board has one lane per column.
    const lanes = row
      ? [[...card.parentElement!.querySelectorAll<HTMLElement>(":scope > [data-task-id]")]]
      : [...(boardScroll.current?.querySelectorAll<HTMLElement>(".kanban-scroll > [data-column-id]") ?? [])].map(lane => [...lane.querySelectorAll<HTMLElement>(".task-list > [data-task-id]")]);
    const laneIndex = lanes.findIndex(cards => cards.includes(card));
    if (laneIndex < 0) return;
    const index = lanes[laneIndex]!.indexOf(card);
    let target: HTMLElement | undefined;
    if (event.key === "ArrowDown") target = lanes[laneIndex]![index + 1];
    else if (event.key === "ArrowUp") target = lanes[laneIndex]![index - 1];
    else if (event.key === "Home") target = lanes[laneIndex]![0];
    else if (event.key === "End") target = lanes[laneIndex]!.at(-1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const step = event.key === "ArrowLeft" ? -1 : 1;
      for (let next = laneIndex + step; next >= 0 && next < lanes.length && !target; next += step) target = lanes[next]![Math.min(index, lanes[next]!.length - 1)];
    } else return;
    event.preventDefault();
    if (!target) return;
    setFocusId(target.dataset.taskId!);
    target.focus();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const restore = async (task: Task) => {
    const target = columnForTask(task);
    if (!target) { setBoardNotice("Add a workflow column before restoring an issue"); return; }
    try {
      if (!visibleColumnIds.has(task.columnId)) await moveTask({ projectId, sessionToken, taskId: task._id, columnId: target as Id<"columns"> });
      await updateTask({ projectId, sessionToken, taskId: task._id, done: false });
    } catch (error) { setBoardNotice(errorText(error, "Could not restore issue")); }
  };
  const copyLink = (task: Task) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("project", projectId);
    url.searchParams.set("issue", task._id);
    navigator.clipboard?.writeText(url.href).then(() => showToast("Link copied"), () => setBoardNotice("Could not copy the link"));
  };
  const addColumn = async (title: string) => {
    if (!title.trim()) { setAddingColumn(false); return; }
    try {
      await createColumn({ projectId, sessionToken, title: title.trim(), isDone: false });
      setAddingColumn(false);
      // Show the new lane by scrolling the board itself (never the page around it).
      requestAnimationFrame(() => { const scroll = boardScroll.current?.querySelector<HTMLElement>(".kanban-scroll"); if (scroll) scroll.scrollTo({ left: scroll.scrollWidth, behavior: "smooth" }); });
    } catch (error) { setBoardNotice(errorText(error, "Could not add column")); }
  };
  const renameColumn = async (column: Column, title: string) => {
    setRenaming(null);
    if (!title.trim() || title.trim() === column.title) return;
    try { await updateColumn({ projectId, sessionToken, columnId: column._id, title: title.trim(), isDone: false }); }
    catch (error) { setBoardNotice(errorText(error, "Could not rename column")); }
  };
  const filtered = Boolean(filter || assigneeFilter);
  const listTasks = activeTasks;
  const statusOf = (task: Task) => visualColumns.find(column => column._id === columnForTask(task));

  const toolbar = (
    <div className="board-header">
      <div className="segmented-control"><span className="segment-glider" aria-hidden="true" /><button className={!archive ? "active" : ""} onClick={() => setArchive(false)}>Active<span>{board.tasks.filter(t => !t.done && matches(t)).length}</span></button><button className={archive ? "active" : ""} onClick={() => setArchive(true)}>Completed<span>{board.tasks.filter(t => t.done && matches(t)).length}</span></button></div>
      <div className="board-header-actions">
        <div className="board-filter-control" ref={filterBox}>
          {filter && !filterOpen
            ? <span className="board-search-chip"><button type="button" aria-label={`Search: ${filter}`} onClick={() => setFilterOpen(true)}><Search size={13} /><span>{filter}</span></button><button type="button" aria-label="Clear search" onClick={() => { setFilter(""); filterButton.current?.focus(); }}><X size={13} /></button></span>
            : <button ref={filterButton} className={clsx("icon-button", filterOpen && "selected")} aria-label="Search issues" title="Search (/)" aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}><Search size={15} /></button>}
          {filterOpen && <div className="board-filter-popover"><Search size={14} /><input autoFocus value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search issues" aria-label="Search project issues" onKeyDown={event => { if (event.key === "Escape" || event.key === "Enter") { event.preventDefault(); setFilterOpen(false); requestAnimationFrame(() => filterButton.current?.focus()); } }} />{filter && <button className="icon-button" aria-label="Clear search" onClick={() => setFilter("")}><X size={14} /></button>}</div>}
        </div>
        <MemberPicker label="Issue assignee filter" members={[...people.values()]} value={assigneeFilter} onChange={setAssigneeFilter} allLabel="All issues" currentEmail={userEmail} />
        <div className={clsx("segmented-control issue-layout-switch", archive && "is-idle")} role="group" aria-label="Issue layout" inert={archive} aria-hidden={archive || undefined}><button aria-label="Board view" aria-pressed={layout === "board"} className={layout === "board" ? "active" : ""} onClick={() => setLayout("board")} title="Board (B)"><Columns3 size={14} /></button><button aria-label="List view" aria-pressed={layout === "list"} className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")} title="List (L)"><List size={14} /></button></div>
        {canEdit && <button disabled={!online} title={!online ? RECONNECT_TO_CREATE : "Create issue (C)"} className="primary-button compact project-create-issue" onClick={onCreateIssue}><Plus size={14} /><span>Create issue</span></button>}
      </div>
    </div>
  );

  const archiveView = (
    <div className="archive-list">
      {!archivedTasks.length && <EmptyBlock icon={CheckCircle2} title={filtered ? "No matching issues" : "No completed issues"} />}
      {archivedTasks.map(task => <div key={task._id} className="archive-row" data-task-id={task._id} onClick={() => openTask(task._id)}>
        <span className="check-done archive-check"><Check size={10} strokeWidth={3} /></span>
        <button className="archive-issue" onClick={event => { event.stopPropagation(); openTask(task._id); }}><span className="issue-key">{taskKey(task._id)}</span><strong>{task.title}</strong></button>
        <time>{formatDate(task.completedAt ?? task.updatedAt)}</time>
        {canEdit && <button className="ghost-button compact archive-restore" aria-label={`Restore ${task.title}`} onClick={event => { event.stopPropagation(); void restore(task); }}><Undo2 size={14} /><span>Restore</span></button>}
      </div>)}
    </div>
  );

  const listView = (
    <div className="issue-table-scroll">
      <table className="issue-table">
        <caption className="sr-only">Active project issues</caption>
        <thead><tr><th scope="col">Issue</th><th scope="col" className="col-status">Status</th><th scope="col" className="col-priority">Priority</th><th scope="col" className="col-assignee">Assignee</th><th scope="col" className="col-due">Due</th></tr></thead>
        <tbody>{listTasks.map(task => {
          const status = statusOf(task);
          return <IssueRow
            key={task._id}
            task={task}
            assignee={assigneeOf(task)}
            status={status && { title: isDraftColumn(status) ? "Draft" : status.title, label: status.title }}
            canEdit={canEdit}
            tabStop={tabStopId === task._id}
            selected={selectedTaskId === task._id}
            completing={completing[task._id]}
            menuOpen={menu?.taskId === task._id}
            onOpen={openTask}
            onComplete={complete}
            onMenu={(item, view, anchor, from) => openMenu(item._id, view, anchor, from)}
            onDueDate={(item, from) => setDatePick({ taskId: item._id, anchor: { current: from } })}
            onKeyDown={onCardKeyDown}
            onFocus={setFocusId}
            onPointerDown={onRowPointerDown}
          />;
        })}</tbody>
      </table>
      {!listTasks.length && <EmptyBlock icon={Circle} title={filtered ? "No matching issues" : "No active issues"} />}
    </div>
  );

  const boardView = (
    <div className={clsx("kanban-scroll", drag?.mode === "pointer" && "is-dragging")}>
      {visualColumns.map(column => {
        const tasks = displayTasks(column._id);
        const tone = toneOf(column);
        const statusTitle = tone === "draft" ? "Draft" : column.title;
        // Only lanes that were empty from the start fold; a lane emptied by the search or filter stays open and says so.
        const collapsed = boardHasActive && !openLanes.has(column._id) && !activeLaneTasks(board, column._id, () => true).length && drag?.target.columnId !== column._id && renaming !== column._id;
        const canDelete = visualColumns.length > 1 && !isDraftColumn(column);
        return (
          <div
            data-testid="board-column"
            className={clsx("kanban-column", tone, collapsed && "is-collapsed")}
            key={column._id}
            data-column-id={column._id}
            data-column-title={column.title}
            data-drop={drag?.target.columnId === column._id ? "" : undefined}
          >
            {collapsed
              ? <button type="button" className="lane-strip" aria-expanded="false" aria-label={`${column.title}, ${tasks.length} issues`} onClick={() => setOpenLanes(current => new Set(current).add(column._id))}>
                <StatusIcon title={statusTitle} /><strong>{column.title}</strong><span>{tasks.length}</span>
              </button>
              : <>
                <div className="kanban-title">
                  <div className="kanban-name">
                    <StatusIcon title={statusTitle} />
                    {renaming === column._id
                      ? <input className="lane-rename" autoFocus defaultValue={column.title} maxLength={60} aria-label="Column name" onFocus={event => event.currentTarget.select()} onBlur={event => void renameColumn(column, event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setRenaming(null); } }} />
                      : <strong>{column.title}</strong>}
                    <span className="lane-count">{tasks.filter(task => !completing[task._id]).length}</span>
                  </div>
                  {canEdit && <div className="kanban-tools">
                    <button className="icon-button" aria-label={`Add issue to ${column.title}`} title={!online ? RECONNECT_TO_CREATE : undefined} disabled={!online} onClick={() => setLaneCreate(column._id)}><Plus size={15} /></button>
                    <LaneMenu title={column.title} canDelete={canDelete} onRename={() => setRenaming(column._id)} onDelete={() => setColumnDelete(column)} />
                  </div>}
                </div>
                <div className="task-list">
                  {tasks.length === 0 ? <div className="empty-lane">{filtered ? "No matching issues" : canEdit && online ? <button className="archive-lane-link" onClick={() => setLaneCreate(column._id)}><Plus size={14} />Add issue</button> : "No issues"}</div> : null}
                  {tasks.map(task => <IssueCard
                    key={task._id}
                    task={task}
                    assignee={assigneeOf(task)}
                    canEdit={canEdit}
                    tabStop={tabStopId === task._id}
                    selected={selectedTaskId === task._id}
                    completing={completing[task._id]}
                    dragState={drag?.taskId === task._id ? (drag.mode === "pointer" ? "placeholder" : "moving") : undefined}
                    keyboardMoving={drag?.mode === "keyboard" && drag.taskId === task._id}
                    menuOpen={menu?.taskId === task._id}
                    onOpen={openTask}
                    onComplete={complete}
                    onMenu={(item, view, anchor, from) => openMenu(item._id, view, anchor, from)}
                    onDueDate={(item, from) => setDatePick({ taskId: item._id, anchor: { current: from } })}
                    onKeyDown={onCardKeyDown}
                    onFocus={setFocusId}
                    onPointerDown={dnd.onPointerDown}
                    onHandleKeyDown={dnd.onHandleKeyDown}
                    onHandleClick={dnd.onHandleClick}
                    onHandleBlur={dnd.onHandleBlur}
                  />)}
                </div>
              </>}
          </div>
        );
      })}
      {canEdit && <div className={clsx("kanban-add-column", addingColumn && "is-editing")}>
        {addingColumn
          ? <form onSubmit={event => { event.preventDefault(); void addColumn(new FormData(event.currentTarget).get("title") as string); }}>
            <input name="title" autoFocus maxLength={60} placeholder="Column name" aria-label="Column name" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAddingColumn(false); } }} onBlur={event => { if (!event.currentTarget.value.trim()) setAddingColumn(false); }} />
            <div className="kanban-add-actions"><button className="primary-button compact" disabled={!online}>Add</button><button type="button" className="ghost-button compact" onClick={() => setAddingColumn(false)}>Cancel</button></div>
          </form>
          : <button type="button" className="lane-strip lane-add" disabled={!online} title={!online ? RECONNECT_TO_CREATE : undefined} onClick={() => setAddingColumn(true)}><Plus size={14} /><strong>Add column</strong></button>}
      </div>}
    </div>
  );

  return (
    <section className="board-section" ref={boardScroll}>
      {toolbar}
      {!canEdit ? <div className="notice">View only</div> : null}
      {boardNotice ? <div className="notice danger" role="alert">{boardNotice}<button className="icon-button" aria-label="Dismiss" onClick={() => setBoardNotice("")}><X size={14} /></button></div> : null}
      {archive ? archiveView : layout === "list" ? listView : boardView}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{dnd.announcement}</div>
      {menu && menuTask && <TaskMenu
        key={`${menu.taskId}:${menu.view}`}
        title={menuTask.title}
        view={menu.view}
        anchor={menu.anchor}
        status={columnForTask(menuTask) ?? ""}
        statuses={visualColumns.map(column => ({ id: column._id, title: column.title }))}
        priority={menuTask.priority}
        assignee={menuTask.assignedToEmail}
        members={projectMembers ?? [...people.values()]}
        currentEmail={userEmail}
        dueDate={menuTask.dueDate}
        onStatus={columnId => moveToLane(menuTask, columnId)}
        onPriority={priority => { if (priority !== menuTask.priority) void update(menuTask._id, { priority }); }}
        onAssignee={email => { if (email !== (menuTask.assignedToEmail ?? "")) void update(menuTask._id, { assignedToEmail: email }); }}
        onDueDate={() => {
          const taskId = menuTask._id;
          // After the menu has closed and handed focus back to the card.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const card = cardElement(boardScroll.current, taskId);
            if (card) setDatePick({ taskId, anchor: { current: card.querySelector<HTMLElement>(".due-chip") ?? card } });
          }));
        }}
        onCopyLink={() => copyLink(menuTask)}
        onDelete={() => setDeleting(menuTask)}
        onClose={closeMenu}
      />}
      {datePick && datePickTask && <DatePopover
        key={datePick.taskId}
        anchor={datePick.anchor}
        value={datePickTask.dueDate ?? ""}
        title={datePickTask.title}
        onChange={dueDate => void update(datePickTask._id, { dueDate })}
        onClose={restore => { const id = datePick.taskId; setDatePick(null); if (restore) focusCard(id); }}
      />}
      {deleting && <Dialog title="Delete issue" className="confirm-dialog" onClose={() => { const id = deleting._id; setDeleting(null); focusCard(id); }}>
        <div className="dialog-body">
          <p className="confirm-text"><span className="issue-key">{taskKey(deleting._id)}</span> {deleting.title}</p>
          <div className="dialog-actions">
            <button type="button" className="ghost-button compact" onClick={() => { const id = deleting._id; setDeleting(null); focusCard(id); }}>Cancel</button>
            <button type="button" className="primary-button danger compact" autoFocus disabled={!online} onClick={() => {
              const task = deleting;
              const next = neighbourOf(task._id);
              setDeleting(null);
              deleteTask({ projectId, sessionToken, taskId: task._id }).then(() => focusCard(next), report("Could not delete issue"));
            }}>Delete</button>
          </div>
        </div>
      </Dialog>}
      {columnDelete && <ColumnDeleteDialog column={columnDelete} columns={visualColumns} issueCount={board.tasks.filter(task => task.columnId === columnDelete._id).length} projectId={projectId} sessionToken={sessionToken} onClose={() => setColumnDelete(null)} />}
      {laneCreate && <IssueComposer sessionToken={sessionToken} activeProjectId={projectId} projects={[project]} initialColumnId={laneCreate} onClose={() => setLaneCreate(null)} onCreated={() => undefined} />}
      {selectedTaskId ? <TaskModal key={selectedTaskId} onOpenReference={(target, task) => { if (target === projectId && task) setSelectedTaskId(task); else { closeTask(); onOpenReference?.(target, task); } }} project={project} projectId={projectId} sessionToken={sessionToken} taskId={selectedTaskId} canEdit={canEdit} onClose={closeTask} /> : null}
      {toast && <BoardToast key={toast.id} toast={toast} onDismiss={() => setToast(null)} />}
    </section>
  );
}

function BoardToast({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return createPortal(<div className="board-toast" role="status">
    <span className="board-toast-icon">{toast.icon ?? <Check size={14} />}</span>
    <span>{toast.text}</span>
    {toast.undo && <button type="button" onClick={() => { toast.undo?.(); onDismiss(); }}>Undo</button>}
  </div>, document.body);
}

/** Lane ⋯ menu: rename in place, or delete (with a destination for its issues only when it has some). */
function LaneMenu({ title, canDelete, onRename, onDelete }: { title: string; canDelete: boolean; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current, button = trigger.current;
    if (!open || !element || !button) return;
    const box = button.getBoundingClientRect();
    Object.assign(element.style, { left: `${Math.max(8, Math.min(box.right - element.offsetWidth, window.innerWidth - element.offsetWidth - 8))}px`, top: `${box.bottom + 4}px` });
    element.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [open]);
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  return <>
    <button ref={trigger} className="icon-button" aria-label={`${title} column options`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={15} /></button>
    {open && createPortal(<div className="task-menu-layer" onContextMenu={event => { event.preventDefault(); close(false); }}>
      <MenuScrim onClose={() => close(false)} />
      <div ref={menu} role="menu" aria-label={`${title} column options`} className="origin-dropdown task-menu lane-menu" onKeyDown={event => {
        if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); close(); return; }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const all = [...(menu.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
        all[(all.indexOf(document.activeElement as HTMLElement) + (event.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
      }}>
        <button type="button" role="menuitem" onClick={() => { close(false); onRename(); }}><PencilLine size={14} /><span>Rename</span></button>
        {canDelete && <button type="button" role="menuitem" className="danger-text" onClick={() => { close(false); onDelete(); }}><Trash2 size={14} /><span>Delete column</span></button>}
      </div>
    </div>, document.body)}
  </>;
}

function ColumnDeleteDialog({ column, columns, issueCount, projectId, sessionToken, onClose }: { column: Column; columns: Column[]; issueCount: number; projectId: Id<"projects">; sessionToken: string; onClose: () => void }) {
  const online = useWorkspaceOnline();
  const others = columns.filter(c => c._id !== column._id);
  const [destination, setDestination] = useState<string>(others.find(c => !isDraftColumn(c))?._id ?? others[0]?._id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const remove = useMutation(api.tasks.deleteColumn);
  return <Dialog title={`Delete ${column.title}`} className="confirm-dialog" onClose={onClose}>
    <form className="dialog-body stack-form" onSubmit={async event => {
      event.preventDefault();
      if (!online || busy) return;
      setBusy(true);
      try { await remove({ projectId, sessionToken, columnId: column._id, ...(issueCount ? { moveToColumnId: destination as Id<"columns"> } : {}) }); onClose(); }
      catch (error) { setError(errorText(error, "Could not delete column")); }
      finally { setBusy(false); }
    }}>
      {issueCount > 0 && <label>Move {issueCount === 1 ? "its issue" : `its ${issueCount} issues`} to<select value={destination} onChange={event => setDestination(event.target.value)}>{others.map(c => <option key={c._id} value={c._id}>{c.title}</option>)}</select></label>}
      {error && <p className="notice danger">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="ghost-button compact" onClick={onClose}>Cancel</button>
        <button className="primary-button danger compact" autoFocus={!issueCount} title={!online ? RECONNECT_TO_CREATE : undefined} disabled={busy || !online}>Delete column</button>
      </div>
    </form>
  </Dialog>;
}
