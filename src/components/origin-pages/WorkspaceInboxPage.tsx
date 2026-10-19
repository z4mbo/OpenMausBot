import { useMemo, useState, type DragEvent } from "react";
import {
  AtSign, Bell, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, Inbox, List, Loader2, MessageSquare, Search, X,
} from "lucide-react";
import { cloudMutation, useCloudPages, useCloudQuery, type CloudProject } from "@/lib/origin-cloud";
import { useWorkspaceMembers } from "@/lib/origin-members";
import { useOpenOriginIssue } from "@/lib/origin-issue-focus";
import { useOpenOriginNotification } from "@/lib/origin-notification-open";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import type { Priority } from "./cloud-types";
import { errorText } from "./repo-url";
import { EmptyState, Loading, Notice, Segmented, ghostButton, iconButton, inputClass, type WorkspaceContext } from "./ui";
import { PersonAvatar } from "./PersonAvatar";
import { PriorityIcon } from "./issue-fields";

type InboxTask = {
  _id: string; projectId: string; title: string; priority: Priority; done: boolean; dueDate?: string;
  assignedToName?: string; assignedToEmail?: string; githubIssueNumber?: number; projectName: string;
};
type CalendarTask = { _id: string; projectId: string; title: string; dueDate: string; done: boolean; priority: Priority; projectName: string };
type Notification = {
  _id: string; kind: "assignment" | "comment" | "mention"; read: boolean; createdAt: number; projectId?: string; taskId?: string; messageId?: string;
  conversation?: string; agentThreadId?: string; preview?: string; actorName: string; actorAvatar: string | null; projectName?: string; taskTitle?: string; available: boolean;
};
type Filters = { mine: boolean; done: boolean; project: string; priority: "" | Priority; search: string };

const priorityTone: Record<Priority, string> = { low: "text-ink-tertiary", medium: "text-warning", high: "text-danger" };
const ISSUE_DRAG_TYPE = "application/x-origin-issue";

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function matches(task: { title: string; projectName: string; assignedToName?: string }, search: string): boolean {
  return `${task.title} ${task.projectName} ${task.assignedToName ?? ""}`.toLowerCase().includes(search.trim().toLowerCase());
}

export function WorkspaceInbox({ teamId, canEdit }: WorkspaceContext) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const [filters, setFilters] = useState<Filters>({ mine: true, done: false, project: "", priority: "", search: "" });
  const [notice, setNotice] = useState("");
  const projects = useCloudQuery<CloudProject[]>("projects:listForUser", { teamId });
  const openIssue = useOpenOriginIssue();
  const patch = (next: Partial<Filters>) => setFilters((current) => ({ ...current, ...next }));
  const open = (projectId: string, issueId: string) => {
    if (!openIssue({ projectId, issueId })) setNotice("That project has not reached this computer yet. It opens here after the next sync.");
  };
  const hasFilters = Boolean(filters.project || filters.priority || filters.search);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-[var(--glass-top,0px)] [scroll-padding-top:var(--glass-top,0px)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
        <Notifications teamId={teamId} onError={setNotice} />
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Issue ownership" value={filters.mine ? "mine" : "all"} onChange={(value) => patch({ mine: value === "mine" })}
            options={[{ value: "mine", label: "Assigned to me" }, { value: "all", label: "All issues" }]} />
          <Segmented label="Issue completion" value={filters.done ? "done" : "active"} onChange={(value) => patch({ done: value === "done" })}
            options={[{ value: "active", label: "Active" }, { value: "done", label: "Completed" }]} />
          <Segmented label="Issue view" value={view} onChange={setView}
            options={[{ value: "list", label: <><List size={13} />List</> }, { value: "calendar", label: <><CalendarDays size={13} />Calendar</> }]} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select size="sm" aria-label="Filter by project" value={filters.project} onChange={(event) => patch({ project: event.target.value })}>
              <option value="">All projects</option>
              {(projects ?? []).map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
            </Select>
            <Select size="sm" aria-label="Filter by priority" value={filters.priority} onChange={(event) => patch({ priority: event.target.value as Filters["priority"] })}>
              <option value="">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </Select>
            <label className="relative flex items-center">
              <Search size={13} className="pointer-events-none absolute left-2 text-ink-tertiary" aria-hidden="true" />
              <input type="search" className={cn(inputClass, "w-44 pl-7")} placeholder="Search issues" aria-label="Search loaded issues"
                value={filters.search} onChange={(event) => patch({ search: event.target.value })} />
            </label>
            {hasFilters && <button type="button" className={iconButton} aria-label="Clear filters" title="Clear filters" onClick={() => patch({ project: "", priority: "", search: "" })}><X size={14} /></button>}
          </div>
        </div>
        {notice && <Notice tone="danger">{notice}</Notice>}
        {view === "list"
          ? <IssueList teamId={teamId} projects={projects ?? []} filters={filters} canEdit={canEdit} onOpen={open} onError={setNotice} hasFilters={hasFilters} />
          : <IssueCalendar teamId={teamId} filters={filters} canEdit={canEdit} onOpen={open} onError={setNotice} />}
      </div>
    </div>
  );
}

function Notifications({ teamId, onError }: { teamId: string; onError(message: string): void }) {
  const openTarget = useOpenOriginNotification();
  const summary = useCloudQuery<{ unread: number; more: boolean }>("notifications:summary", { teamId });
  const [openState, setOpenState] = useState<boolean | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const unread = summary?.unread ?? 0;
  const expanded = openState ?? unread > 0;
  const { results, status, loadMore } = useCloudPages<Notification>("notifications:list", expanded ? { teamId, unreadOnly } : "skip", 30);
  const act = (work: Promise<unknown>, fallback: string) => void work.catch((error: unknown) => onError(errorText(error, fallback)));
  const mark = (id: string, read: boolean) => cloudMutation("notifications:markRead", { teamId, id, read });

  return (
    <section className="rounded-xl border border-hairline/40 bg-panel" aria-label="Notifications">
      <button type="button" aria-expanded={expanded} onClick={() => setOpenState(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13.5px] font-medium text-ink">
        <ChevronRight size={14} className={cn("text-ink-secondary transition-transform", expanded && "rotate-90")} aria-hidden="true" />
        <Bell size={14} aria-hidden="true" />Notifications
        {unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">{unread}{summary?.more ? "+" : ""}</span>}
      </button>
      {expanded && (
        <div className="border-t border-hairline/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Segmented label="Which notifications" value={unreadOnly ? "unread" : "all"} onChange={(value) => setUnreadOnly(value === "unread")}
              options={[{ value: "unread", label: "Unread" }, { value: "all", label: "All" }]} />
            <button type="button" className={cn(ghostButton, "ml-auto")} onClick={() => act(cloudMutation("notifications:markAll", { teamId }), "Could not mark notifications read")}>
              <CheckCheck size={14} />Mark all read
            </button>
          </div>
          {status === "loading" && !results.length && <Loading label="Loading notifications" variant="inline" />}
          {status !== "loading" && !results.length && <p className="py-4 text-center text-[13px] text-ink-secondary">{unreadOnly ? "No unread notifications" : "No notifications yet"}</p>}
          <ul className="flex flex-col">
            {results.map((row) => (
              <li key={row._id} className={cn("flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-raised/50", !row.read && "bg-raised/30")} data-notification={row._id}>
                <span className="mt-0.5 text-ink-secondary" aria-hidden="true">
                  {row.kind === "mention" ? <AtSign size={15} /> : row.kind === "comment" ? <MessageSquare size={15} /> : <Circle size={15} />}
                </span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => {
                  act(mark(row._id, true), "Could not open the notification");
                  if (openTarget(row) === "elsewhere") onError("That conversation has not reached this computer yet. It opens here after the next sync.");
                }}>
                  <span className="flex items-center gap-1.5 text-[13px] text-ink">
                    <PersonAvatar person={{ name: row.actorName, email: row.actorName, avatarUrl: row.actorAvatar }} size={18} />
                    <strong className="font-semibold">{row.actorName}</strong>
                    {row.kind === "mention" ? row.agentThreadId ? "tagged you in an agent thread" : row.messageId ? "tagged you in chat" : "mentioned you on" : row.kind === "comment" ? "commented on" : "assigned you"}
                    {!row.read && <span className="size-1.5 rounded-full bg-accent" aria-label="Unread" />}
                  </span>
                  {row.taskTitle && <span className="mt-0.5 block truncate text-[13px] font-medium text-ink">{row.taskTitle}</span>}
                  {row.preview && <span className="mt-0.5 block truncate text-[12.5px] text-ink-secondary">{row.preview}</span>}
                  <span className="mt-0.5 block text-[11.5px] text-ink-tertiary">
                    {row.projectName && `${row.projectName} · `}
                    <time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                    {!row.available && " · Issue removed"}
                  </span>
                </button>
                <Snooze onSnooze={(delay) => act(cloudMutation("notifications:snooze", { teamId, id: row._id, until: Date.now() + delay }), "Could not snooze the notification")} />
                <button type="button" className={iconButton} aria-label={row.read ? "Mark unread" : "Mark read"} title={row.read ? "Mark unread" : "Mark read"}
                  onClick={() => act(mark(row._id, !row.read), "Could not update the notification")}>
                  {row.read ? <Circle size={13} /> : <Check size={14} />}
                </button>
              </li>
            ))}
          </ul>
          {status === "more" && <button type="button" className={cn(ghostButton, "mt-2 w-full")} onClick={loadMore}>Load more</button>}
        </div>
      )}
    </section>
  );
}

const SNOOZE_OPTIONS = [
  { label: "In one hour", delay: 3_600_000 },
  { label: "Tomorrow", delay: 86_400_000 },
  { label: "In one week", delay: 7 * 86_400_000 },
] as const;

function Snooze({ onSnooze }: { onSnooze(delay: number): void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className={iconButton} aria-label="Snooze notification" title="Snooze" aria-expanded={open} onClick={() => setOpen(!open)}><Clock3 size={14} /></button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-20 flex w-36 flex-col rounded-lg border border-hairline/60 bg-menu p-1">
          {SNOOZE_OPTIONS.map((option) => (
            <button key={option.delay} type="button" role="menuitem" className="rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-raised"
              onClick={() => { setOpen(false); onSnooze(option.delay); }}>{option.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

type ViewProps = { teamId: string; filters: Filters; canEdit: boolean; onOpen(projectId: string, issueId: string): void; onError(message: string): void };

function IssueList({ teamId, projects, filters, canEdit, onOpen, onError, hasFilters }: ViewProps & { projects: readonly CloudProject[]; hasFilters: boolean }) {
  const members = useWorkspaceMembers(teamId);
  const [pending, setPending] = useState<string | null>(null);
  const { results, status, loadMore } = useCloudPages<InboxTask>("inbox:list", {
    teamId, mine: filters.mine, done: filters.done,
    ...(filters.project ? { projectId: filters.project } : {}), ...(filters.priority ? { priority: filters.priority } : {}),
  }, 50);
  const today = localDay(new Date());
  const rows = results.filter((task) => matches(task, filters.search));
  const toggle = async (task: InboxTask) => {
    if (!task.done && (task.githubIssueNumber || projects.some((project) => project._id === task.projectId && project.repoUrl))) {
      onOpen(task.projectId, task._id);
      return;
    }
    setPending(task._id);
    try {
      await cloudMutation("tasks:updateTask", { projectId: task.projectId, taskId: task._id, done: !task.done });
    } catch (error) {
      onError(errorText(error, "Could not update the issue"));
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <Activity teamId={teamId} mine={filters.mine} project={filters.project} />
      {status === "loading" && !results.length ? <Loading label="Loading issues" variant="list" /> : !rows.length ? (
        <EmptyState icon={<Inbox size={26} />} title={hasFilters ? "No matching issues" : filters.done ? "No completed issues yet" : "You're all caught up"} />
      ) : (
        <ul className="flex flex-col divide-y divide-hairline/30 rounded-xl border border-hairline/40 bg-panel" aria-label="Issues">
          {rows.map((task) => {
            const assignee = members?.find((member) => member.email === task.assignedToEmail);
            const overdue = Boolean(task.dueDate && task.dueDate < today && !task.done);
            return (
              <li key={task._id} className="flex items-center gap-2 px-2 py-1.5" data-inbox-issue={task._id}>
                <button type="button" className={iconButton} disabled={!canEdit || pending === task._id}
                  aria-label={`${task.done ? "Reopen" : "Complete"} ${task.title}`} title={task.done ? "Reopen issue" : "Complete issue"} onClick={() => void toggle(task)}>
                  {pending === task._id ? <Loader2 size={15} className="animate-spin" /> : task.done ? <CheckCircle2 size={15} className="text-success" /> : <Circle size={15} />}
                </button>
                <button type="button" className="min-w-0 flex-1 truncate text-left text-[13.5px] text-ink hover:underline" onClick={() => onOpen(task.projectId, task._id)}>
                  {task.title}{task.githubIssueNumber ? <span className="ml-1.5 text-[12px] text-ink-tertiary">#{task.githubIssueNumber}</span> : null}
                </button>
                <span className="hidden max-w-[160px] truncate text-[12px] text-ink-secondary sm:inline">{task.projectName}</span>
                <span className="w-6" title={assignee?.name ?? task.assignedToName ?? "Unassigned"}>
                  {assignee && <PersonAvatar person={assignee} size={20} />}
                </span>
                <time dateTime={task.dueDate} className={cn("w-16 text-right text-[12px] tabular-nums", overdue ? "text-danger" : "text-ink-secondary")}>
                  {task.dueDate ? new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date"}
                </time>
                <span className="flex w-16 items-center gap-1 text-[12px] capitalize text-ink-secondary" title={`${task.priority} priority`}>
                  <PriorityIcon priority={task.priority} size={13} />{task.priority}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {status === "more" && <button type="button" className={ghostButton} onClick={loadMore}>Load more issues</button>}
    </>
  );
}

function Activity({ teamId, mine, project }: { teamId: string; mine: boolean; project: string }) {
  const today = localDay(new Date());
  const range = useMemo(() => {
    const end = new Date(`${today}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 182);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { since: start.getTime(), until: end.getTime() };
  }, [today]);
  const activity = useCloudQuery<{ events: { completedAt: number; projectId: string }[]; truncated: boolean }>("inbox:activity", { teamId, mine, ...range });
  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of activity?.events ?? []) {
      if (project && event.projectId !== project) continue;
      const key = localDay(new Date(event.completedAt));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const list: { date: string; count: number }[] = [];
    for (const date = new Date(range.since); date.getTime() < range.until; date.setDate(date.getDate() + 1)) {
      const key = localDay(date);
      list.push({ date: key, count: counts.get(key) ?? 0 });
    }
    return list;
  }, [activity, range, project]);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const levels = ["bg-raised", "bg-success/30", "bg-success/50", "bg-success/75", "bg-success"];
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline/40 bg-panel px-3 py-2.5" aria-label="Completion activity">
      <span className="flex items-center gap-1.5 text-[13px] text-ink">
        <CheckCircle2 size={15} className="text-success" aria-hidden="true" />
        <strong>{total}{activity?.truncated ? "+" : ""}</strong>
        <span className="text-ink-secondary">completed in the last 6 months</span>
      </span>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div role="img" aria-label={`${total} completed issues in the last six months`} className="grid w-max grid-flow-col grid-rows-7 gap-[3px]">
          {days.map((day) => <span key={day.date} title={`${day.date}: ${day.count} completed`} className={cn("size-[9px] rounded-[2px]", levels[Math.min(day.count, 4)])} />)}
        </div>
      </div>
    </section>
  );
}

function IssueCalendar({ teamId, filters, canEdit, onOpen, onError }: ViewProps) {
  const [anchor, setAnchor] = useState(() => localDay(new Date()));
  const [mode, setMode] = useState<"week" | "month">("week");
  const [pending, setPending] = useState(false);
  const current = new Date(`${anchor}T12:00:00`);
  const start = new Date(current);
  if (mode === "month") start.setDate(1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const length = mode === "month" ? 42 : 7;
  const days = Array.from({ length }, (_, index) => { const date = new Date(start); date.setDate(date.getDate() + index); return date; });
  const calendar = useCloudQuery<{ tasks: CalendarTask[]; truncated: boolean }>("inbox:calendar", { teamId, start: localDay(days[0]!), end: localDay(days.at(-1)!), mine: filters.mine });
  const today = localDay(new Date());
  const move = (amount: number) => {
    const date = new Date(current);
    if (mode === "month") { date.setDate(1); date.setMonth(date.getMonth() + amount); } else date.setDate(date.getDate() + amount * 7);
    setAnchor(localDay(date));
  };
  const drop = async (event: DragEvent, key: string) => {
    event.preventDefault();
    if (pending || !canEdit || !calendar) return;
    const task = calendar.tasks.find((candidate) => candidate._id === event.dataTransfer.getData(ISSUE_DRAG_TYPE));
    if (!task || task.dueDate === key) return;
    setPending(true);
    try {
      await cloudMutation("tasks:updateTask", { projectId: task.projectId, taskId: task._id, dueDate: key });
    } catch (error) {
      onError(errorText(error, "Could not reschedule the issue"));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Issue calendar">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ghostButton} onClick={() => setAnchor(localDay(new Date()))}><CalendarDays size={14} />Today</button>
        <Segmented label="Calendar range" value={mode} onChange={setMode} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        <button type="button" className={iconButton} aria-label="Previous period" title="Previous period" onClick={() => move(-1)}><ChevronLeft size={16} /></button>
        <span className="text-[13.5px] font-medium text-ink">{current.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <button type="button" className={iconButton} aria-label="Next period" title="Next period" onClick={() => move(1)}><ChevronRight size={16} /></button>
      </div>
      {calendar?.truncated && <Notice>Showing the first 500 scheduled issues. Use the list for the complete workload.</Notice>}
      {!calendar ? <Loading label="Loading the calendar" /> : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-7" aria-busy={pending}>
          {days.map((date) => {
            const key = localDay(date);
            const tasks = calendar.tasks.filter((task) => task.dueDate === key && task.done === filters.done
              && (!filters.project || task.projectId === filters.project) && (!filters.priority || task.priority === filters.priority) && matches(task, filters.search));
            return (
              <section key={key} aria-label={date.toLocaleDateString(undefined, { dateStyle: "full" })}
                onDragOver={(event) => { if (canEdit) event.preventDefault(); }} onDrop={(event) => void drop(event, key)}
                className={cn("flex min-h-[96px] flex-col gap-1 rounded-lg border border-hairline/40 bg-panel p-1.5",
                  mode === "month" && date.getMonth() !== current.getMonth() && "opacity-50", key === today && "border-accent/60")}>
                <time dateTime={key} className="flex items-baseline gap-1 px-0.5 text-[11.5px] text-ink-secondary">
                  {date.toLocaleDateString(undefined, { weekday: "short" })}<strong className={cn("text-[13px] text-ink", key === today && "text-accent")}>{date.getDate()}</strong>
                </time>
                {tasks.map((task) => (
                  <button key={task._id} type="button" title={task.title} draggable={canEdit && !pending}
                    onDragStart={(event) => event.dataTransfer.setData(ISSUE_DRAG_TYPE, task._id)} onClick={() => onOpen(task.projectId, task._id)}
                    className={cn("flex items-start gap-1 rounded-md bg-raised/60 px-1.5 py-1 text-left hover:bg-raised", task.done && "opacity-60")}>
                    {task.done ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-success" /> : <Circle size={12} className={cn("mt-0.5 shrink-0", priorityTone[task.priority])} />}
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-ink">{task.title}</span>
                      <span className="block truncate text-[11px] text-ink-tertiary">{task.projectName}</span>
                    </span>
                  </button>
                ))}
                {!tasks.length && <span className="px-0.5 text-[11px] text-ink-tertiary">No issues</span>}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
