"use client";
import { errorText } from "@/lib/error-text";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { CalendarDays, List, ChevronRight, CheckCircle2, Circle, Inbox, Loader2, Search, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "./workspace-context";
import { ProjectIcon } from "./project-icon";
import { NotificationList } from "./notification-list";
import { ContentSkeleton } from "./content-skeleton";
import { UserAvatar, memberName } from "./user-avatar";
import { useMemberProfile } from "./workspace-context";
import { InboxCalendar } from "./inbox-calendar";
import { PriorityIcon } from "./priority-icon";
import { GitHubIssueIndicator } from "./github-issue-indicator";
import { IssueSelect } from "./issue-select";

function localDay(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

export function InboxView({ sessionToken, onOpenTask, onOpenChat, unread, onOpenProject, mode }: { sessionToken: string; onOpenTask: (projectId: Id<"projects">, taskId: Id<"tasks">) => void; onOpenChat: (messageId: string) => void; unread: number; onOpenProject: (projectId: Id<"projects">) => void; mode?: "assigned" | "completed" }) {
  const workspace = useWorkspace();
  const openMember = useMemberProfile();
  const members = useQuery(api.workspaces.members, { sessionToken, teamId: workspace._id });
  const [section, setSection] = useState<"issues" | "calendar">("issues");
  const [notificationsOpen, setNotificationsOpen] = useState(unread > 0);
  const hasUnread = unread > 0;
  useEffect(() => { setNotificationsOpen(hasUnread); }, [hasUnread]);
  const [mine, setMine] = useState(true);
  const [done, setDone] = useState(mode === "completed");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState<"" | "low" | "medium" | "high">("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const closeSearch = () => { setSearchOpen(false); searchButton.current?.focus(); };
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const projects = useQuery(api.projects.listForUser, { sessionToken, teamId: workspace._id });
  const { results, status, loadMore } = usePaginatedQuery(api.inbox.list, {
    sessionToken, teamId: workspace._id, mine, done,
    projectId: project ? project as Id<"projects"> : undefined, priority: priority || undefined,
  }, { initialNumItems: 50 });
  const update = useMutation(api.tasks.updateTask);
  const today = localDay(new Date());
  const range = useMemo(() => {
    const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1);
    const start = new Date(end); start.setDate(start.getDate() - 182);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { since: start.getTime(), until: end.getTime() };
  }, [today]);
  const activity = useQuery(api.inbox.activity, { sessionToken, teamId: workspace._id, mine, ...range });
  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of activity?.events || []) {
      if (project && event.projectId !== project) continue;
      const day = localDay(new Date(event.completedAt)); counts.set(day, (counts.get(day) || 0) + 1);
    }
    const days: { date: string; count: number; month: string }[] = [];
    for (const date = new Date(range.since); date.getTime() < range.until; date.setDate(date.getDate() + 1)) {
      const key = localDay(date);
      days.push({ date: key, count: counts.get(key) || 0, month: date.getDate() <= 7 && date.getDay() === 1 ? date.toLocaleDateString(undefined, { month: "short" }) : "" });
    }
    return days;
  }, [activity, range, project]);
  const filtered = results.filter(task => `${task.title} ${task.projectName} ${task.assignedToName || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const hasFilters = Boolean(project || priority || search);
  return <section className={`work-inbox ${section === "calendar" ? "calendar-inbox" : ""}`} aria-label="Inbox">
    {!mode && <header className="view-header"><h1>Inbox</h1></header>}
    {!mode && <details className="inbox-notifications" open={notificationsOpen}><summary onClick={event => { event.preventDefault(); setNotificationsOpen(open => !open); }}><ChevronRight size={14} />Notifications{unread > 0 && <span className="notification-count">{unread}</span>}</summary><NotificationList sessionToken={sessionToken} onOpenTask={onOpenTask} onOpenChat={onOpenChat} /></details>}
    <div className="work-toolbar">
      <div className="segmented-control" aria-label="Issue ownership"><button className={mine ? "active" : ""} aria-pressed={mine} onClick={() => setMine(true)}>Assigned to me</button><button className={!mine ? "active" : ""} aria-pressed={!mine} onClick={() => setMine(false)}>All issues</button></div>
      {!mode && <div className="segmented-control" aria-label="Issue completion"><button className={!done ? "active" : ""} aria-pressed={!done} onClick={() => setDone(false)}>Active</button><button className={done ? "active" : ""} aria-pressed={done} onClick={() => setDone(true)}>Completed</button></div>}
      <div className="segmented-control inbox-view-switch" aria-label="Issue view"><button className={section === "issues" ? "active" : ""} aria-pressed={section === "issues"} onClick={() => setSection("issues")}><List size={14} />List</button><button className={section === "calendar" ? "active" : ""} aria-pressed={section === "calendar"} onClick={() => setSection("calendar")}><CalendarDays size={14} />Calendar</button></div>
      <div className="work-filters">
        <IssueSelect label="Filter by project" value={project} onChange={setProject} icon={<Circle size={14} />} options={[{ value: "", label: "All projects" }, ...(projects || []).map(p => ({ value: p._id, label: p.name, icon: <ProjectIcon project={p} size={14} /> }))]} />
        <IssueSelect label="Filter by priority" value={priority} onChange={value => setPriority(value as typeof priority)} icon={<PriorityIcon priority={priority} />} options={[{ value: "", label: "All priorities" }, ...(["high", "medium", "low"] as const).map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), icon: <PriorityIcon priority={value} /> }))]} />
        <div className="inbox-search-control"><button ref={searchButton} className={`icon-button ${search ? "selected" : ""}`} aria-label="Search issues" title="Search issues" aria-expanded={searchOpen} aria-controls="inbox-search-field" onClick={() => setSearchOpen(!searchOpen)}><Search size={16} /></button>{searchOpen && <div className="inbox-search-popover"><input id="inbox-search-field" autoFocus type="search" aria-label="Search loaded issues" placeholder="Search loaded issues" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Escape") closeSearch(); }} /><button className="icon-button" aria-label="Close search" onClick={closeSearch}><X size={14} /></button></div>}</div>
        {hasFilters && <button className="icon-button" title="Clear filters" aria-label="Clear filters" onClick={() => { setSearch(""); setPriority(""); setProject(""); }}><X size={14} /></button>}
      </div>
    </div>
    {section === "calendar" ? <InboxCalendar sessionToken={sessionToken} onOpenTask={onOpenTask} mine={mine} done={done} project={project} priority={priority} search={search} /> : <>
    <div className="activity-band">
      <div className="activity-summary"><CheckCircle2 size={16} /><strong>{days.reduce((n, day) => n + day.count, 0)}{activity?.truncated ? "+" : ""}</strong><span>completed in the last 6 months</span></div>
      <div className="activity-scroll" tabIndex={0} role="group" aria-label="Completion activity, last six months"><div className="activity-map" role="img" aria-label={`${days.reduce((n, day) => n + day.count, 0)} completed issues in the last six months`}>{days.map(day => <span key={day.date} data-level={Math.min(day.count, 4)} title={`${day.date}: ${day.count} completed`}>{day.month && <small>{day.month}</small>}</span>)}</div></div>
      <div className="activity-legend"><span>Less</span>{[0, 1, 2, 3, 4].map(n => <i key={n} data-level={n} />)}<span>More</span></div>
    </div>
    {notice && <div className="notice danger" role="alert">{notice}</div>}
    <div className="work-issue-list">
      {status === "LoadingFirstPage" ? <ContentSkeleton label="Loading issues" rows={6} /> : !filtered.length ? <div className="work-empty"><Inbox size={24} /><strong>{hasFilters ? "No matching issues" : done ? "No completed issues yet" : "You're all caught up"}</strong>{hasFilters && <button className="ghost-button compact" onClick={() => { setSearch(""); setPriority(""); setProject(""); }}>Clear filters</button>}</div> : filtered.map(task => <div className="work-issue-row" key={task._id}>
        <button className="icon-button work-complete" title={done ? "Reopen issue" : "Complete issue"} aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`} disabled={workspace.role === "viewer" || pending === task._id} onClick={async () => { setPending(task._id); setNotice(""); try { await update({ sessionToken, projectId: task.projectId, taskId: task._id, done: !task.done }); } catch (error) { setNotice(errorText(error, "Could not update issue")); } finally { setPending(null); } }}>{pending === task._id ? <Loader2 size={16} className="spin" /> : done ? <CheckCircle2 size={16} /> : <Circle size={16} />}</button>
        <button className="work-issue-main" onClick={() => onOpenTask(task.projectId, task._id)}><strong>{task.title}</strong><GitHubIssueIndicator number={task.githubIssueNumber} /></button><button className="work-project" title={`Open ${task.projectName}`} onClick={() => onOpenProject(task.projectId)}><ProjectIcon project={task} size={15} /><span>{task.projectName}</span></button>
        {(() => { const member = members?.find(member => member.email === task.assignedToEmail); return member ? <button className="work-assignee icon-button" title={memberName(member)} aria-label={`View ${memberName(member)} profile`} onClick={() => openMember(member.email)}><UserAvatar user={member} size="small" /></button> : <span className="work-assignee" />; })()}
        <time className={task.dueDate && task.dueDate < today && !done ? "overdue" : ""} dateTime={task.dueDate}>{task.dueDate ? new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</time>
        <span className={`work-priority priority ${task.priority}`}><PriorityIcon priority={task.priority} /><span>{task.priority}</span></span>
      </div>)}
    </div>
    {(status === "CanLoadMore" || status === "LoadingMore") && <button className="ghost-button work-load-more" disabled={status === "LoadingMore"} onClick={() => loadMore(50)}>{status === "LoadingMore" ? "Loading" : "Load more"}</button>}
    </>}
  </section>;
}
