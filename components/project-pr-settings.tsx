"use client";
import { errorText } from "@/lib/error-text";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

export function ProjectPRSettings({ project, sessionToken }: { project: Doc<"projects">; sessionToken: string }) {
  const columns = useQuery(api.taskPRs.columns, { sessionToken, projectId: project._id });
  const configure = useMutation(api.taskPRs.configure);
  const [mode, setMode] = useState<"issue" | "pull_request">(project.githubTaskMode ?? "issue");
  const [review, setReview] = useState(project.githubReviewColumnId === undefined ? "" : project.githubReviewColumnId ?? "none");
  const [done, setDone] = useState(project.githubDoneColumnId ?? "auto");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [failed, setFailed] = useState(false);
  return <form className="repo-settings-section" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setNotice(""); setFailed(false);
    try { await configure({ sessionToken, projectId: project._id, mode, reviewColumnId: !review ? undefined : review === "none" ? null : review as Id<"columns">, doneColumnId: done === "auto" ? undefined : done as Id<"columns"> }); setNotice("Saved"); }
    catch (error) { setFailed(true); setNotice(errorText(error, "Could not save settings")); }
    finally { setBusy(false); }
  }}><h3>Issues on GitHub</h3>
    <label>Create issues as<select value={mode} onChange={e => { setMode(e.target.value as typeof mode); setNotice(""); }}><option value="issue">GitHub issues</option><option value="pull_request">Draft pull requests</option></select></label>
    {mode === "pull_request" && <label>Review column<select value={review} required={mode === "pull_request"} onChange={e => { setReview(e.target.value); setNotice(""); }}><option value="" disabled>Choose a column</option><option value="none">Keep current column</option>{columns?.filter(c => !c.isDone).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}
    <label>Column on merge<select value={done} onChange={e => { setDone(e.target.value); setNotice(""); }}><option value="auto">Done</option>{columns?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
    {failed && <p className="notice danger" role="alert">{notice}</p>}
    <div className="repo-settings-actions">{!failed && notice && <span className="repo-settings-saved" role="status">{notice}</span>}<button className="primary-button compact" disabled={busy || !columns}>{busy && <Loader2 className="spin" size={13} />}Save</button></div>
  </form>;
}
