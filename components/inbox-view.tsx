"use client";
import { errorText } from "@/lib/error-text";
import { formatDate, formatDue } from "@/lib/format";
import { focusQuietly } from "@/lib/initial-focus";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { CalendarDays, List, ChevronRight, Circle, Inbox, Loader2, Search, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "./workspace-context";
import { ProjectIcon } from "./project-icon";
import { NotificationList } from "./notification-list";
import { ContentSkeleton } from "./content-skeleton";
import { UserAvatar, memberName } from "./user-avatar";
import { useMemberProfile } from "./workspace-context";
import { InboxCalendar } from "./inbox-calendar";
import { PriorityIcon } from "./issue-icons";
import { GitHubIssueIndicator } from "./github-issue-indicator";
import { IssueSelect } from "./issue-select";
import { CompleteCheck } from "./issue-card";

const phoneQuery = "(max-width: 760px)";
const subscribePhone = (change: () => void) => { const query = matchMedia(phoneQuery); query.addEventListener("change", change); return () => query.removeEventListener("change", change); };
/** Phones show notifications and issues one at a time; wider screens stack them. */
function usePhoneLayout() {
  return useSyncExternalStore(subscribePhone, () => matchMedia(phoneQuery).matches, () => false);
}

export function InboxView({ sessionToken, onOpenTask, onOpenChat, unread, onOpenProject }: { sessionToken: string; onOpenTask: (projectId: Id<"projects">, taskId: Id<"tasks">) => void; onOpenChat: (messageId: string) => void; unread: number; onOpenProject: (projectId: Id<"projects">) => void }) {
  const workspace = useWorkspace();
  const openMember = useMemberProfile();
  const members = useQuery(api.workspaces.members, { sessionToken, teamId: workspace._id });
  const [section, setSection] = useState<"issues" | "calendar">("issues");
  const [notificationsOpen, setNotificationsOpen] = useState(unread > 0);
  const hasUnread = unread > 0;
  useEffect(() => { setNotificationsOpen(hasUnread); }, [hasUnread]);
  const phone = usePhoneLayout();
  // Unread notifications come first; once shown, reading the last one does not switch the section away.
  const [chosenPane, setPane] = useState<"notifications" | "issues" | null>(hasUnread ? "notifications" : null);
  useEffect(() => { if (hasUnread) setPane(current => current ?? "notifications"); }, [hasUnread]);
  const pane = chosenPane ?? "issues";
  const [mine, setMine] = useState(true);
  const [done, setDone] = useState(false);
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState<"" | "low" | "medium" | "high">("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const closeSearch = () => { setSearchOpen(false); focusQuietly(searchButton.current); };
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const projects = useQuery(api.projects.listForUser, { sessionToken, teamId: workspace._id });
  const { results, status, loadMore } = usePaginatedQuery(api.inbox.list, {
    sessionToken, teamId: workspace._id, mine, done,
    projectId: project ? project as Id<"projects"> : undefined, priority: priority || undefined,
  }, { initialNumItems: 50 });
  const update = useMutation(api.tasks.updateTask);
  const filtered = results.filter(task => `${task.title} ${task.projectName} ${task.assignedToName || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const hasFilters = Boolean(project || priority || search);
  const clearFilters = () => { setSearch(""); setPriority(""); setProject(""); };
  const notifications = <NotificationList sessionToken={sessionToken} onOpenTask={onOpenTask} onOpenChat={onOpenChat} />;
  return <section className={`work-inbox ${section === "calendar" && !(phone && pane === "notifications") ? "calendar-inbox" : ""}`} aria-label="Inbox">
    <header className="view-header"><h1>Inbox</h1></header>
    {phone ? <div className="segmented-control inbox-pane-switch" role="group" aria-label="Inbox section">
      <button className={pane === "notifications" ? "active" : ""} aria-pressed={pane === "notifications"} onClick={() => setPane("notifications")}>Notifications{unread > 0 && <span className="notification-count">{unread}</span>}</button>
      <button className={pane === "issues" ? "active" : ""} aria-pressed={pane === "issues"} onClick={() => setPane("issues")}>Issues</button>
    </div>
    : <details className="inbox-notifications" open={notificationsOpen}><summary onClick={event => { event.preventDefault(); setNotificationsOpen(open => !open); }}><ChevronRight size={14} />Notifications{unread > 0 && <span className="notification-count">{unread}</span>}</summary>{notificationsOpen && notifications}</details>}
    {phone && pane === "notifications" ? notifications : <>
    <div className="work-toolbar">
      <div className="work-toolbar-modes">
        <div className="segmented-control" role="group" aria-label="Issue ownership"><button className={mine ? "active" : ""} aria-pressed={mine} aria-label="Assigned to me" onClick={() => setMine(true)}><span className="label-long">Assigned to me</span><span className="label-short">Mine</span></button><button className={!mine ? "active" : ""} aria-pressed={!mine} aria-label="All issues" onClick={() => setMine(false)}><span className="label-long">All issues</span><span className="label-short">All</span></button></div>
        <div className="segmented-control" role="group" aria-label="Issue completion"><button className={!done ? "active" : ""} aria-pressed={!done} onClick={() => setDone(false)}>Active</button><button className={done ? "active" : ""} aria-pressed={done} aria-label="Completed" onClick={() => setDone(true)}><span className="label-long">Completed</span><span className="label-short">Done</span></button></div>
        <div className="segmented-control inbox-view-switch" role="group" aria-label="Issue view"><button className={section === "issues" ? "active" : ""} aria-pressed={section === "issues"} aria-label="List" onClick={() => setSection("issues")}><List size={14} /><span className="label-long">List</span></button><button className={section === "calendar" ? "active" : ""} aria-pressed={section === "calendar"} aria-label="Calendar" onClick={() => setSection("calendar")}><CalendarDays size={14} /><span className="label-long">Calendar</span></button></div>
      </div>
      <div className="work-filters">
        <IssueSelect label="Filter by project" value={project} onChange={setProject} icon={<Circle size={14} />} options={[{ value: "", label: "All projects" }, ...(projects || []).map(p => ({ value: p._id, label: p.name, icon: <ProjectIcon project={p} size={14} /> }))]} caption="Project" />
        <IssueSelect label="Filter by priority" value={priority} onChange={value => setPriority(value as typeof priority)} icon={<PriorityIcon priority={priority} />} options={[{ value: "", label: "All priorities" }, ...(["high", "medium", "low"] as const).map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), icon: <PriorityIcon priority={value} /> }))]} caption="Priority" />
        <div className="inbox-search-control"><button ref={searchButton} className={`icon-button ${search ? "selected" : ""}`} aria-label="Search issues" title="Search issues" aria-expanded={searchOpen} aria-controls="inbox-search-field" onClick={() => setSearchOpen(!searchOpen)}><Search size={16} /></button>{searchOpen && <div className="inbox-search-popover"><input id="inbox-search-field" autoFocus type="search" aria-label="Search loaded issues" placeholder="Search issues" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Escape") closeSearch(); }} /><button className="icon-button" aria-label="Close search" onClick={closeSearch}><X size={14} /></button></div>}</div>
        {hasFilters && <button className="icon-button" title="Clear filters" aria-label="Clear filters" onClick={clearFilters}><X size={14} /></button>}
      </div>
      {search && !searchOpen && <button type="button" className="filter-chip" aria-label={`Clear search ${search}`} onClick={() => setSearch("")}><Search size={12} /><span>{search}</span><X size={12} /></button>}
    </div>
    {section === "calendar" ? <InboxCalendar sessionToken={sessionToken} onOpenTask={onOpenTask} mine={mine} done={done} project={project} priority={priority} search={search} /> : <>
    {notice && <div className="notice danger" role="alert">{notice}</div>}
    <div className="work-issue-list">
      {status === "LoadingFirstPage" ? <ContentSkeleton label="Loading issues" rows={6} /> : !filtered.length ? <div className="work-empty"><Inbox size={22} /><strong>{hasFilters ? "No matching issues" : done ? "No completed issues" : "You're all caught up"}</strong>{hasFilters && <button className="ghost-button compact" onClick={clearFilters}>Clear filters</button>}</div> : filtered.map(task => {
        const member = members?.find(member => member.email === task.assignedToEmail);
        const due = formatDue(task.dueDate);
        const isPending = pending === task._id;
        return <div className={`work-issue-row ${isPending ? "pending" : ""} ${isPending && !task.done ? "is-completing" : ""}`} key={task._id}>
          <CompleteCheck className="work-complete" task={task} done={isPending ? !task.done : task.done} reopen canEdit={workspace.role !== "viewer" && !pending} onComplete={async () => { setPending(task._id); setNotice(""); try { await update({ sessionToken, projectId: task.projectId, taskId: task._id, done: !task.done }); } catch (error) { setNotice(errorText(error, "Could not update issue")); } finally { setPending(null); } }} />
          <button className="work-issue-main" onClick={() => onOpenTask(task.projectId, task._id)}><strong>{task.title}</strong><GitHubIssueIndicator number={task.githubIssueNumber} /></button>
          <button className="work-project" onClick={() => onOpenProject(task.projectId)}><ProjectIcon project={task} size={14} /><span>{task.projectName}</span></button>
          {member ? <button className="work-assignee icon-button" title={memberName(member)} aria-label={`View ${memberName(member)} profile`} onClick={() => openMember(member.email)}><UserAvatar user={member} size="small" /></button> : <span className="work-assignee" />}
          <time className={due && !task.done ? `due-${due.tone}` : ""} dateTime={task.dueDate} title={task.dueDate ? `Due ${formatDate(new Date(`${task.dueDate}T12:00:00`))}` : undefined}>{due?.label}</time>
          <span className={`work-priority priority ${task.priority}`} title={`${task.priority[0].toUpperCase()}${task.priority.slice(1)} priority`}><PriorityIcon priority={task.priority} /><span className="sr-only">{task.priority} priority</span></span>
        </div>;
      })}
    </div>
    {(status === "CanLoadMore" || status === "LoadingMore") && <button className="ghost-button compact work-load-more" disabled={status === "LoadingMore"} onClick={() => loadMore(50)}>{status === "LoadingMore" ? <Loader2 size={14} className="spin" /> : null}Load more</button>}
    </>}
    </>}
  </section>;
}
