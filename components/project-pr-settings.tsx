"use client";
import { errorText } from "@/lib/error-text";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

export function ProjectPRSettings({ project, sessionToken }: { project: Doc<"projects">; sessionToken: string }) {
  const columns = useQuery(api.taskPRs.columns, { sessionToken, projectId: project._id });
  const configure = useMutation(api.taskPRs.configure);
  const [mode, setMode] = useState<"issue" | "pull_request">(project.githubTaskMode ?? "issue");
  const [review, setReview] = useState(project.githubReviewColumnId === undefined ? "" : project.githubReviewColumnId ?? "none");
  const [done, setDone] = useState(project.githubDoneColumnId ?? "auto");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  return <form className="stack-form settings-section" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setNotice("");
    try { await configure({ sessionToken, projectId: project._id, mode, reviewColumnId: !review ? undefined : review === "none" ? null : review as Id<"columns">, doneColumnId: done === "auto" ? undefined : done as Id<"columns"> }); setNotice("Task GitHub settings saved"); }
    catch (error) { setNotice(errorText(error, "Could not save settings")); }
    finally { setBusy(false); }
  }}><h3>Tasks on GitHub</h3><label>Create tasks as<select value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="issue">GitHub issues (default)</option><option value="pull_request">Draft pull requests with task branches</option></select></label>
    <label>In review column<select value={review} required={mode === "pull_request"} onChange={e => setReview(e.target.value)}><option value="" disabled>Choose a column or keep the current column</option><option value="none">Keep current column</option>{columns?.filter(c => !c.isDone).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
    <label>Done column on merge<select value={done} onChange={e => setDone(e.target.value)}><option value="auto">Use Done (create if missing)</option>{columns?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
    <p className="muted">Choose Create on a task to mirror it. PR tasks are completed when their PR merges. Drafts start with a task plan commit.</p><button className="primary-button compact" disabled={busy || !columns}>Save task GitHub settings</button>{notice && <p role="status">{notice}</p>}
  </form>;
}
