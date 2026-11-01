"use client";
import { ContentSkeleton } from "./content-skeleton";
import { useEffect, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { AtSign, Bell, Check, CheckCheck, Clock3, Loader2, MessageSquare, UserPlus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { displayName, formatDateTime, formatRelative } from "@/lib/format";
import { useWorkspace } from "./workspace-context";
import { ProjectIcon } from "./project-icon";

const snoozeOptions = [{ label: "In one hour", delay: 3600000 }, { label: "Tomorrow", delay: 86400000 }, { label: "Next week", delay: 7 * 86400000 }];

export function NotificationList({ sessionToken, onOpenTask, onOpenChat }: { sessionToken: string; onOpenTask: (project: Id<"projects">, task: Id<"tasks">) => void; onOpenChat: (messageId: string) => void }) {
  const workspace = useWorkspace(), [unread, setUnread] = useState(true), [error, setError] = useState("");
  const scope = { sessionToken, teamId: workspace._id };
  const { results, status, loadMore } = usePaginatedQuery(api.notifications.list, { ...scope, unreadOnly: unread }, { initialNumItems: 30 });
  const members = useQuery(api.workspaces.members, scope);
  const mark = useMutation(api.notifications.markRead), all = useMutation(api.notifications.markAll);
  const snooze = useMutation(api.notifications.snooze);
  const [markingAll, setMarkingAll] = useState(false);
  useEffect(() => {
    // Snooze menus are <details>; close them on an outside press or Escape like every other menu.
    const closeMenus = (keep?: EventTarget | null) => document.querySelectorAll<HTMLDetailsElement>(".notification-snooze[open]").forEach(menu => { if (!(keep instanceof Node && menu.contains(keep))) menu.open = false; });
    const press = (event: PointerEvent) => closeMenus(event.target);
    const key = (event: KeyboardEvent) => {
      const open = document.querySelector<HTMLDetailsElement>(".notification-snooze[open]");
      if (event.key !== "Escape" || !open) return;
      event.preventDefault(); closeMenus(); open.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", press);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", press); document.removeEventListener("keydown", key); };
  }, []);
  // Notifications carry the actor's username (or name when there is none); show the person's full name.
  const actor = (name: string) => { const member = members?.find(member => member.username === name || member.name === name); return member ? displayName(member) : name; };
  return <div className="notification-list">
    <div className="work-list-toolbar">
      <div className="segmented-control" role="group" aria-label="Notifications shown"><button className={unread ? "active" : ""} aria-pressed={unread} onClick={() => setUnread(true)}>Unread</button><button className={!unread ? "active" : ""} aria-pressed={!unread} onClick={() => setUnread(false)}>All</button></div>
      {unread && results.length > 0 && <button className="ghost-button compact notification-read-all" disabled={markingAll} onClick={() => { setMarkingAll(true); void all(scope).catch(() => setError("Could not mark notifications read")).finally(() => setMarkingAll(false)); }}>{markingAll ? <Loader2 size={14} className="spin" /> : <CheckCheck size={14} />}Mark all read</button>}
    </div>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {!results.length && <div className="work-empty">{status === "LoadingFirstPage" ? <ContentSkeleton label="Loading notifications" rows={2} /> : <><Bell size={18} /><strong>{unread ? "No unread notifications" : "No notifications"}</strong></>}</div>}
    {results.length > 0 && <ul className="notification-rows">{results.map(n => <li className={`notification-row ${n.read ? "" : "unread"}`} key={n._id}>
      <span className="notification-kind" aria-hidden="true">{n.kind === "mention" ? <AtSign size={15} /> : n.kind === "comment" ? <MessageSquare size={15} /> : <UserPlus size={15} />}</span>
      <button className="notification-content" onClick={async () => { try { await mark({ ...scope, id: n._id, read: true }); if (n.messageId) onOpenChat(n.messageId); else if (n.available && n.projectId && n.taskId) onOpenTask(n.projectId, n.taskId); } catch { setError("Could not open notification"); } }}>
        <span className="notification-line"><strong>{actor(n.actorName)}</strong> {n.kind === "mention" ? n.messageId ? "mentioned you in chat" : "mentioned you on" : n.kind === "comment" ? "commented on" : "assigned you"}{n.taskTitle && <> <em>{n.taskTitle}</em></>}</span>
        {n.preview && <span className="notification-preview">{n.preview}</span>}
        <span className="notification-meta">{n.projectName && <><ProjectIcon project={n} size={12} /><span>{n.projectName}</span><span aria-hidden="true">·</span></>}<time dateTime={new Date(n.createdAt).toISOString()} title={formatDateTime(n.createdAt)}>{formatRelative(n.createdAt)}</time>{!n.available && <><span aria-hidden="true">·</span><span>Issue removed</span></>}</span>
      </button>
      <span className="notification-actions">
        <details className="notification-snooze"><summary className="icon-button" title="Snooze" aria-label="Snooze notification"><Clock3 size={15} /></summary><div className="notification-snooze-menu origin-dropdown">{snoozeOptions.map(option => <button key={option.delay} onClick={event => {
          event.currentTarget.closest("details")?.removeAttribute("open");
          void snooze({ ...scope, id: n._id, until: Date.now() + option.delay }).catch(() => setError("Could not snooze notification"));
        }}>{option.label}</button>)}</div></details>
        <button className="icon-button" title={n.read ? "Mark unread" : "Mark read"} aria-label={n.read ? "Mark unread" : "Mark read"} onClick={() => void mark({ ...scope, id: n._id, read: !n.read }).catch(() => setError("Could not update notification"))}>{n.read ? <span className="unread-dot-outline" /> : <Check size={15} />}</button>
      </span>
    </li>)}</ul>}
    {(status === "CanLoadMore" || status === "LoadingMore") && <button className="ghost-button compact work-load-more" disabled={status === "LoadingMore"} onClick={() => loadMore(30)}>Load more</button>}
  </div>;
}
