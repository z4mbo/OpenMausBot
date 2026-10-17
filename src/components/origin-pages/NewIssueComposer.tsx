import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Bot as BotIcon, ChevronRight, CircleDashed, Loader2, Plus, Search, SignalMedium, Tag, UserRound, X } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { rankByName } from "@/lib/palette-rank";
import { cn } from "@/lib/cn";
import type { CloudBoard, CloudPerson, Priority } from "./cloud-types";
import { Loading, Notice, chipButton, primaryButton, useAction } from "./ui";
import {
  ChipSelect, DateChip, IssueDialog, isDoneColumn, memberOptions, parseLabels, priorityOptions, statusOptions, type CreatedIssue, type IssueAgent,
} from "./issue-fields";

export interface ComposerProject { id: string; name: string; memberRole?: string; icon?: ReactNode }

const NO_AGENT = "none";

function isoDay(offset: number): string {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

const DUE_SHORTCUTS = [{ label: "Today", offset: 0 }, { label: "Tomorrow", offset: 1 }, { label: "Next week", offset: 7 }] as const;

/**
 * The new-issue composer: a project breadcrumb, a large title, a description and a row of property chips.
 * It asks for the project first when none is given; `agentsFor` lets the person hand the issue to an agent as it is created.
 */
export function NewIssueComposer({ projects, loading = false, initialProjectId, initialColumnId, initialDraft, myEmail, agentsFor, onClose, onCreated }: {
  projects: readonly ComposerProject[];
  loading?: boolean;
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
    <IssueDialog label="New issue" heading={heading} onClose={() => { if (!action.busy) onClose(); }}>
      {loading ? <div className="px-5 pb-5"><Loading label="Loading projects" variant="inline" /></div> : !editable.length ? (
        <p className="px-5 pb-8 pt-4 text-center text-[13px] text-ink-secondary">Create a project, or ask to join one, to add your first issue.</p>
      ) : !project ? (
        <ProjectChoice projects={editable} onChoose={setChosen} />
      ) : (
        <IssueForm key={project.id} project={project} initialColumnId={initialColumnId} initialDraft={initialDraft} myEmail={myEmail}
          agents={agentsFor?.(project.id) ?? []} action={action} onCreated={(issue) => onCreated(project.id, issue.taskId, issue)} />
      )}
    </IssueDialog>
  );
}

function ProjectDot({ name }: { name: string }) {
  return <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded bg-accent/20 text-[9.5px] font-bold text-accent-text">{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

function ProjectChoice({ projects, onChoose }: { projects: readonly ComposerProject[]; onChoose(id: string): void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const matches = rankByName([...projects], query.trim().toLowerCase());
  const active = matches[Math.min(index, matches.length - 1)];
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [index]);
  return (
    <div className="flex flex-col gap-2 px-5 pb-5 pt-2">
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
      <div ref={list} id="new-issue-projects" role="listbox" aria-label="Projects" className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
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
  const [labels, setLabels] = useState("");
  const [agentId, setAgentId] = useState("");
  const asked = useRef(false);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const columns = (board?.columns ?? []).filter((column) => !isDoneColumn(column)).sort((a, b) => a.order - b.order);
  const column = columns.find((item) => item._id === columnId) ?? columns.find((item) => item.title.trim().toLowerCase() === "todo") ?? columns[0];
  const chosenAssignee = assignee || (people?.some((person) => person.email === myEmail) ? myEmail ?? "" : "");

  useEffect(() => {
    if (!board || board.columns.length || asked.current) return;
    asked.current = true;
    cloudMutation("tasks:ensureDefaultColumns", { projectId }).catch((cause) => action.setError(cause instanceof Error ? cause.message : String(cause)));
  }, [board, projectId, action]);
  useEffect(() => { titleInput.current?.focus({ preventScroll: true }); }, []);

  const missing = !title.trim() ? "a title" : !chosenAssignee ? "an assignee" : !dueDate ? "a due date" : !column ? "a status" : "";
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (missing || action.busy || !column) return;
    let taskId = "";
    const chosen = parseLabels(labels);
    const ok = await action.run(async () => {
      taskId = await cloudMutation<string>("tasks:createTask", { projectId, columnId: column._id, title: title.trim(), description, priority, assignedToEmail: chosenAssignee, dueDate });
      if (chosen.length) await cloudMutation("issueRelations:labels", { taskId, labels: chosen });
    }, "Could not create the issue");
    if (ok) onCreated({ projectId, taskId, title: title.trim(), description, priority, dueDate, labels: chosen, status: column.title, agentId: agentId || undefined });
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex min-h-[340px] flex-col px-5 pb-5 pt-2"
      onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }}>
      <textarea ref={titleInput} rows={1} aria-label="Issue title" placeholder="Issue title" value={title} maxLength={250} required disabled={action.busy}
        onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) event.preventDefault(); }}
        className="w-full resize-none bg-transparent text-[22px] font-semibold leading-snug tracking-[-0.01em] text-ink outline-none [field-sizing:content] placeholder:text-ink-tertiary max-md:text-[19px]" />
      <textarea aria-label="Issue description" placeholder="Add a description…" rows={5} value={description} disabled={action.busy}
        onChange={(event) => setDescription(event.target.value)}
        className="mt-3 min-h-[120px] w-full flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-ink-secondary outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ChipSelect label="Status" value={column?._id ?? ""} options={statusOptions(columns)} onChange={setColumnId} icon={<CircleDashed size={14} aria-hidden="true" />} disabled={action.busy || !columns.length} />
        <ChipSelect label="Priority" value={priority} options={priorityOptions()} onChange={(value) => setPriority(value as Priority)} icon={<SignalMedium size={14} aria-hidden="true" />} disabled={action.busy} />
        <ChipSelect label="Assignee" value={chosenAssignee} options={memberOptions(people ?? [])} onChange={setAssignee} icon={<UserRound size={14} aria-hidden="true" />} disabled={action.busy || !people?.length} />
        <DateChip value={dueDate} onChange={setDueDate} disabled={action.busy} required />
        <label className={cn(chipButton, "cursor-text")}>
          <Tag size={14} aria-hidden="true" className="shrink-0" />
          <input aria-label="Labels" placeholder="Labels" value={labels} onChange={(event) => setLabels(event.target.value)} disabled={action.busy}
            className="w-24 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-secondary max-md:text-[16px]" />
        </label>
        {agents.length > 0 && (
          <ChipSelect label="Hand to agent" value={agentId} placeholder="Hand to agent" align="right" icon={<BotIcon size={14} aria-hidden="true" />}
            options={[...agents.map((agent) => ({ value: agent.id, label: agent.name, icon: agent.avatar })), ...(agentId ? [{ value: NO_AGENT, label: "Don't hand off", icon: <X size={14} aria-hidden="true" /> }] : [])]}
            onChange={(value) => setAgentId(value === NO_AGENT ? "" : value)} disabled={action.busy} />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11.5px] text-ink-tertiary">Due</span>
        {DUE_SHORTCUTS.map((shortcut) => (
          <button key={shortcut.label} type="button" disabled={action.busy} onClick={() => setDueDate(isoDay(shortcut.offset))}
            className={cn("rounded-full px-2 py-0.5 text-[11.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60", dueDate === isoDay(shortcut.offset) ? "bg-accent/15 text-accent-text" : "text-ink-tertiary hover:bg-raised hover:text-ink")}>
            {shortcut.label}
          </button>
        ))}
      </div>
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
