"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { ExternalLink, GitPullRequest, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { localApi } from "@/lib/client-api";

export function TaskPullRequest({ project, taskId, sessionToken, canEdit, saveDraft }: { project: Doc<"projects">; taskId: Id<"tasks">; sessionToken: string; canEdit: boolean; saveDraft: () => Promise<unknown> }) {
  const prs = useQuery(api.taskPRs.list, { taskId, sessionToken });
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  return <div className="stack-form">
    {prs?.map(pr => <div key={pr._id}><a className="ghost-button compact" href={pr.url} target="_blank" rel="noreferrer"><GitPullRequest size={14} />PR #{pr.number}<ExternalLink size={13} /></a><small>{pr.state} · Checks: {pr.checks} · Review: {pr.review} · Mergeable: {pr.mergeable === undefined || pr.mergeable === null ? "unknown" : pr.mergeable ? "yes" : "no"}</small>{pr.headSha && <small>Head: <code title={pr.headSha}>{pr.headSha.slice(0, 8)}</code> · Base: <code title={pr.baseSha}>{pr.baseSha?.slice(0, 8)}</code></small>}</div>)}
    {prs?.length === 0 && canEdit && project.repoUrl && <button className="ghost-button compact" type="button" disabled={busy} onClick={async () => {
      setBusy(true); setNotice("");
      try { await saveDraft(); const result = await localApi<{ message: string }>("/api/github/pull-requests", sessionToken, { method: "POST", json: { projectId: project._id, taskId } }); setNotice(result.message); }
      catch (error) { setNotice(error instanceof Error ? error.message : "Could not create PR"); }
      finally { setBusy(false); }
    }}>{busy ? <Loader2 size={14} className="spin" /> : <GitPullRequest size={14} />}{busy ? "Creating PR…" : project.githubTaskMode === "pull_request" ? "Create draft PR" : "Create PR instead of GitHub issue"}</button>}
    {notice && <small role="status">{notice}</small>}
  </div>;
}
