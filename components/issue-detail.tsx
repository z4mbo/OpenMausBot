"use client";
import { errorText } from "@/lib/error-text";
import { ErrorBoundary } from "./error-boundary";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import clsx from "clsx";
import { Check, CheckCircle2, ExternalLink, LinkIcon, Loader2, Paperclip, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { localApi } from "@/lib/client-api";
import { taskKey } from "../lib/project-issues";
import { IssueLabels, IssueRelations } from "./issue-relations";
import { ProjectIcon } from "./project-icon";
import { useWorkspace } from "./workspace-context";
import { LocalAttachment } from "./local-attachment";
import { TaskPullRequest } from "./task-pull-request";
import { Dialog } from "./dialog";
import { IssueFields } from "./issue-fields";
import { IssueCommentBody, IssueCommentComposer } from "./issue-comments";
import { IssueFileUpload } from "./issue-file-upload";
import { UserAvatar } from "./user-avatar";
import { LoadingState, fmtDate, type OpenReference, type ProjectWithUi } from "./issue-shared";


type Priority = "low" | "medium" | "high";

function relativeTime(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(timestamp);
}
function parseGitHubRepo(repoUrl?: string) {
  if (!repoUrl) return null;
  const value = repoUrl.trim();
  const shorthand = value.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/i, "") };
  const match = value.match(/github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#]|$)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}
function githubRepoLabel(repoUrl?: string) {
  const parsed = parseGitHubRepo(repoUrl);
  return parsed ? `${parsed.owner}/${parsed.repo}` : "No repository";
}
function githubRepoHref(repoUrl?: string) {
  const parsed = parseGitHubRepo(repoUrl);
  return parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : null;
}
function githubNewIssueHref(repoUrl: string | undefined, title = "", body = "") {
  const repoHref = githubRepoHref(repoUrl);
  if (!repoHref) return null;
  const params = new URLSearchParams();
  if (title.trim()) params.set("title", title.trim());
  if (body.trim()) params.set("body", body.trim());
  const query = params.toString();
  return `${repoHref}/issues/new${query ? `?${query}` : ""}`;
}

export function TaskModal(props: Parameters<typeof TaskModalContent>[0]) {
  return <ErrorBoundary resetKey={props.taskId} fallback={<Dialog title="Issue unavailable" onClose={props.onClose}><div className="dialog-body muted">This issue was deleted or you no longer have access to it.</div></Dialog>}><TaskModalContent {...props} /></ErrorBoundary>;
}

function TaskModalContent({
  project,
  projectId,
  sessionToken,
  taskId,
  canEdit,
  onClose,
  onOpenReference,
}: {
  project: ProjectWithUi;
  projectId: Id<"projects">;
  sessionToken: string;
  taskId: Id<"tasks">;
  canEdit: boolean;
  onClose: () => void;
  onOpenReference?: OpenReference;
}) {
  const details = useQuery(api.tasks.details, { projectId, sessionToken, taskId });
  const workspace = useWorkspace();
  const updateTask = useMutation(api.tasks.updateTask);
  const moveTask = useMutation(api.tasks.moveTask);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assignedToEmail, setAssignedToEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [columnId, setColumnId] = useState<Id<"columns"> | "">("");
  const [activityError, setActivityError] = useState("");
  const addAsset = useMutation(api.tasks.addAsset);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [githubState, setGithubState] = useState<"idle" | "creating" | "created" | "fallback" | "error">("idle");
  const [githubNotice, setGithubNotice] = useState("");
  const hydratedRef = useRef(false);
  const lastSaved = useRef({ title: "", description: "", priority: "medium" as Priority, assignedToEmail: "", dueDate: "" });
  const saving = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!details?.task) return;
    hydratedRef.current = false;
    setTitle(details.task.title);
    setDescription(details.task.description || "");
    setPriority(details.task.priority);
    setAssignedToEmail(details.task.assignedToEmail || "");
    setDueDate(details.task.dueDate || "");
    lastSaved.current = { title: details.task.title, description: details.task.description || "", priority: details.task.priority, assignedToEmail: details.task.assignedToEmail || "", dueDate: details.task.dueDate || "" };
    setColumnId(details.task.columnId);
    setSaveState("idle");
    setGithubState("idle");
    setGithubNotice("");
    const handle = window.setTimeout(() => { hydratedRef.current = true; }, 0);
    return () => window.clearTimeout(handle);
  }, [details?.task?._id]);

  const saveDraft = useCallback(() => {
    if (!canEdit || !hydratedRef.current) return Promise.resolve();
    const draft = { title: title.trim(), description, priority, assignedToEmail, dueDate };
    const save = saving.current.catch(() => {}).then(async () => {
      const patch: Partial<typeof draft> = {};
      for (const key of Object.keys(draft) as (keyof typeof draft)[]) {
        if (draft[key] !== lastSaved.current[key]) Object.assign(patch, { [key]: draft[key] });
      }
      if (!Object.keys(patch).length) return;
      if (!draft.title || patch.assignedToEmail === "" || patch.dueDate === "") {
        setSaveState("error"); throw new Error("Title, assignee and due date cannot be empty");
      }
      setSaveState("saving");
      try {
        await updateTask({ projectId, sessionToken, taskId, ...patch });
        lastSaved.current = draft; setSaveState("saved");
      } catch (error) { setSaveState("error"); throw error; }
    });
    saving.current = save;
    return save;
  }, [assignedToEmail, canEdit, description, dueDate, priority, projectId, sessionToken, taskId, title, updateTask]);
  useEffect(() => {
    if (!details?.task || !hydratedRef.current) return;
    const handle = window.setTimeout(() => { void saveDraft().catch(() => {}); }, 500);
    return () => window.clearTimeout(handle);
  }, [details?.task?._id, saveDraft]);
  const closeIssue = () => { void saveDraft().then(onClose).catch(error => setActivityError(errorText(error, "Could not save issue"))); };

  const changeColumn = async (value: string) => {
    if (!canEdit || !value) return;
    const nextColumnId = value as Id<"columns">;
    setColumnId(nextColumnId);
    setSaveState("saving");
    try {
      await moveTask({ projectId, sessionToken, taskId, columnId: nextColumnId });
      setSaveState("saved");
    } catch {
      setColumnId(details?.task.columnId || "");
      setSaveState("error");
    }
  };
  const openReference = (targetProject: Id<"projects">, targetTask?: Id<"tasks">) => { void saveDraft().then(() => { if (onOpenReference) { onOpenReference(targetProject, targetTask); return; } const url = new URL(window.location.href); url.search = new URLSearchParams({ project: targetProject, ...(targetTask ? { issue: targetTask } : {}) }).toString(); window.location.href = url.toString(); }).catch(() => setSaveState("error")); };
  const activity = details ? [...details.comments.map((item) => ({ kind: "comment" as const, at: item.createdAt, item })), ...details.assets.filter(item => !item.commentId).map((item) => ({ kind: "asset" as const, at: item.createdAt, item }))].sort((a, b) => a.at - b.at) : [];
  const linkedGitHubAsset = details?.assets.find((asset) => asset.url.includes("github.com") && /\/issues\/\d+/.test(asset.url));
  const linkedGitHubUrl = details?.task.githubIssueUrl || linkedGitHubAsset?.url;
  const githubIssueHref = details?.task
    ? githubNewIssueHref(
        project.repoUrl,
        details.task.title,
        [details.task.description, `Origin issue: ${taskKey(details.task._id)}`].filter(Boolean).join("\n\n"),
      )
    : null;
  const createGitHubIssue = async () => {
    if (!details?.task || !canEdit || !project.repoUrl) return;
    setGithubState("creating");
    setGithubNotice("");
    try {
      await saveDraft();
      const result = await localApi<{ ok: boolean; issueUrl: string; issueNumber: number; message: string }>("/api/github/issues", sessionToken, {
        method: "POST", json: { projectId, taskId },
      });
      setGithubState("created");
      setGithubNotice(result.message);
    } catch (error) {
      setGithubState("error");
      setGithubNotice(errorText(error, "GitHub issue creation failed"));
    }
  };
  const copyLink = async () => { const url = new URL(`/${workspace.slug}`, window.location.origin); url.searchParams.set("project", projectId); url.searchParams.set("issue", taskId); try { await navigator.clipboard.writeText(url.href); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setActivityError("Clipboard unavailable. Copy the issue URL from the address bar."); } };
  const dialogTitle = details ? `${taskKey(details.task._id)} / ${project.name}` : "Issue details";
  return <Dialog title={dialogTitle} className="issue-detail-dialog" onClose={closeIssue} heading={<div className="issue-detail-heading">
      <h2><ProjectIcon project={project} /><span>{project.name}</span>{details && <><span aria-hidden="true">/</span><span className="issue-detail-key">{taskKey(details.task._id)}</span></>}</h2>
      {details && <span className={clsx("issue-save-state", saveState === "error" && "danger")} aria-live="polite">{saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved. Check required fields." : ""}</span>}
      {details && <button type="button" className="icon-button" aria-label={copied ? "Issue link copied" : "Copy issue link"} title={copied ? "Copied" : "Copy link"} onClick={() => void copyLink()}>{copied ? <Check size={15} /> : <LinkIcon size={15} />}</button>}
    </div>}>
    {details ? <div className="issue-detail-layout">
      <section className="issue-description-section">
        {details.task.done && <span className="issue-completed-badge"><CheckCircle2 size={14} />Completed</span>}
        <textarea className="issue-title-input" aria-label="Issue title" autoFocus={canEdit} value={title} onChange={event => setTitle(event.target.value)} disabled={!canEdit} rows={1} maxLength={250} required />
        <textarea className="issue-detail-description" aria-label="Issue description" value={description} onChange={event => setDescription(event.target.value)} rows={4} placeholder="Add a description..." disabled={!canEdit} />
        <IssueRelations sessionToken={sessionToken} taskId={taskId} canEdit={canEdit} onOpen={openReference} />
      </section>
      <aside className="issue-detail-sidebar" aria-label="Issue properties">
        <IssueFields labeled columns={details.columns.filter(column => !(column.isDone ?? column.title.toLowerCase() === "done"))} members={details.members} columnId={columnId} onColumnChange={value => void changeColumn(value)} priority={priority} onPriorityChange={setPriority} assignee={assignedToEmail} onAssigneeChange={setAssignedToEmail} dueDate={dueDate} onDueDateChange={setDueDate} disabled={!canEdit} />
        <div className="issue-property"><span>Labels</span><IssueLabels sessionToken={sessionToken} taskId={taskId} canEdit={canEdit} /></div>
        {(project.repoUrl || linkedGitHubUrl) && <div className="issue-property issue-github-section"><span>GitHub</span><div>
          <span className="issue-repository-name">{githubRepoLabel(project.repoUrl)}</span>
          {linkedGitHubUrl ? <a className="ghost-button compact" href={linkedGitHubUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} />Open issue</a>
            : githubIssueHref && (details.task.githubTaskMode ?? project.githubTaskMode) !== "pull_request" ? <button className="ghost-button compact" type="button" onClick={createGitHubIssue} disabled={!canEdit || githubState === "creating"}>{githubState === "creating" ? <Loader2 className="spin" size={13} /> : <Plus size={13} />}{githubState === "creating" ? "Creating" : "Create GitHub issue"}</button>
            : null}
          <TaskPullRequest project={project} taskId={taskId} sessionToken={sessionToken} canEdit={canEdit} saveDraft={saveDraft} />
          {githubNotice && <small className={clsx("github-notice", githubState === "error" && "danger")}>{githubNotice}</small>}
        </div></div>}
        <dl className="issue-date-summary"><div><dt>Created</dt><dd>{fmtDate(details.task.createdAt)}</dd></div><div><dt>Updated</dt><dd>{fmtDate(details.task.updatedAt)}</dd></div></dl>
      </aside>
      <section className="issue-detail-activity">
        <IssueFileUpload projectId={projectId} taskId={taskId} sessionToken={sessionToken} disabled={!canEdit} onLink={url => { void addAsset({ projectId, taskId, sessionToken, type: "link", name: url, url }).catch(error => setActivityError(errorText(error, "Could not attach link"))); }}>
        <header><h3>Activity</h3></header>
        <div className="issue-timeline">
          {!activity.length && <p className="activity-empty">No comments yet</p>}
          {activity.map(entry => <article className="issue-timeline-entry" key={entry.item._id}>
            {entry.kind === "comment" ? <UserAvatar user={details.members.find(member => member.userId === entry.item.authorUserId) || { name: entry.item.authorName, email: entry.item.authorEmail }} size="small" /> : <span className="activity-avatar" aria-hidden="true"><Paperclip size={12} /></span>}
            <div className="activity-entry-content"><header><strong>{entry.kind === "comment" ? entry.item.authorName : "Attachment"}</strong><time dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString()}>{relativeTime(entry.at)}</time></header>
              {entry.kind === "comment" ? <><IssueCommentBody comment={entry.item} sessionToken={sessionToken} canEdit={canEdit} onOpenReference={openReference} /><div className="comment-media">{details.assets.filter(asset => asset.commentId === entry.item._id && asset.localFileId).map(asset => <LocalAttachment key={asset._id} file={{ id: asset.localFileId!, name: asset.name, size: asset.size || 0, contentType: asset.contentType || "application/octet-stream" }} sessionToken={sessionToken} scope={`teamId=${workspace._id}`} />)}</div></> : entry.item.localFileId ? <LocalAttachment file={{ id: entry.item.localFileId, name: entry.item.name, size: entry.item.size || 0, contentType: entry.item.contentType || "application/octet-stream" }} sessionToken={sessionToken} scope={`teamId=${workspace._id}`} /> : <a className="activity-attachment" href={entry.item.url} target="_blank" rel="noreferrer"><span>{entry.item.name}</span><ExternalLink size={13} /></a>}
            </div>
          </article>)}
        </div>
        </IssueFileUpload>
        {canEdit && <IssueCommentComposer key={taskId} projectId={projectId} taskId={taskId} sessionToken={sessionToken} members={details.members} />}
        {activityError && <div className="notice danger" role="alert">{activityError}</div>}
      </section>
    </div> : <div className="dialog-body"><LoadingState label="Opening issue" /></div>}
  </Dialog>;
}
