import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronRight, CircleDashed, Loader2, Plus, Search, SignalMedium, UserRound } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { rankByName } from "@/lib/palette-rank";
import { cn } from "@/lib/cn";
import type { CloudBoard, CloudPerson, Priority } from "./cloud-types";
import { Loading, Notice, primaryButton, useAction } from "./ui";
import {
  AgentChip, ChipSelect, DateChip, IssueChips, IssueDialog, ProjectDot, issueDescriptionClass, issueTitleClass, memberOptions, priorityOptions, statusOptions,
  type CreatedIssue, type IssueAgent,
} from "./issue-fields";
import { isDraftColumn } from "../../../shared/origin-columns";
import { newIssueColumn, openIssueColumns } from "./issue-columns";

export interface ComposerProject { id: string; name: string; memberRole?: string; icon?: ReactNode }



/**
 * The new-issue composer: a project breadcrumb, a large title, a description and a row of property chips.
 * It asks for the project first when none is given; `agentsFor` lets the person hand the issue to an agent as it is created.
 */
export function NewIssueComposer({ projects, loading = false, emptyNote, initialProjectId, initialColumnId, initialDraft, myEmail, agentsFor, onClose, onCreated }: {
  projects: readonly ComposerProject[];
  loading?: boolean;
  /** Shown instead of the project list when there is nowhere to create an issue yet. */
  emptyNote?: string;
  initialProjectId: string | null;
  initialColumnId?: string;
  initialDraft?: { title?: string; description?: string };
  myEmail?: string;
  agentsFor?(projectId: string): readonly IssueAgent[];
  onClose(): void;
  onCreated(projectId: string, taskId: string, issue: CreatedIssue): void;
}) {
  const editable = projects.filter((project) => project.memberRole !== "viewer");
  const [chosen, setChosen] = useState<string | null>(initialProjectId);
  const projectId = editable.some((project) => project.id === chosen) ? chosen : null;
  const project = editable.find((item) => item.id === projectId);
  const action = useAction();
  const heading = (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
      {project ? (
        <button type="button" onClick={() => setChosen(null)} disabled={action.busy} title="Change project"
          className="flex min-w-0 items-center gap-1.5 rounded-full border border-hairline/50 bg-raised/50 px-2.5 py-1 text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
          {project.icon ?? <ProjectDot name={project.name} />}<span className="max-w-[220px] truncate">{project.name}</span>
        </button>
      ) : <span className="px-1 text-ink-secondary">Project</span>}
      <ChevronRight size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
      <h2 className="whitespace-nowrap font-medium text-ink">New issue</h2>
    </div>
  );
  return (
    <IssueDialog label="New issue" heading={heading} onClose={onClose} canClose={() => !action.busy}>
      {loading ? <div className="px-6 pb-6"><Loading label="Loading projects" variant="inline" /></div> : !editable.length ? (
        <p className="px-6 pb-8 pt-4 text-center text-[13px] text-ink-secondary origin-rise">{emptyNote ?? "Create a project, or ask to join one, to add your first issue."}</p>
      ) : !project ? (
        <ProjectChoice projects={editable} onChoose={setChosen} />
      ) : (
        <IssueForm key={project.id} project={project} initialColumnId={initialColumnId} initialDraft={initialDraft} myEmail={myEmail}
          agents={agentsFor?.(project.id) ?? []} action={action} onCreated={(issue) => onCreated(project.id, issue.taskId, issue)} />
      )}
    </IssueDialog>
  );
}

function ProjectChoice({ projects, onChoose }: { projects: readonly ComposerProject[]; onChoose(id: string): void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const matches = rankByName([...projects], query.trim().toLowerCase());
  const active = matches[Math.min(index, matches.length - 1)];
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [index]);
  return (
    <div className="flex flex-col gap-2 px-6 pb-6 pt-2 max-sm:px-5">
      <div className="flex items-center gap-2 rounded-xl border border-hairline/50 bg-inset px-3 transition-colors focus-within:border-accent/60">
        <Search size={15} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        <input autoFocus type="search" role="combobox" aria-expanded="true" aria-controls="new-issue-projects" aria-activedescendant={active ? `new-issue-project-${active.id}` : undefined}
          aria-label="Choose a project" placeholder="Choose a project…" value={query}
          onChange={(event) => { setQuery(event.target.value); setIndex(0); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && active) { event.preventDefault(); onChoose(active.id); }
            else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
              event.preventDefault();
              setIndex((current) => (Math.min(current, matches.length - 1) + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
            }
          }}
          className="w-full bg-transparent py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
      </div>
      <div ref={list} id="new-issue-projects" role="listbox" aria-label="Projects" className="flex max-h-[min(400px,55dvh)] flex-col gap-0.5 overflow-y-auto">
        {matches.map((project) => (
          <button key={project.id} id={`new-issue-project-${project.id}`} type="button" role="option" tabIndex={-1} aria-selected={project === active}
            onMouseMove={() => setIndex(matches.indexOf(project))} onClick={() => onChoose(project.id)}
            className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-ink transition-colors", project === active ? "bg-raised" : "hover:bg-raised/50")}>
            {project.icon ?? <ProjectDot name={project.name} />}<span className="min-w-0 flex-1 truncate">{project.name}</span>
            {project === active && <kbd className="rounded border border-hairline/50 px-1 text-[10.5px] text-ink-tertiary">↵</kbd>}
          </button>
        ))}
        {!matches.length && <p className="px-2.5 py-4 text-center text-[13px] text-ink-secondary">No matching projects</p>}
      </div>
    </div>
  );
}

function IssueForm({ project, initialColumnId, initialDraft, myEmail, agents, action, onCreated }: {
  project: ComposerProject;
  initialColumnId?: string;
  initialDraft?: { title?: string; description?: string };
  myEmail?: string;
  agents: readonly IssueAgent[];
  action: ReturnType<typeof useAction>;
  onCreated(issue: CreatedIssue): void;
}) {
  const projectId = project.id;
  const board = useCloudQuery<CloudBoard>("tasks:board", { projectId });
  const people = useCloudQuery<CloudPerson[]>("members:people", { projectId });
  const [title, setTitle] = useState(initialDraft?.title ?? "");
  const [description, setDescription] = useState(initialDraft?.description ?? "");
  const [columnId, setColumnId] = useState(initialColumnId ?? "");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [agentId, setAgentId] = useState("");
  const asked = useRef(false);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const columns = openIssueColumns(board?.columns ?? []);
  const column = newIssueColumn(columns, columnId);
  const chosenAssignee = assignee || (people?.some((person) => person.email === myEmail) ? myEmail ?? "" : "");

  useEffect(() => {
    if (!board || board.columns.some(isDraftColumn) || asked.current) return;
    asked.current = true;
    cloudMutation("tasks:ensureDefaultColumns", { projectId }).catch((cause) => action.setError(cause instanceof Error ? cause.message : String(cause)));
  }, [board, projectId, action]);
  useEffect(() => { titleInput.current?.focus({ preventScroll: true }); }, []);

  const missing = !title.trim() ? "a title" : !chosenAssignee ? "an assignee" : !dueDate ? "a due date" : !column ? "a status" : "";
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (missing || action.busy || !column) return;
    let taskId = "";
    const ok = await action.run(async () => {
      taskId = await cloudMutation<string>("tasks:createTask", { projectId, ...(columnId === column._id ? { columnId } : {}), title: title.trim(), description, priority, assignedToEmail: chosenAssignee, dueDate });
    }, "Could not create the issue");
    if (ok) onCreated({ projectId, taskId, title: title.trim(), description, priority, dueDate, labels: [], status: column.title, agentId: agentId || undefined });
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex min-h-[400px] flex-col px-6 pb-5 pt-2 max-sm:px-5"
      onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }}>
      <textarea ref={titleInput} rows={1} aria-label="Issue title" placeholder="Issue title" value={title} maxLength={250} required disabled={action.busy}
        onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) event.preventDefault(); }}
        className={issueTitleClass} />
      <textarea aria-label="Issue description" placeholder="Add a description…" rows={5} value={description} disabled={action.busy}
        onChange={(event) => setDescription(event.target.value)}
        className={cn(issueDescriptionClass, "flex-1")} />
      <IssueChips>
        <ChipSelect label="Status" value={column?._id ?? ""} options={statusOptions(columns)} onChange={setColumnId} icon={<CircleDashed size={14} aria-hidden="true" />} disabled={action.busy || !columns.length} />
        <ChipSelect label="Priority" value={priority} options={priorityOptions()} onChange={(value) => setPriority(value as Priority)} icon={<SignalMedium size={14} aria-hidden="true" />} disabled={action.busy} />
        <ChipSelect label="Assignee" value={chosenAssignee} options={memberOptions(people ?? [])} onChange={setAssignee} icon={<UserRound size={14} aria-hidden="true" />} disabled={action.busy || !people?.length} />
        <DateChip value={dueDate} onChange={setDueDate} disabled={action.busy} required />
        {agents.length > 0 && <AgentChip agents={agents} value={agentId} onPick={(id) => setAgentId(id ?? "")} onClear={() => setAgentId("")} disabled={action.busy} />}
      </IssueChips>
      {people && !people.length && <div className="mt-3"><Notice>Add a member to this project first: every issue needs an assignee.</Notice></div>}
      {action.error && <div className="mt-3"><Notice tone="danger">{action.error}</Notice></div>}
      <div className="mt-4 flex items-center gap-3 border-t border-hairline/40 pt-4">
        <span className="hidden text-[12px] text-ink-tertiary sm:inline">{missing ? `Add ${missing} to create the issue` : "Ctrl+Enter to create"}</span>
        <button type="submit" className={cn(primaryButton, "ml-auto rounded-full px-4")} disabled={action.busy || Boolean(missing)}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}{agentId ? "Create and hand off" : "Create issue"}
        </button>
      </div>
    </form>
  );
}
