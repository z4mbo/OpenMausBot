import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Activity, Check, ChevronDown, FolderInput, MessagesSquare, Pencil, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import { useStore, type Bot, type BotProject, type Group, type Task } from "@/state/store";
import { cn } from "@/lib/cn";
import { roomThreadsWorkingElsewhere } from "@/lib/room-threads";
import { useMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
import { COMPACT_BUBBLE } from "@/lib/compact-chip";
import { formatTaskTokens, headlineTokens, usageDetail } from "@/lib/usage";
import { nextRename } from "@/lib/rename";
import { FolderIcon, NewThreadButton } from "./BotProjects";
import { useShowThreads } from "@/lib/thread-preferences";
import { attentionJumpAction, attentionOwnerName, AttentionThreadRows, crossBotAttentionThreads, threadsWhenTreeHidden, type AttentionThread } from "./SidebarBotActivity";
import { formatUpdatedAt, orderedThreadList, threadByline, threadRecency, threadUpdatedLabel, useRelativeNow } from "./SidebarThreadRow";
import { Select } from "./Select";

export const TASK_PICKER_DISMISS_MS = 500;
export const THREAD_SEARCH_MIN = 8;
const THREAD_MENU_WIDTH = 352;

export function threadMenuPosition(trigger: { left: number; bottom: number }, viewport: { width: number; height: number }) {
  const width = Math.max(0, Math.min(THREAD_MENU_WIDTH, viewport.width - 16));
  const left = Math.max(8, Math.min(trigger.left, viewport.width - width - 8));
  const top = Math.max(8, Math.min(trigger.bottom + 8, viewport.height - 160));
  return { left, top, width, maxHeight: Math.max(160, viewport.height - top - 16) };
}

function moveOptionFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-thread-option]")];
  if (!options.length) return;
  event.preventDefault();
  const index = options.findIndex((option) => option === document.activeElement);
  const next = event.key === "Home" ? 0
    : event.key === "End" ? options.length - 1
    : event.key === "ArrowDown" ? (index + 1) % options.length
    : (index <= 0 ? options.length : index) - 1;
  options[next]?.focus();
}


/** The click that accompanies a dblclick has detail >= 2 and must not switch or close. */
export function taskPickerPointerIntent(
  type: string,
  detail = 1,
): "select" | "rename" | "ignore" {
  if (type === "dblclick" || type === "contextmenu") return "rename";
  if (type === "click" && detail >= 2) return "ignore";
  if (type === "click") return "select";
  return "ignore";
}

export function filterTasks<T extends { title: string }>(tasks: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...tasks];
  const prefix: T[] = [];
  const substring: T[] = [];
  for (const task of tasks) {
    const title = task.title.toLowerCase();
    if (title.startsWith(needle)) prefix.push(task);
    else if (title.includes(needle)) substring.push(task);
  }
  return [...prefix, ...substring];
}

function TaskUpdatedTime({ task, now }: { task: { updatedAt?: number; createdAt?: number }; now: number }) {
  const stamp = threadRecency(task);
  if (!Number.isFinite(stamp) || stamp <= 0) return null;
  return <time dateTime={new Date(stamp).toISOString()} title={formatUpdatedAt(stamp)}>{threadUpdatedLabel(stamp, now)}</time>;
}

function TaskUsage({ usage }: { usage: Task["usage"] }) {
  if (!usage) return null;
  const label = formatTaskTokens(headlineTokens(usage));
  if (!label) return null;
  return (
    <span
      title={usageDetail(usage)}
    >
      {" · "}
      {label}
    </span>
  );
}

type PickerTask = Pick<Task, "threadId" | "title" | "createdAt" | "updatedAt" | "pinned" | "busy" | "activity" | "unread" | "projectId" | "openedBy" | "closedBy" | "archivedAt" | "snoozedUntil" | "waitingForTeammates"> & { usage?: Task["usage"] };

export function groupThreadTasks(tasks: PickerTask[], projects: BotProject[], query: string) {
  const needle = query.trim().toLowerCase();
  return [...projects, { id: "", name: t("folder.none") } as BotProject].map((project) => {
    const members = tasks.filter((task) => project.id ? task.projectId === project.id : !projects.some((item) => item.id === task.projectId));
    return { project, tasks: project.name.toLowerCase().includes(needle) ? members : filterTasks(members, query) };
  }).filter((group) => group.tasks.length > 0);
}

function ConversationTaskPicker({
  threadId,
  tasks,
  busy,
  bot,
  onNew,
  onSwitch,
  onRename,
  onDelete,
  onMove,
  onPin,
  attention,
  onAttentionJump,
  workingElsewhere = 0,
  variant = "count",
}: {
  variant?: "count" | "title";
  threadId: string;
  tasks: PickerTask[];
  busy: boolean;
  workingElsewhere?: number;
  bot?: Bot;
  onNew: () => void;
  onSwitch: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onDelete: (threadId: string) => void;
  onMove?: (threadId: string, projectId: string | null) => void;
  onPin?: (threadId: string, pinned: boolean) => void;
  attention?: AttentionThread[];
  onAttentionJump?: (entry: AttentionThread) => void;
}) {
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof threadMenuPosition> | null>(null);
  const titled = variant === "title";
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishingRename = useRef(false);
  const now = useRelativeNow();

  const current = tasks.find((t) => t.threadId === threadId);

  const clearDismiss = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  };

  const closeMenu = () => {
    clearDismiss();
    setRenaming(null);
    setQuery("");
    setOpen(false);
    triggerRef.current?.focus();
  };

  const queueDismiss = () => {
    clearDismiss();
    dismissTimer.current = setTimeout(() => {
      dismissTimer.current = null;
      setRenaming(null);
      setOpen(false);
    }, TASK_PICKER_DISMISS_MS);
  };

  const startRename = (task: PickerTask) => {
    clearDismiss();
    finishingRename.current = false;
    setDraft(task.title);
    setRenaming(task.threadId);
  };

  useEffect(() => () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  useEffect(() => {
    if (!open) {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setRenaming(null);
      setQuery("");
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-thread-overlay]")) return;
      // SAFETY: a mousedown target inside a document is always a DOM Node
      if (!ref.current?.contains(e.target as Node)) {
        if (dismissTimer.current) {
          clearTimeout(dismissTimer.current);
          dismissTimer.current = null;
        }
        setRenaming(null);
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.target instanceof Element && e.target.closest("[data-thread-overlay]")) return;
      if (renaming) return;
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setRenaming(null);
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, renaming]);

  useLayoutEffect(() => {
    if (!open || !titled || !triggerRef.current) return;
    const button = triggerRef.current;
    const update = () => {
      const next = threadMenuPosition(button.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
      setPosition((current) => current && current.left === next.left && current.top === next.top && current.width === next.width && current.maxHeight === next.maxHeight ? current : next);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, titled]);

  const commitRename = (threadId: string, save: boolean) => {
    // Escape unmounts the input, which fires blur; without this guard blur would save the cancelled draft.
    if (finishingRename.current) return;
    finishingRename.current = true;
    const currentTitle = tasks.find((task) => task.threadId === threadId)?.title ?? "";
    const title = save ? nextRename(currentTitle, draft) : null;
    setRenaming(null);
    if (title) onRename(threadId, title);
  };

  const u = current?.usage;
  const currentLabel = u ? formatTaskTokens(headlineTokens(u)) : null;
  const switchTitle =
    u && currentLabel
      ? t("task.switchWithUsageDetail", {
          label: currentLabel,
          detail: usageDetail(u),
        })
      : t("task.switch");
  const grouped = bot ? groupThreadTasks(tasks, bot.projects ?? [], query) : null;
  const visible = grouped ? grouped.flatMap((group) => group.tasks) : filterTasks(tasks, query);
  const attentionNeedle = query.trim().toLowerCase();
  const attentionRows = (attention ?? []).filter((entry) =>
    !attentionNeedle || entry.task.title.toLowerCase().includes(attentionNeedle) || attentionOwnerName(entry).toLowerCase().includes(attentionNeedle));
  const looking = query.trim();
  const results = [...attentionRows.map((entry) => ({ kind: "attention" as const, entry })), ...visible.map((task) => ({ kind: "task" as const, task }))];

  const searchable = !titled || tasks.length + (attention?.length ?? 0) >= THREAD_SEARCH_MIN;
  const currentTitle = current?.title.trim() || t("task.list");
  const workingDot = workingElsewhere > 0 && (
    <span
      role="img"
      data-working-elsewhere={workingElsewhere}
      aria-label={t("task.workingElsewhere", { count: workingElsewhere })}
      title={t("task.workingElsewhere", { count: workingElsewhere })}
      className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent"
    />
  );
  const toggle = () => {
    if (open) closeMenu();
    else setOpen(true);
  };
  const menuReady = open && (!titled || position !== null);
  useEffect(() => {
    if (!menuReady || searchable) return;
    const list = listRef.current;
    const target = list?.querySelector<HTMLElement>("[data-thread-option][aria-current=true]") ?? list?.querySelector<HTMLElement>("[data-thread-option]");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [menuReady, searchable]);

  return (
    <div className={cn("relative", titled && "flex min-w-0")} ref={ref}>
      {titled ? (
        <button
          ref={triggerRef}
          type="button"
          data-chathead-thread
          onClick={toggle}
          title={switchTitle}
          aria-label={t("task.currentThread", { title: currentTitle })}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            "flex h-9 min-w-0 max-w-[15rem] items-center gap-2 rounded-full border border-hairline/50 bg-control/50 pl-3.5 pr-3 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-raised-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus @max-[30rem]/chathead:max-w-[11rem] @max-[30rem]/chathead:gap-1.5 @max-[30rem]/chathead:pl-3 @max-[30rem]/chathead:pr-2.5",
            open && "bg-raised-hover text-ink",
          )}
        >
          <MessagesSquare size={14} aria-hidden="true" className="shrink-0 opacity-80 @max-[30rem]/chathead:hidden" />
          <span dir="auto" className="min-w-0 truncate">{currentTitle}</span>
          {workingDot}
          <ChevronDown size={13} aria-hidden="true" className={cn("shrink-0 opacity-70 transition-transform", open && "rotate-180")} />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          title={switchTitle}
          aria-label={t("task.switch")}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            "flex max-w-[220px] items-center gap-1.5 rounded-full border border-hairline/40 px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink",
            COMPACT_BUBBLE,
          )}
        >
          <span className="truncate @max-4xl/chathead:hidden">{t("task.switch")}</span>
          <span className="shrink-0 tabular-nums opacity-60 @max-4xl/chathead:opacity-100">{tasks.length}</span>
          {workingDot}
          <ChevronDown size={12} className="shrink-0 @max-4xl/chathead:hidden" />
        </button>
      )}

      {motion.shown && (!titled || position) && (
        <div
          role="dialog"
          aria-label={t("task.list")}
          data-thread-menu
          style={titled && position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : undefined}
          className={cn(
            "z-40 flex flex-col overflow-hidden rounded-2xl border border-hairline/50 bg-menu p-1.5",
            titled ? "fixed" : "absolute right-0 top-full mt-1 w-[300px]",
            motion.className,
          )}
          {...motion.exitProps}
        >
          {titled && (
            <div className="flex items-baseline justify-between gap-2 px-2.5 pb-1.5 pt-1">
              <span className="text-[12px] font-medium text-ink">{t("task.list")}</span>
              <span className="text-[11px] tabular-nums text-ink-tertiary">{tasks.length}</span>
            </div>
          )}
          {searchable && <div className="pb-1.5">
            <div className="flex items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 focus-within:border-focus">
              <Search size={13} className="shrink-0 text-ink-secondary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (looking) setQuery("");
                    else closeMenu();
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    listRef.current?.querySelector<HTMLElement>("[data-thread-option]")?.focus();
                    return;
                  }
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    const first = results[0];
                    if (!first) return;
                    if (first.kind === "attention") onAttentionJump?.(first.entry);
                    else if (first.task.threadId !== threadId) onSwitch(first.task.threadId);
                    closeMenu();
                  }
                }}
                placeholder={t("task.search")}
                aria-label={t("task.search")}
                className="w-full bg-transparent text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
              />
            </div>
          </div>}
          <div ref={listRef} onKeyDown={moveOptionFocus} className={cn("min-h-0 overflow-y-auto", !titled && "max-h-[320px]")} role="group" aria-label={looking ? t("task.matching", { count: results.length }) : t("task.list")}>
            {attentionRows.length > 0 && <div className="pb-1">
              <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-ink-secondary"><Activity size={12} />{t("attention.title")}</div>
              <AttentionThreadRows entries={attentionRows} onJump={(entry) => { onAttentionJump?.(entry); closeMenu(); }} />
            </div>}
            {results.length === 0 ? (
              <div className="px-3 py-6 text-center text-[13px] text-ink-secondary">
                {t("task.noMatch", { query: looking })}
              </div>
            ) : visible.map((task, index) => {
              const active = task.threadId === threadId;
              const opener = threadByline(task);
              const heading = grouped?.find((group) => group.tasks[0]?.threadId === task.threadId)?.project;
              return (
                <Fragment key={task.threadId}>
                {bot?.projects?.length && heading ? <div className={cn("flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] font-medium text-ink-secondary", index > 0 && "mt-1 border-t border-hairline/30")}>{heading.id && <FolderIcon emoji={heading.emoji} size={12} />}{heading.name}</div> : null}
                <div
                  className={cn("group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors", active ? "bg-control/70" : "hover:bg-control/40")}
                >
                  <Check size={13} className={cn("shrink-0", active ? "text-accent" : "opacity-0")} />
                  {renaming === task.threadId ? (
                    <input
                      autoFocus
                      value={draft}
                      maxLength={80}
                      aria-label={t("task.renameAria")}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onBlur={() => commitRename(task.threadId, true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          e.stopPropagation();
                          commitRename(task.threadId, true);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          commitRename(task.threadId, false);
                        }
                      }}
                      className="min-w-0 flex-1 rounded bg-inset px-1.5 py-0.5 text-[13px] text-ink focus:outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        if (taskPickerPointerIntent("click", e.detail) !== "select") return;
                        if (!active) onSwitch(task.threadId);
                        queueDismiss();
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(task);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(task);
                      }}
                      data-thread-option
                      aria-current={active || undefined}
                      className="min-w-0 flex-1 rounded-md py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      title={t("task.renameHint")}
                    >
                      <div dir="auto" className={cn("truncate text-[13px] text-ink", active && "font-medium")}>{task.title}</div>
                      <div className="truncate text-[11px] text-ink-secondary">
                        {task.activity === "waiting-on-you" ? `${t("task.waiting")} · ` : task.waitingForTeammates ? `${t("task.waitingOnTeammate")} · ` : task.busy ? `${t("chat.activity.working")} · ` : task.unread ? `${t("task.unread")} · ` : ""}
                        <TaskUpdatedTime task={task} now={now} />
                        <TaskUsage usage={task.usage} />
                        {opener && ` · ${opener}`}
                      </div>
                    </button>
                  )}
                  {onPin && renaming !== task.threadId && (
                    <button
                      type="button"
                      onClick={() => onPin(task.threadId, task.pinned !== true)}
                      aria-label={task.pinned === true ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")}
                      title={task.pinned === true ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")}
                      className="rounded-md p-1 text-ink-secondary opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-70"
                    >
                      {task.pinned === true ? <PinOff size={13} /> : <Pin size={13} />}
                    </button>
                  )}
                  {renaming !== task.threadId && (
                    <button
                      type="button"
                      onClick={() => startRename(task)}
                      aria-label={t("task.renameNamed", { title: task.title })}
                      title={t("task.renameTitle")}
                      className="rounded-md p-1 text-ink-secondary opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-70"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {bot && onMove && (bot.projects?.length ?? 0) > 0 && <label title={t("folder.move")} className="relative rounded p-1 text-ink-secondary opacity-0 hover:bg-raised hover:text-ink focus-within:opacity-100 group-hover:opacity-100 touch:opacity-70">
                    <FolderInput size={13} />
                    <select aria-label={t("folder.moveNamed", { title: task.title })} value={bot.projects?.some((project) => project.id === task.projectId) ? task.projectId : ""}
                      onFocus={clearDismiss} onChange={(event) => { clearDismiss(); onMove(task.threadId, event.target.value || null); }}
                      className="absolute inset-0 w-full cursor-pointer opacity-0">
                      <option value="">{t("folder.none")}</option>
                      {bot.projects?.map((project) => <option key={project.id} value={project.id}>{project.emoji ? `${project.emoji} ` : ""}{project.name}</option>)}
                    </select>
                  </label>}
                  <button
                    type="button"
                    onClick={() => onDelete(task.threadId)}
                    disabled={Boolean(task.busy) || busy && active}
                    aria-label={t("task.deleteAria")}
                    title={t("task.deleteTitle")}
                    className="rounded-md p-1 text-ink-secondary opacity-0 hover:bg-raised hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-20 touch:opacity-70 touch:disabled:opacity-20"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                </Fragment>
              );
            })}
          </div>
          <div className="mt-1 shrink-0 border-t border-hairline/40 pt-1">
          {bot ? <NewThreadButton bot={bot} onCreated={closeMenu} className="w-full text-[13px] hover:bg-control/50" /> : <button
            type="button"
            onClick={() => {
              onNew();
              closeMenu();
            }}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-control/50 disabled:opacity-40"
          >
            <Plus size={13} className="text-ink-secondary" /> {t("task.newShort")}
          </button>}
          </div>
        </div>
      )}
    </div>
  );
}

export function BotActivityPicker({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  if (showThreads) return null;
  const activity = threadsWhenTreeHidden(bot, state.pendingQueued).filter((task) => task.threadId !== bot.threadId);
  if (!activity.length) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 px-5 py-2" data-background-activity>
      <Select variant="pill" size="sm" className="max-w-[180px] shrink-0"
        aria-label={t("task.otherActivity", { count: activity.length })}
        value=""
        onChange={(event) => dispatch({ type: "switchTask", botId: bot.id, threadId: event.target.value })}
      >
        <option value="" disabled>{t("task.otherActivity", { count: activity.length })}</option>
        {activity.map((task) => <option key={task.threadId} value={task.threadId}>
          {task.title} · {task.activity === "waiting-on-you" ? t("task.waiting") : task.waitingForTeammates ? t("task.waitingOnTeammate") : task.busy || task.activity === "working" ? t("chat.activity.working") : task.queued ? t("task.queued") : t("task.unread")}
        </option>)}
      </Select>
      <span dir="auto" className="truncate text-[12px] text-ink-secondary">{bot.tasks?.find((task) => task.threadId === bot.threadId)?.title}</span>
    </div>
  );
}

export function TaskPicker({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  if (!showThreads) return null;
  return (
    <ConversationTaskPicker
      variant="title"
      threadId={bot.threadId}
      tasks={orderedThreadList((bot.tasks ?? []).filter((task) => !task.routineRunId))}
      busy={false}
      bot={bot}
      attention={crossBotAttentionThreads(state.bots, state.pendingQueued, bot.id, state.groups)}
      onNew={() => dispatch({ type: "newTask", botId: bot.id })}
      onSwitch={(threadId) => dispatch({ type: "switchTask", botId: bot.id, threadId })}
      onRename={(threadId, title) => dispatch({ type: "renameTask", botId: bot.id, threadId, title })}
      onDelete={(threadId) => dispatch({ type: "deleteTask", botId: bot.id, threadId })}
      onMove={(threadId, projectId) => dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { projectId } })}
      onPin={(threadId, pinned) => dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { pinned } })}
      onAttentionJump={(entry) => dispatch(attentionJumpAction(entry))}
    />
  );
}

export function GroupTaskPicker({ group }: { group: Group }) {
  const { dispatch } = useStore();
  const tasks = useMemo(() => {
    return (group.tasks ?? []).map((task) => ({
      ...task,
      busy: Boolean(task.working || task.busyBotId),
    }));
  }, [group.tasks]);
  return (
    <ConversationTaskPicker
      threadId={group.threadId}
      tasks={orderedThreadList(tasks)}
      busy={false}
      workingElsewhere={roomThreadsWorkingElsewhere(group)}
      onNew={() => dispatch({ type: "newGroupTask", groupId: group.id })}
      onSwitch={(threadId) => dispatch({ type: "switchGroupTask", groupId: group.id, threadId })}
      onRename={(threadId, title) => dispatch({ type: "renameGroupTask", groupId: group.id, threadId, title })}
      onDelete={(threadId) => dispatch({ type: "deleteGroupTask", groupId: group.id, threadId })}
      onPin={(threadId, pinned) => {
        const title = group.tasks?.find((task) => task.threadId === threadId)?.title ?? "";
        dispatch({ type: "pinGroupTask", groupId: group.id, threadId, pinned, title });
      }}
    />
  );
}
