import { useEffect, useRef, useState } from "react";
import { Bot as BotIcon, ChevronLeft, FilePlus2, FileText, ListChecks, Loader2, Rocket, Trash2 } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import {
  BRIEF_TAG, BRIEF_TITLE, DOC_CHANGED, DOC_LIMITS, checklistItems, isBrief, toggleChecklistItem, type ProjectDoc, type ProjectDocList, type ProjectDocSummary,
} from "../../../shared/origin-docs";
import { CloudGate, EmptyState, Loading, Notice, PageHeader, Segmented, cardClass, ghostButton, iconButton, inputClass, itemIn, primaryButton, underGlass, useAction, type OriginPageProps } from "../origin-pages/ui";
import { errorText } from "../origin-pages/repo-url";
import { DocMarkdown } from "./DocMarkdown";
import { MilestoneRow, ProgressBar, useMilestones } from "./milestones";

export type DocsPageProps = OriginPageProps & {
  /** Opens Issues narrowed to a milestone. */
  onOpenMilestone?(milestoneId: string): void;
  /** Starts Launchpad for this project: the Chief drafts the Brief, milestones and MVP issues from an idea. */
  onLaunch?(): void;
};

const BRIEF_TEMPLATE = [
  "## Problem", "", "## Audience", "", "## Core features", "", "## Success metric", "", "## Non-goals", "", "## Milestones", "", "## Team", "",
  "## Kickoff checklist", "- [ ] Build the MVP issues", "- [ ] Landing page in Canvas, published with Pages", "- [ ] Launch content in Studio and a Broadcast campaign", "- [ ] First lead list in Pipeline", "",
].join("\n");

const SAVE_DELAY_MS = 800;

const savedAgo = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function DocsPage({ onOpenMilestone, onLaunch, ...props }: DocsPageProps) {
  return (
    <CloudGate {...props} label="Docs">
      {({ projectId, canEdit }) => <DocsBoard projectId={projectId} canEdit={canEdit} onOpenMilestone={onOpenMilestone} onLaunch={onLaunch} />}
    </CloudGate>
  );
}

function DocsBoard({ projectId, canEdit: memberCanEdit, onOpenMilestone, onLaunch }: { projectId: string; canEdit: boolean; onOpenMilestone?(id: string): void; onLaunch?(): void }) {
  const list = useCloudQuery<ProjectDocList>("projectDocs:list", { projectId });
  const [openId, setOpenId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const create = useAction();
  if (!list) return <Loading label="Loading docs" variant="list" />;
  const canEdit = memberCanEdit && list.canEdit;
  const brief = list.docs.find(isBrief);
  const current = list.docs.find((doc) => doc._id === openId) ?? list.docs[0];
  const open = (id: string) => { setOpenId(id); setMobileOpen(true); };
  const newDoc = (brief: boolean) => void create.run(async () => {
    const { docId } = await cloudMutation<{ docId: string }>("projectDocs:save", {
      projectId, title: brief ? BRIEF_TITLE : "Untitled", content: brief ? BRIEF_TEMPLATE : "", tags: brief ? [BRIEF_TAG] : [],
    });
    open(docId);
  }, "Could not create the document");

  return (
    <section aria-label="Docs" className="flex min-h-0 flex-1 flex-col overflow-hidden motion-safe:animate-[rise_var(--motion-slow)_var(--ease-out)_backwards]">
      <PageHeader title="Docs" count={list.docs.length || undefined}>
        {canEdit && list.docs.length > 0 && <button type="button" className={primaryButton} disabled={create.busy} onClick={() => newDoc(false)}><FilePlus2 size={14} />New doc</button>}
      </PageHeader>
      {create.error && <div className="px-4 md:px-6"><Notice tone="danger">{create.error}</Notice></div>}
      {!list.docs.length ? (
        <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 md:px-6", underGlass)}>
          <EmptyState icon={<FileText size={22} />} title="No docs yet"
            body="The Brief and the specs people and agents write live here."
            action={canEdit ? (
              <div className="flex flex-wrap justify-center gap-2">
                {onLaunch && <button type="button" className={primaryButton} onClick={onLaunch}><Rocket size={14} />Plan from an idea</button>}
                <button type="button" className={onLaunch ? ghostButton : primaryButton} disabled={create.busy} onClick={() => newDoc(true)}><FileText size={14} />Write the Brief</button>
                <button type="button" className={ghostButton} disabled={create.busy} onClick={() => newDoc(false)}><FilePlus2 size={14} />Blank doc</button>
              </div>
            ) : undefined} />
        </div>
      ) : (
        <div className={cn("grid min-h-0 flex-1 gap-4 overflow-hidden px-4 pb-4 md:grid-cols-[15rem_minmax(0,1fr)] md:px-6", underGlass)}>
          <nav aria-label="Documents" className={cn("min-h-0 overflow-y-auto", mobileOpen && "max-md:hidden")}>
            {!brief && canEdit && (
              <button type="button" onClick={() => newDoc(true)} disabled={create.busy}
                className="mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-hairline/60 px-3 py-2 text-[13px] text-ink-secondary outline-none transition-colors hover:bg-raised/40 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
                <FileText size={14} />Write the Brief
              </button>
            )}
            <ul className="flex flex-col gap-0.5">
              {list.docs.map((doc) => <DocLink key={doc._id} doc={doc} current={doc._id === current?._id} onOpen={() => open(doc._id)} />)}
            </ul>
          </nav>
          {current && (
            <div className={cn("min-h-0 min-w-0", !mobileOpen && "max-md:hidden")}>
              <DocView key={current._id} projectId={projectId} summary={current} canEdit={canEdit} onBack={() => setMobileOpen(false)}
                onOpenMilestone={onOpenMilestone} onRemoved={() => { setOpenId(null); setMobileOpen(false); }} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DocLink({ doc, current, onOpen }: { doc: ProjectDocSummary; current: boolean; onOpen(): void }) {
  return (
    <li className={itemIn}>
      <button type="button" onClick={onOpen} aria-current={current ? "page" : undefined}
        className={cn("flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
          current ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink")}>
        <span className="flex min-w-0 items-center gap-2">
          <FileText size={14} aria-hidden="true" className={cn("shrink-0", isBrief(doc) && "text-accent-text")} />
          <span className="truncate text-[13px] font-medium">{doc.title}</span>
          {isBrief(doc) && doc.title.toLowerCase() !== BRIEF_TAG && <span className="ml-auto shrink-0 rounded-full bg-accent/15 px-1.5 text-[10.5px] font-medium text-accent-text">Brief</span>}
        </span>
        <span className="flex items-center gap-1 truncate pl-[22px] text-[11.5px] text-ink-tertiary">
          {doc.editedBy?.agent && <BotIcon size={11} aria-label="Agent" className="shrink-0" />}
          {doc.editedBy ? `${doc.editedBy.name} · ` : ""}{savedAgo(doc.updatedAt)}
        </span>
      </button>
    </li>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function DocView({ projectId, summary, canEdit, onBack, onOpenMilestone, onRemoved }: {
  projectId: string; summary: ProjectDocSummary; canEdit: boolean; onBack(): void; onOpenMilestone?(id: string): void; onRemoved(): void;
}) {
  const server = useCloudQuery<ProjectDoc | null>("projectDocs:get", { projectId, docId: summary._id });
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null);
  const [base, setBase] = useState<number | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<{ title: string; content: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (server && server.updatedAt !== seen) {
    setSeen(server.updatedAt);
    if (!dirty) {
      setDraft({ title: server.title, content: server.content });
      setBase(server.updatedAt);
    } else if (base !== null && server.updatedAt !== base && state !== "saving") setConflict(true);
  }

  if (server === undefined || !draft) return <Loading label="Loading document" variant="page" />;
  if (server === null) return <EmptyState compact icon={<FileText size={22} />} title="This document was deleted" />;

  const save = async (next: { title: string; content: string }, against: number | null) => {
    setState("saving");
    setError("");
    try {
      const result = await cloudMutation<{ updatedAt: number }>("projectDocs:save", {
        projectId, docId: summary._id, ...(next.title.trim() ? { title: next.title } : {}), content: next.content, ...(against !== null ? { baseUpdatedAt: against } : {}),
      });
      setBase(result.updatedAt);
      if (latest.current === next) setDirty(false);
      setConflict(false);
      setState("saved");
    } catch (cause) {
      const message = errorText(cause, "Could not save");
      if (message.includes(DOC_CHANGED)) setConflict(true);
      else setError(message);
      setState("error");
    }
  };
  const edit = (next: { title: string; content: string }) => {
    setDraft(next);
    latest.current = next;
    setDirty(true);
    setState("idle");
    window.clearTimeout(timer.current);
    if (!conflict) timer.current = window.setTimeout(() => void save(next, base), SAVE_DELAY_MS);
  };
  const toggle = (line: number) => {
    const next = { ...draft, content: toggleChecklistItem(draft.content, line) };
    setDraft(next);
    latest.current = next;
    setDirty(true);
    void save(next, base);
  };
  const takeTheirs = () => { setDirty(false); setDraft({ title: server.title, content: server.content }); setBase(server.updatedAt); setConflict(false); setState("idle"); };
  const keepMine = () => void save(draft, server.updatedAt);
  const remove = () => {
    if (!window.confirm(`Delete "${server.title}"? This cannot be undone.`)) return;
    void cloudMutation("projectDocs:remove", { projectId, docId: summary._id }).then(onRemoved, (cause: unknown) => setError(errorText(cause, "Could not delete")));
  };
  const brief = isBrief(server);
  const editor = server.editedBy;

  return (
    <article className={cn(cardClass, "flex h-full min-h-0 flex-col overflow-hidden")} aria-label={server.title}>
      <header className="flex flex-wrap items-center gap-2 border-b border-hairline/40 px-3 py-2 md:px-4">
        <button type="button" className={cn(iconButton, "md:hidden")} aria-label="All documents" onClick={onBack}><ChevronLeft size={16} /></button>
        {mode === "edit" && canEdit
          ? <input aria-label="Title" className={cn(inputClass, "h-8 min-w-0 flex-1 text-[14px] font-semibold")} maxLength={DOC_LIMITS.title} value={draft.title} onChange={(event) => edit({ ...draft, title: event.target.value })} />
          : <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{draft.title}</h2>}
        <span className="flex items-center gap-1 text-[12px] text-ink-tertiary" role="status">
          {state === "saving" ? <><Loader2 size={12} className="animate-spin" />Saving</>
            : state === "saved" && !dirty ? "Saved"
            : editor ? <>{editor.agent && <BotIcon size={12} aria-label="Agent" />}{editor.name} · {savedAgo(server.updatedAt)}</> : savedAgo(server.updatedAt)}
        </span>
        {canEdit && <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: "read", label: "Read" }, { value: "edit", label: "Edit" }]} />}
        {canEdit && <button type="button" className={iconButton} aria-label={`Delete ${server.title}`} title="Delete" onClick={remove}><Trash2 size={15} /></button>}
      </header>
      {(conflict || error) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline/40 px-4 py-2 text-[12.5px]">
          {conflict ? <>
            <span className="min-w-0 flex-1 text-warning">{editor?.name ?? "Someone"} changed this document while you were editing.</span>
            <button type="button" className={ghostButton} onClick={takeTheirs}>Use theirs</button>
            <button type="button" className={primaryButton} onClick={keepMine}>Keep mine</button>
          </> : <span className="text-danger" role="alert">{error}</span>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {brief && <BriefProgress projectId={projectId} content={draft.content} onOpenMilestone={onOpenMilestone} />}
        {mode === "edit" && canEdit ? (
          <textarea aria-label="Markdown" spellCheck value={draft.content} maxLength={DOC_LIMITS.content} onChange={(event) => edit({ ...draft, content: event.target.value })}
            placeholder="Write in markdown. - [ ] makes a checkbox."
            className="block h-full min-h-[24rem] w-full resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px] md:px-6" />
        ) : (
          <div className="px-4 py-4 md:px-6">
            {draft.content.trim()
              ? <DocMarkdown text={draft.content} onToggle={canEdit ? toggle : undefined} />
              : <p className="text-[13px] text-ink-tertiary">{canEdit ? "Empty. Switch to Edit to write it." : "Empty."}</p>}
          </div>
        )}
      </div>
    </article>
  );
}

/** The Brief's head: milestone progress from the project's issues, and how much of the kickoff checklist is done. */
function BriefProgress({ projectId, content, onOpenMilestone }: { projectId: string; content: string; onOpenMilestone?(id: string): void }) {
  const milestones = useMilestones(projectId)?.milestones ?? [];
  const checklist = checklistItems(content);
  if (!milestones.length && !checklist.length) return null;
  const ticked = checklist.filter((item) => item.done).length;
  return (
    <div className="grid gap-3 border-b border-hairline/40 px-4 py-3 md:px-6 lg:grid-cols-[minmax(0,1fr)_14rem]" data-brief-progress>
      {milestones.length > 0 && (
        <div className="-mx-2 grid gap-0.5 sm:grid-cols-2">
          {milestones.map((milestone) => <MilestoneRow key={milestone._id} milestone={milestone} onOpen={onOpenMilestone ? () => onOpenMilestone(milestone._id) : undefined} />)}
        </div>
      )}
      {checklist.length > 0 && (
        <div className="px-0 py-2 lg:border-l lg:border-hairline/40 lg:pl-4">
          <span className="flex items-center gap-2 text-[13px] font-medium text-ink"><ListChecks size={14} aria-hidden="true" className="text-ink-tertiary" />Checklist
            <span className="ml-auto text-[12px] tabular-nums text-ink-secondary">{ticked}/{checklist.length}</span></span>
          <ProgressBar done={ticked} total={checklist.length} className="mt-1.5" />
        </div>
      )}
    </div>
  );
}
