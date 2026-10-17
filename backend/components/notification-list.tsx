"use client";
import { ContentSkeleton } from "./content-skeleton";
import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { AtSign, Bell, Check, CheckCheck, Circle, Clock3, MessageSquare } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "./workspace-context";
import { ProjectIcon } from "./project-icon";

export function NotificationList({ sessionToken, onOpenTask, onOpenChat }: { sessionToken: string; onOpenTask: (project: Id<"projects">, task: Id<"tasks">) => void; onOpenChat: (messageId: string) => void }) {
  const workspace = useWorkspace(), [unread, setUnread] = useState(true), [error, setError] = useState("");
  const scope = { sessionToken, teamId: workspace._id };
  const { results, status, loadMore } = usePaginatedQuery(api.notifications.list, { ...scope, unreadOnly: unread }, { initialNumItems: 30 });
  const mark = useMutation(api.notifications.markRead), all = useMutation(api.notifications.markAll);
  const snooze = useMutation(api.notifications.snooze);
  return <div className="notification-list">
    <div className="work-list-toolbar"><div className="segmented-control"><button className={unread ? "active" : ""} onClick={() => setUnread(true)}>Unread</button><button className={!unread ? "active" : ""} onClick={() => setUnread(false)}>All</button></div><button className="ghost-button compact notification-read-all" onClick={() => void all(scope).catch(() => setError("Could not mark notifications read"))}><CheckCheck size={15} />Mark all read</button></div>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {!results.length && <div className="work-empty">{status === "LoadingFirstPage" ? <ContentSkeleton label="Loading notifications" /> : <><Bell size={22} /><strong>{unread ? "No unread notifications" : "No notifications yet"}</strong></>}</div>}
    {results.map(n => <div className={`notification-row ${n.read ? "" : "unread"}`} key={n._id}>
      <span className="notification-kind">{n.kind === "mention" ? <AtSign size={16} /> : n.kind === "comment" ? <MessageSquare size={16} /> : <Circle size={16} />}</span>
      <button className="notification-content" onClick={async () => { try { await mark({ ...scope, id: n._id, read: true }); if (n.messageId) onOpenChat(n.messageId); else if (n.available && n.projectId && n.taskId) onOpenTask(n.projectId, n.taskId); } catch { setError("Could not open notification"); } }}>
        <span><strong>{n.actorName}</strong> {n.kind === "mention" ? n.messageId ? "tagged you in chat" : "mentioned you on" : n.kind === "comment" ? "commented on" : "assigned you"}</span>
        {n.taskTitle && <strong>{n.taskTitle}</strong>}{n.preview && <p>{n.preview}</p>}
        <small>{n.projectName && <><ProjectIcon project={n} size={13} />{n.projectName}<span> / </span></>}<time dateTime={new Date(n.createdAt).toISOString()}>{new Date(n.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>{!n.available && " / Issue removed"}</small>
      </button>
      <details className="notification-snooze"><summary className="icon-button" title="Snooze notification" aria-label="Snooze notification"><Clock3 size={15} /></summary><div className="notification-snooze-menu">{[{ label: "In one hour", delay: 3600000 }, { label: "Tomorrow", delay: 86400000 }, { label: "In one week", delay: 7 * 86400000 }].map(option => <button key={option.delay} onClick={event => {
        event.currentTarget.closest("details")?.removeAttribute("open");
        void snooze({ ...scope, id: n._id, until: Date.now() + option.delay }).catch(() => setError("Could not snooze notification"));
      }}>{option.label}</button>)}</div></details>
      <button className="icon-button" title={n.read ? "Mark unread" : "Mark read"} aria-label={n.read ? "Mark unread" : "Mark read"} onClick={() => void mark({ ...scope, id: n._id, read: !n.read }).catch(() => setError("Could not update notification"))}>{n.read ? <Circle size={13} /> : <Check size={15} />}</button>
    </div>)}
    {(status === "CanLoadMore" || status === "LoadingMore") && <button className="ghost-button work-load-more" disabled={status === "LoadingMore"} onClick={() => loadMore(30)}>Load more</button>}
  </div>;
}
