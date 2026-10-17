"use client";
import { ContentSkeleton } from "./content-skeleton";

import { useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { CheckCircle2, Circle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog } from "./dialog";
import { useWorkspace } from "./workspace-context";
import { UserAvatar } from "./user-avatar";

export function MemberProfile({ email, sessionToken, onClose, onOpenIssue }: { email: string; sessionToken: string; onClose: () => void; onOpenIssue: (projectId: Id<"projects">, taskId: Id<"tasks">) => void }) {
  const workspace = useWorkspace();
  const [done, setDone] = useState(false);
  const profile = useQuery(api.memberProfiles.get, { sessionToken, teamId: workspace._id, email });
  const { results, status, loadMore } = usePaginatedQuery(api.memberProfiles.issues, profile ? { sessionToken, teamId: workspace._id, email, done } : "skip", { initialNumItems: 30 });
  return <Dialog title="Member profile" className="member-profile-dialog" onClose={onClose}>
    <div className="dialog-body member-profile-body">
      {profile === undefined ? <ContentSkeleton label="Loading profile" /> : !profile ? <p>This member is no longer in the workspace.</p> : <>
        <header className="member-profile-header">
          <UserAvatar user={profile} className="member-profile-avatar" />
          <div><h3>{profile.name}</h3>{profile.username && <p>@{profile.username}</p>}<a href={`mailto:${profile.email}`}>{profile.email}</a><small>{profile.role} · Joined {new Date(profile.joinedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</small></div>
        </header>
        <div className="member-issue-tabs" role="tablist" aria-label="Assigned issues" onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? false : event.key === "End" ? true : !done; setDone(next); document.getElementById(next ? "member-completed-tab" : "member-todo-tab")?.focus(); } }}>
          <button role="tab" aria-selected={!done} aria-controls="member-issues" id="member-todo-tab" className={!done ? "active" : ""} onClick={() => setDone(false)}><Circle size={14} />To do</button>
          <button role="tab" aria-selected={done} aria-controls="member-issues" id="member-completed-tab" className={done ? "active" : ""} onClick={() => setDone(true)}><CheckCircle2 size={14} />Completed</button>
        </div>
        <div id="member-issues" role="tabpanel" aria-labelledby={done ? "member-completed-tab" : "member-todo-tab"} className="member-profile-issues">
          {status === "LoadingFirstPage" ? <ContentSkeleton label="Loading issues" rows={3} /> : !results.length && status === "Exhausted" ? <p className="member-profile-empty">{done ? "No completed issues yet." : "No issues to do. All clear."}</p> : null}
          {results.map(issue => <button className="member-profile-issue" key={issue._id} onClick={() => { onClose(); onOpenIssue(issue.projectId, issue._id); }}>
            {done ? <CheckCircle2 size={16} className="completed-issue-icon" /> : <Circle size={16} />}
            <span><strong>{issue.title}</strong><small><i style={{ backgroundColor: issue.accent }} />{issue.projectName}{issue.dueDate && ` · Due ${issue.dueDate}`}</small></span><small className={`priority-label priority-${issue.priority}`}>{issue.priority}</small>
          </button>)}
          {(status === "CanLoadMore" || status === "LoadingMore") && <button className="ghost-button full" disabled={status === "LoadingMore"} onClick={() => loadMore(30)}>{status === "LoadingMore" ? "Loading..." : "Load more issues"}</button>}
        </div>
      </>}
    </div>
  </Dialog>;
}
