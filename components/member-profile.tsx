"use client";
import { ContentSkeleton } from "./content-skeleton";

import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog } from "./dialog";
import { useWorkspace } from "./workspace-context";
import { UserAvatar } from "./user-avatar";
import { PriorityIcon } from "./issue-icons";
import { LOCALE, displayName, formatDue } from "@/lib/format";
import { errorText } from "@/lib/error-text";
import { CompleteCheck } from "./issue-card";

export function MemberProfile({ email, sessionToken, onClose, onOpenIssue }: { email: string; sessionToken: string; onClose: () => void; onOpenIssue: (projectId: Id<"projects">, taskId: Id<"tasks">) => void }) {
  const workspace = useWorkspace();
  const [done, setDone] = useState(false);
  const profile = useQuery(api.memberProfiles.get, { sessionToken, teamId: workspace._id, email });
  const { results, status, loadMore } = usePaginatedQuery(api.memberProfiles.issues, profile ? { sessionToken, teamId: workspace._id, email, done } : "skip", { initialNumItems: 30 });
  const update = useMutation(api.tasks.updateTask);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const toggle = async (issue: { _id: Id<"tasks">; projectId: Id<"projects">; done: boolean }) => {
    setPending(issue._id); setNotice("");
    try { await update({ sessionToken, projectId: issue.projectId, taskId: issue._id, done: !issue.done }); }
    catch (error) { setNotice(errorText(error, "Could not update issue")); }
    finally { setPending(null); }
  };
  return <Dialog title="Member profile" className="member-profile-dialog" onClose={onClose}>
    <div className="dialog-body member-profile-body">
      {profile === undefined ? <ContentSkeleton label="Loading profile" /> : !profile ? <p>This member is no longer in the workspace.</p> : <>
        <header className="member-profile-header">
          <UserAvatar user={profile} className="member-profile-avatar" />
          <div><h3>{displayName(profile)}</h3><p>{profile.username && <span>@{profile.username}</span>}<a href={`mailto:${profile.email}`}>{profile.email}</a></p><small>{profile.role[0].toUpperCase() + profile.role.slice(1)} · Joined {new Date(profile.joinedAt).toLocaleDateString(LOCALE, { month: "short", year: "numeric" })}</small></div>
        </header>
        <div className="member-issue-tabs segmented-control" role="tablist" aria-label="Assigned issues" onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? false : event.key === "End" ? true : !done; setDone(next); document.getElementById(next ? "member-completed-tab" : "member-todo-tab")?.focus(); } }}>
          <button role="tab" aria-selected={!done} aria-controls="member-issues" id="member-todo-tab" className={!done ? "active" : ""} onClick={() => setDone(false)}>To do</button>
          <button role="tab" aria-selected={done} aria-controls="member-issues" id="member-completed-tab" className={done ? "active" : ""} onClick={() => setDone(true)}>Completed</button>
        </div>
        <div id="member-issues" role="tabpanel" aria-labelledby={done ? "member-completed-tab" : "member-todo-tab"} className="member-profile-issues">
          {status === "LoadingFirstPage" ? <ContentSkeleton label="Loading issues" rows={3} /> : !results.length && status === "Exhausted" ? <p className="member-profile-empty">{done ? "No completed issues" : "No open issues"}</p> : null}
          {notice && <p className="notice danger" role="alert">{notice}</p>}
          {results.map(issue => {
            const isPending = pending === issue._id;
            return <div className={`member-profile-issue ${isPending && !issue.done ? "is-completing" : ""}`} key={issue._id}>
              <CompleteCheck className="member-issue-check" task={issue} done={isPending ? !issue.done : issue.done} reopen canEdit={workspace.role !== "viewer" && !pending} onComplete={toggle} />
              <button type="button" className="member-profile-issue-main" onClick={() => { onClose(); onOpenIssue(issue.projectId, issue._id); }}>
                <span><strong>{issue.title}</strong><small><i style={{ backgroundColor: issue.accent }} />{issue.projectName}{(() => { const due = formatDue(issue.dueDate); return due ? <><span aria-hidden="true">·</span><span className={issue.done ? "" : `due-${due.tone}`}>{due.label}</span></> : null; })()}</small></span><span className={`member-issue-priority priority ${issue.priority}`} title={`${issue.priority[0].toUpperCase()}${issue.priority.slice(1)} priority`}><PriorityIcon priority={issue.priority} /><span className="sr-only">{issue.priority} priority</span></span>
              </button>
            </div>;
          })}
          {(status === "CanLoadMore" || status === "LoadingMore") && <button className="ghost-button full" disabled={status === "LoadingMore"} onClick={() => loadMore(30)}>{status === "LoadingMore" ? "Loading..." : "Load more"}</button>}
        </div>
      </>}
    </div>
  </Dialog>;
}
