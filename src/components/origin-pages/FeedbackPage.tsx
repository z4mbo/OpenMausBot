import { useState, type FormEvent } from "react";
import { Select } from "../Select";
import { copyText } from "@/lib/copy-text";
import { ArrowUpRight, Bug, Check, CirclePlus, Copy, Lightbulb, Loader2, MessageSquareHeart, RotateCcw, Settings2, X } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { feedbackLink, useAppAddress } from "@/lib/origin-members";
import type { CloudBoard, CloudFeedbackEntry, CloudFeedbackPortal, CloudPerson, CloudProject } from "./cloud-types";
import { fmtDate, taskKey } from "./repo-url";
import { CloudGate, EmptyState, Field, Loading, Modal, Notice, PageHeader, ReadOnlyEditorNotice, Segmented, cardClass, ghostButton, iconButton, inputClass, itemIn, pageClass, primaryButton, useAction, type OriginPageProps } from "./ui";
import { newIssueColumn, openIssueColumns } from "./issue-columns";

export type FeedbackPageProps = OriginPageProps & {
  onOpenIssue?(taskId: string): void;
};

type Filter = "open" | "completed" | "dismissed" | "all";
const statusTone: Record<CloudFeedbackEntry["status"], string> = { new: "bg-accent/15 text-accent-text", planned: "bg-warning/15 text-warning", completed: "bg-success/15 text-success", dismissed: "bg-raised text-ink-tertiary" };

export function FeedbackPage({ onOpenIssue, ...props }: FeedbackPageProps) {
  return (
    <CloudGate {...props} label="Feedback">
      {({ project, projectId, canEdit }) => project.teamId
        ? <Feedback project={project} teamId={project.teamId} projectId={projectId} canEdit={canEdit} onOpenIssue={onOpenIssue} />
        : <EmptyState icon={<MessageSquareHeart size={22} />} title="Feedback needs a workspace project" body="Move this project into a shared workspace to collect feedback." />}
    </CloudGate>
  );
}

function Feedback({ project, teamId, projectId, canEdit, onOpenIssue }: {
  project: CloudProject; teamId: string; projectId: string; canEdit: boolean; onOpenIssue?(taskId: string): void;
}) {
  const appAddress = useAppAddress();
  const access = useCloudQuery<{ role: string }>("workspaces:access", { teamId });
  const isAdmin = access?.role === "owner" || access?.role === "admin";
  const portals = useCloudQuery<CloudFeedbackPortal[]>("feedback:portals", { teamId });
  const portal = portals?.find((item) => item.projectId === projectId);
  const entries = useCloudQuery<CloudFeedbackEntry[]>("feedback:list", portal ? { teamId, portalId: portal._id } : "skip");
  const [filter, setFilter] = useState<Filter>("open");
  const [settings, setSettings] = useState(false);
  const [converting, setConverting] = useState<CloudFeedbackEntry | null>(null);
  const [notice, setNotice] = useState("");

  if (!portals) return <Loading label="Loading feedback" />;

  const link = portal ? feedbackLink(portal.slug, appAddress) : "";
  const visible = entries?.filter((entry) => filter === "all" || (filter === "open" ? entry.status === "new" || entry.status === "planned" : entry.status === filter));
  const setDismissed = (entry: CloudFeedbackEntry, dismissed: boolean) => {
    void cloudMutation("feedback:dismiss", { teamId, entryId: entry._id, dismissed }).catch(() => setNotice("Could not update feedback"));
  };

  return (
    <section className={pageClass} aria-label="Feedback">
      <PageHeader title="Feedback" count={entries ? entries.length : undefined}>
        {portal && <Segmented label="Feedback status" value={filter} onChange={setFilter}
          options={[{ value: "open", label: "Open" }, { value: "completed", label: "Completed" }, { value: "dismissed", label: "Dismissed" }, { value: "all", label: "All" }]} />}
        {portal?.enabled && (
          <>
            <button type="button" className={iconButton} title="Copy feedback link" aria-label="Copy feedback link"
              onClick={() => void copyText(link).then((result) => setNotice(result === "copied" ? "Feedback link copied" : "Could not copy link"))}>
              <Copy size={14} />
            </button>
            <a className={iconButton} href={link} target="_blank" rel="noreferrer" title="Open public feedback form" aria-label="Open public feedback form"><ArrowUpRight size={15} /></a>
          </>
        )}
        {isAdmin && <button type="button" className={ghostButton} onClick={() => setSettings(true)}><Settings2 size={14} />Portal settings</button>}
      </PageHeader>

      {portal && (
        <div className={cn(cardClass, "mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[12.5px]")}>
          <span className={cn("rounded-full px-2 py-0.5", portal.enabled ? "bg-success/15 text-success" : "bg-raised text-ink-tertiary")}>{portal.enabled ? "Public form on" : "Public form off"}</span>
          <span className="text-ink">{portal.title}</span>
          <code className="truncate text-ink-tertiary">/feedback/{portal.slug}</code>
        </div>
      )}
      {notice && <div className="mb-3"><Notice>{notice}</Notice></div>}

      {!portal ? (
        <EmptyState icon={<MessageSquareHeart size={22} />} title="Feedback is private until you enable a form"
          body="Turn on a public form and people can send bugs and ideas for this project without an account."
          action={isAdmin ? <button type="button" className={primaryButton} onClick={() => setSettings(true)}>Set up feedback</button> : undefined} />
      ) : !visible ? <Loading label="Loading entries" variant="inline" /> : !visible.length ? (
        <EmptyState icon={<MessageSquareHeart size={24} />} title="No feedback here yet" />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((entry) => (
            <article key={entry._id} className={cn(cardClass, "p-4", itemIn)}>
              <header className="mb-1.5 flex items-center gap-2">
                {entry.kind === "bug" ? <Bug size={15} className="text-danger" aria-label="Bug" /> : <Lightbulb size={15} className="text-warning" aria-label="Idea" />}
                <strong className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{entry.title}</strong>
                <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] capitalize", statusTone[entry.status])}>{entry.status}</span>
              </header>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] text-ink-secondary">{entry.body}</p>
              <footer className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-tertiary">
                <time>{fmtDate(entry.createdAt)}</time>
                <div className="ml-auto flex items-center gap-2">
                  {entry.taskId ? (
                    <button type="button" className={ghostButton} disabled={!onOpenIssue} onClick={() => onOpenIssue?.(entry.taskId!)}><ArrowUpRight size={14} />Issue {taskKey(entry.taskId)}</button>
                  ) : canEdit && entry.status !== "dismissed" ? (
                    <button type="button" className={ghostButton} onClick={() => setConverting(entry)}><CirclePlus size={14} />Convert to issue</button>
                  ) : null}
                  {canEdit && (entry.status === "dismissed"
                    ? <button type="button" className={ghostButton} onClick={() => setDismissed(entry, false)}><RotateCcw size={14} />Restore</button>
                    : entry.status !== "completed" && <button type="button" className={ghostButton} onClick={() => setDismissed(entry, true)}><X size={14} />Dismiss</button>)}
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
      {settings && <PortalSettings teamId={teamId} projectId={projectId} canEdit={isAdmin} projectName={project.name} portal={portal} onClose={() => setSettings(false)} />}
      {converting && <ConvertFeedback teamId={teamId} projectId={projectId} canEdit={canEdit} entry={converting} onClose={() => setConverting(null)}
        onCreated={(taskId) => { setConverting(null); setNotice(`Created issue ${taskKey(taskId)}`); onOpenIssue?.(taskId); }} />}
    </section>
  );
}

function PortalSettings({ teamId, projectId, canEdit, projectName, portal, onClose }: { teamId: string; projectId: string; canEdit: boolean; projectName: string; portal?: CloudFeedbackPortal; onClose(): void }) {
  const [title, setTitle] = useState(portal?.title || projectName);
  const [description, setDescription] = useState(portal?.description ?? "");
  const [enabled, setEnabled] = useState(portal?.enabled ?? false);
  const action = useAction();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || action.busy) return;
    if (await action.run(() => cloudMutation("feedback:configure", { teamId, projectId, title, description, enabled }), "Could not save")) onClose();
  };
  return (
    <Modal title="Feedback settings" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <ReadOnlyEditorNotice canEdit={canEdit} />
        <fieldset disabled={!canEdit} className="contents">
        <Field label="Public title"><input className={inputClass} value={title} required maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Public description"><textarea className={inputClass} value={description} maxLength={3000} rows={4} onChange={(e) => setDescription(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Enable public feedback form
        </label>
        </fieldset>
        {portal && <p className="text-[12px] text-ink-tertiary">Form address: <code>/feedback/{portal.slug}</code></p>}
        <p className="text-[12px] text-ink-tertiary">Enabling this publishes the title and description above. Workspace content, issues and submitted feedback stay private.</p>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <button className={primaryButton} disabled={action.busy || !canEdit}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Save settings</button>
      </form>
    </Modal>
  );
}

function ConvertFeedback({ teamId, projectId, canEdit, entry, onClose, onCreated }: { teamId: string; projectId: string; canEdit: boolean; entry: CloudFeedbackEntry; onClose(): void; onCreated(taskId: string): void }) {
  const board = useCloudQuery<CloudBoard>("tasks:board", { projectId });
  const people = useCloudQuery<CloudPerson[]>("members:people", { projectId });
  const [column, setColumn] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const action = useAction();
  const columns = openIssueColumns(board?.columns ?? []);
  const columnId = newIssueColumn(columns, column)?._id ?? "";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || action.busy) return;
    let taskId = "";
    const ok = await action.run(async () => {
      taskId = await cloudMutation<string>("feedback:convert", { teamId, entryId: entry._id, ...(column && column === columnId ? { columnId } : {}), assignedToEmail: assignee, dueDate });
    }, "Could not create issue");
    if (ok) onCreated(taskId);
  };
  return (
    <Modal title="Convert feedback to issue" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <ReadOnlyEditorNotice canEdit={canEdit} />
        <strong className="text-[13px] text-ink">{entry.title}</strong>
        <fieldset disabled={!canEdit} className="contents">
        <Field label="Column">
          <Select className="w-full" value={columnId} onChange={(e) => setColumn(e.target.value)}>
            {!columnId && <option value="">Draft</option>}
            {columns.map((item) => <option key={item._id} value={item._id}>{item.title}</option>)}
          </Select>
        </Field>
        <Field label="Assigned to">
          <Select className="w-full" required value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Choose a member</option>
            {people?.map((person) => <option key={person.email} value={person.email}>{person.name || person.email}</option>)}
          </Select>
        </Field>
        <Field label="Due date"><input className={inputClass} type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        </fieldset>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <button className={primaryButton} disabled={action.busy || !canEdit || !board || !assignee || !dueDate}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : <CirclePlus size={14} />}Create issue
        </button>
      </form>
    </Modal>
  );
}
