import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Brush, Loader2, MoreHorizontal, Plus } from "lucide-react";
import { canvasKind, type CanvasKind } from "../../shared/origin-design";
import { cloudMutation, useCloudQuery, useCloudSession } from "@/lib/origin-cloud";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { consumeCanvasFocus, useCanvasFocus } from "@/lib/origin-canvas-focus";
import { cn } from "@/lib/cn";
import type { Bot } from "@/state/store";
import { lazyScreen } from "./lazy-screens";
import { CloudGate, EmptyState, Loading, Notice, inputClass, primaryButton, useAction, type OriginPageProps } from "./origin-pages/ui";

export const DrawingCanvas = lazyScreen("DrawingCanvas", async () => (await import("./origin-pages/DrawingCanvas")).DrawingCanvas);

type Canvas = { _id: string; name: string; kind?: CanvasKind };

const NOUNS: Record<CanvasKind, { one: string; create: string; empty: string; hint: string }> = {
  design: { one: "design file", create: "New file", empty: "No design files yet", hint: "Start one, or ask the project's Chief to design something in it." },
  board: { one: "board", create: "New board", empty: "No boards yet", hint: "Sketch, map ideas with sticky notes, or ask the project's Chief to run a brainstorm on one." },
  deck: { one: "presentation", create: "New presentation", empty: "No presentations yet", hint: "Start a deck, or ask the project's Chief to draft a pitch deck from your notes." },
};

export function ProjectDrawPage({ agent, ...props }: OriginPageProps & { agent: Bot }) {
  const session = useCloudSession();
  return (
    <CloudGate {...props} label="Canvas">
      {({ project, projectId, canEdit }) => session.user && project.teamId
        ? <ProjectCanvases key={projectId} projectId={projectId} teamId={project.teamId} userId={session.user._id} canEdit={canEdit} agent={agent} />
        : <EmptyState icon={<Brush size={22} />} title="Share this project to design together" />}
    </CloudGate>
  );
}

export function ProjectCanvases({ projectId, teamId, userId, canEdit, agent, switcher, kind = "design" }: { projectId: string; teamId: string; userId: string; canEdit: boolean; agent: Bot; switcher?: ReactNode; kind?: CanvasKind }) {
  const all = useCloudQuery<Canvas[]>("draw:canvases", { projectId });
  const canvases = all?.filter((canvas) => canvasKind(canvas.kind) === kind);
  const noun = NOUNS[kind];
  const [chosen, setChosen] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const action = useAction();
  const focus = useCanvasFocus(projectId);
  useEffect(() => {
    if (!focus || !canvases?.some((canvas) => canvas._id === focus.canvasId)) return;
    setChosen(focus.canvasId);
    if (!focus.frameId) consumeCanvasFocus(focus);
  }, [focus, canvases]);
  const current = canvases?.find((canvas) => canvas._id === chosen) ?? canvases?.[0];
  const create = async (event: FormEvent) => {
    event.preventDefault();
    let id = "";
    const ok = await action.run(async () => { id = await cloudMutation<string>("draw:createCanvas", { projectId, name: name.trim(), kind }); }, `Could not create the ${noun.one}`);
    if (ok) { setChosen(id); setNaming(false); setName(""); }
  };
  const rename = async (canvas: Canvas, next: string) => {
    setRenaming(null);
    if (!next.trim() || next.trim() === canvas.name) return;
    await action.run(() => cloudMutation("draw:renameCanvas", { teamId, canvasId: canvas._id, name: next.trim() }), `Could not rename the ${noun.one}`);
  };
  const remove = async (canvas: Canvas) => {
    const ok = await action.run(() => cloudMutation("draw:archiveCanvas", { teamId, canvasId: canvas._id }), `Could not delete the ${noun.one}`);
    if (ok) setChosen(null);
  };
  if (canvases === undefined) return <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]"><Loading label="Loading files" variant="grid" /></div>;
  const newCanvas = naming ? (
    <form onSubmit={(event) => void create(event)} className="flex shrink-0 items-center gap-1.5 origin-rise">
      <input autoFocus className={cn(inputClass, "h-8 w-28 sm:w-44")} aria-label="Name" placeholder="Name" value={name} maxLength={80} required
        onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setNaming(false); setName(""); } }} />
      <button aria-label="Create" className={cn(primaryButton, "h-8")} disabled={action.busy || !name.trim()}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}<span className="hidden sm:inline">Create</span></button>
    </form>
  ) : canEdit ? (
    <button type="button" onClick={() => setNaming(true)} aria-label={noun.create} title={noun.create}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-hairline/70 px-3 text-[12.5px] text-ink-secondary outline-none transition-colors hover:border-hairline hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
      <Plus size={14} /><span className="hidden sm:inline">{noun.create}</span>
    </button>
  ) : null;
  if (!current) {
    return (
      <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]">
        {switcher && <div className="flex h-11 shrink-0 items-start gap-3 px-4 pb-3 md:px-6"><div className="flex h-8 items-center gap-3">{switcher}</div></div>}
        <EmptyState icon={<Brush size={22} />} title={noun.empty} body={canEdit ? noun.hint : undefined}
          action={<div className="flex flex-col items-center gap-2">{newCanvas}{action.error && <Notice tone="danger">{action.error}</Notice>}</div>} />
      </div>
    );
  }
  const tabs = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {switcher && <div className="flex shrink-0 items-center gap-3 pr-1.5">{switcher}<span aria-hidden="true" className="h-4 w-px bg-hairline/60" /></div>}
      <div role="tablist" aria-label="Files" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {canvases.map((canvas) => renaming === canvas._id ? (
          <input key={canvas._id} autoFocus defaultValue={canvas.name} aria-label="Name" maxLength={80} className={cn(inputClass, "h-8 w-44 shrink-0")}
            onBlur={(event) => void rename(canvas, event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(null); }} />
        ) : (
          <button key={canvas._id} type="button" role="tab" aria-selected={canvas._id === current._id} onClick={() => setChosen(canvas._id)}
            onDoubleClick={() => { if (canEdit) setRenaming(canvas._id); }}
            className={cn("h-8 max-w-44 shrink-0 truncate rounded-full px-3 text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
              canvas._id === current._id ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink")}>
            {canvas.name}
          </button>
        ))}
      </div>
      {canEdit && !naming && <CanvasMenu name={current.name} noun={noun.one} onRename={() => setRenaming(current._id)} onDelete={() => void remove(current)} />}
      {newCanvas}
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]">
      {action.error && <div className="px-4 pt-2"><Notice tone="danger">{action.error}</Notice></div>}
      <DrawingCanvas key={current._id} mode={kind} teamId={teamId} canvasId={current._id} projectId={projectId} userId={userId} name={current.name} readOnly={!canEdit} agent={agent} lead={tabs}
        focus={focus?.canvasId === current._id ? focus.frameId : undefined} onFocused={() => { if (focus) consumeCanvasFocus(focus); }} />
    </div>
  );
}

function CanvasMenu({ name, noun, onRename, onDelete }: { name: string; noun: string; onRename(): void; onDelete(): void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setConfirming(false); };
  usePopoverDismiss(open, root, close);
  const item = "flex h-8 w-full items-center rounded-md px-2.5 text-left text-[12.5px] outline-none transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60";
  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={`${name} options`} aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex size-8 items-center justify-center rounded-full text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-48 rounded-xl border border-hairline/60 bg-menu p-1 animate-pop-in">
          {confirming ? (
            <>
              <p className="px-2.5 py-1.5 text-[12px] text-ink-secondary">Delete “{name}” for everyone?</p>
              <button type="button" role="menuitem" className={cn(item, "text-danger")} onClick={() => { close(); onDelete(); }}>Delete {noun}</button>
              <button type="button" role="menuitem" className={cn(item, "text-ink")} onClick={() => setConfirming(false)}>Keep it</button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" className={cn(item, "text-ink")} onClick={() => { close(); onRename(); }}>Rename</button>
              <button type="button" role="menuitem" className={cn(item, "text-danger")} onClick={() => setConfirming(true)}>Delete…</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
