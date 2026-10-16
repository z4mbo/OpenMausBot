"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight, Circle, Loader2, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog } from "./dialog";
import { IssueFields } from "./issue-fields";
import { IssueSelect } from "./issue-select";
import { ProjectIcon } from "./project-icon";
import { rankSearchResults } from "@/lib/search-ranking";
import { RECONNECT_TO_CREATE, useWorkspaceOnline } from "./workspace-connection";


export function IssueComposer({
  sessionToken,
  projects,
  activeProjectId,
  onClose,
  onCreated,
  initialDraft,
}: {
  sessionToken: string;
  projects: { _id: Id<"projects">; name: string; memberRole: string; iconType?: string; iconValue?: string; iconUrl?: string | null }[];
  activeProjectId: Id<"projects"> | null;
  onClose: () => void;
  onCreated: (id: Id<"projects">, taskId: Id<"tasks">) => void;
  initialDraft?: { title: string; description: string };
}) {
  const online = useWorkspaceOnline();
  const editable = projects.filter((p) => p.memberRole !== "viewer");
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(
    editable.find((p) => p._id === activeProjectId)?._id ||
      null,
  );
  const [columnId, setColumnId] = useState("");
  const [title, setTitle] = useState(initialDraft?.title || "");
  const [description, setDescription] = useState(
    initialDraft?.description || "",
  );
  const [priority, setPriority] = useState<"" | "low" | "medium" | "high">("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectIndex, setProjectIndex] = useState(0);
  const titleInput = useRef<HTMLInputElement>(null);
  const matchingProjects = rankSearchResults(editable.map(project => ({ ...project, label: project.name })).filter(project => project.name.toLowerCase().includes(projectSearch.toLowerCase())), projectSearch);
  useEffect(() => {
    if (!projectId) return;
    const frame = requestAnimationFrame(() => titleInput.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [projectId]);
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const board = useQuery(
    api.tasks.board,
    projectId ? { sessionToken, projectId } : "skip",
  );
  const members = useQuery(api.members.people, projectId ? { sessionToken, projectId } : "skip");
  const create = useMutation(api.tasks.createTask);
  const ensureColumns = useMutation(api.tasks.ensureDefaultColumns);
  const columns =
    board?.columns.filter(
      (c) => !(c.isDone ?? c.title.toLowerCase() === "done"),
    ) || [];
  useEffect(() => {
    if (online && board?.columns.length === 0 && projectId)
      void ensureColumns({ sessionToken, projectId }).catch((error) =>
        setError(error.message),
      );
  }, [online, board?.columns.length, projectId, ensureColumns, sessionToken]);
  const selectedColumn = columns.find((c) => c._id === columnId) || columns[0];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !online || busy ||
      !projectId ||
      !selectedColumn ||
      !title.trim() ||
      !priority ||
      !assignee ||
      !dueDate
    )
      return;
    setBusy(true);
    setError("");
    try {
      const taskId = await create({
        projectId,
        sessionToken,
        columnId: selectedColumn._id,
        title,
        description,
        priority,
        assignedToEmail: assignee,
        dueDate,
      });
      onCreated(projectId, taskId);
      onClose();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not create issue",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="New issue"
      heading={<div className="issue-breadcrumb"><IssueSelect label="Project" icon={<Circle size={14} />} value={projectId || ""} disabled={busy} onChange={value => { setProjectId(value as Id<"projects">); setColumnId(""); setAssignee(""); }} options={editable.map(project => ({ value: project._id, label: project.name, icon: <ProjectIcon project={project} size={14} /> }))} /><ChevronRight size={14} /><h2>New issue</h2></div>}
      className="issue-composer-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        {!editable.length ? (
          <div className="dialog-body muted">
            Create a project to add your first issue.
          </div>
        ) : !projectId ? (
          <div className="issue-project-choice">
            <input type="search" role="combobox" aria-expanded="true" aria-controls="new-issue-projects" aria-activedescendant={matchingProjects[projectIndex] ? `choose-${matchingProjects[projectIndex]._id}` : undefined} aria-label="Choose a project" placeholder="Choose a project..." autoFocus data-initial-focus value={projectSearch} onChange={event => { setProjectSearch(event.target.value); setProjectIndex(0); }} onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") { event.preventDefault(); if (matchingProjects[projectIndex]) setProjectId(matchingProjects[projectIndex]._id); }
              else if (["ArrowDown", "ArrowUp"].includes(event.key) && matchingProjects.length) { event.preventDefault(); setProjectIndex(index => (index + (event.key === "ArrowDown" ? 1 : -1) + matchingProjects.length) % matchingProjects.length); }
            }} />
            <div className="issue-project-options" id="new-issue-projects" role="listbox" aria-label="Projects">
              {matchingProjects.map((project, index) => <button id={`choose-${project._id}`} key={project._id} type="button" role="option" aria-selected={index === projectIndex} tabIndex={-1} onMouseEnter={() => setProjectIndex(index)} onClick={() => setProjectId(project._id)}><ProjectIcon project={project} size={16} /><span>{project.name}</span></button>)}
              {!matchingProjects.length && <p className="muted">No matching projects</p>}
            </div>
          </div>
        ) : (
          <div className="issue-composer-fields">
            <input
              ref={titleInput}
              className="issue-title-input"
              aria-label="Issue title"
              autoFocus
              data-initial-focus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
              required
              maxLength={250}
              disabled={busy}
            />
            <textarea
              aria-label="Issue description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              rows={5}
              disabled={busy}
            />
            <IssueFields
              columns={columns}
              members={members || []}
              columnId={selectedColumn?._id || ""}
              onColumnChange={setColumnId}
              priority={priority}
              onPriorityChange={setPriority}
              assignee={assignee}
              onAssigneeChange={setAssignee}
              dueDate={dueDate}
              onDueDateChange={setDueDate}
              disabled={busy}
            >
              <button type="submit" className="primary-button compact issue-create-submit" title={!online ? RECONNECT_TO_CREATE : undefined} disabled={!online || busy || !title.trim() || !priority || !selectedColumn || !members?.length}>
                {busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
                Create issue
              </button>
            </IssueFields>
            {error && (
              <div role="alert" className="notice danger">
                {error}
              </div>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}
