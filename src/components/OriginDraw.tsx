import { useState, type FormEvent } from "react";
import { Brush, Loader2, Plus } from "lucide-react";
import { cloudMutation, useCloudQuery, useCloudSession } from "@/lib/origin-cloud";
import { EXCALIDRAW_ASSET_PATH } from "@/lib/excalidraw-assets";
import { cn } from "@/lib/cn";
import type { Bot } from "@/state/store";
import { lazyScreen } from "./lazy-screens";
import { CloudGate, EmptyState, Loading, Notice, inputClass, primaryButton, useAction, type OriginPageProps } from "./origin-pages/ui";

export const DrawingCanvas = lazyScreen("DrawingCanvas", async () => {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;
  return (await import("./origin-pages/DrawingCanvas")).DrawingCanvas;
});

type Canvas = { _id: string; name: string };

/** A project's shared canvases: pick one, start another, and ask the project's lead about what is on it. */
export function ProjectDrawPage({ agent, ...props }: OriginPageProps & { agent: Bot }) {
  const session = useCloudSession();
  return (
    <CloudGate {...props} label="Drawings">
      {({ project, projectId, canEdit }) => session.user && project.teamId
        ? <ProjectCanvases key={projectId} projectId={projectId} teamId={project.teamId} userId={session.user._id} canEdit={canEdit} agent={agent} />
        : <EmptyState icon={<Brush size={22} />} title="Share this project to draw together" />}
    </CloudGate>
  );
}

function ProjectCanvases({ projectId, teamId, userId, canEdit, agent }: { projectId: string; teamId: string; userId: string; canEdit: boolean; agent: Bot }) {
  const canvases = useCloudQuery<Canvas[]>("draw:canvases", { projectId });
  const [chosen, setChosen] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const action = useAction();
  const current = canvases?.find((canvas) => canvas._id === chosen) ?? canvases?.[0];
  const create = async (event: FormEvent) => {
    event.preventDefault();
    let id = "";
    const ok = await action.run(async () => { id = await cloudMutation<string>("draw:createCanvas", { projectId, name: name.trim() }); }, "Could not create the canvas");
    if (ok) { setChosen(id); setNaming(false); setName(""); }
  };
  if (canvases === undefined) return <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]"><Loading label="Loading canvases" variant="grid" /></div>;
  const newCanvas = naming ? (
    <form onSubmit={(event) => void create(event)} className="flex w-full items-center gap-1.5 origin-rise sm:w-auto">
      <input autoFocus className={cn(inputClass, "h-8 min-w-0 flex-1 sm:w-44 sm:flex-none")} aria-label="Canvas name" placeholder="Canvas name" value={name} maxLength={80} required
        onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setNaming(false); setName(""); } }} />
      <button className={cn(primaryButton, "h-8")} disabled={action.busy || !name.trim()}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Create</button>
    </form>
  ) : canEdit ? (
    <button type="button" onClick={() => setNaming(true)}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-hairline/70 px-3 text-[12.5px] text-ink-secondary outline-none transition-colors hover:border-hairline hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
      <Plus size={14} />New canvas
    </button>
  ) : null;
  if (!current) {
    return (
      <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]">
        <EmptyState icon={<Brush size={22} />} title="No canvases yet"
          action={<div className="flex flex-col items-center gap-2">{newCanvas}{action.error && <Notice tone="danger">{action.error}</Notice>}</div>} />
      </div>
    );
  }
  const tabs = (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <div role="tablist" aria-label="Canvases" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {canvases.map((canvas) => (
          <button key={canvas._id} type="button" role="tab" aria-selected={canvas._id === current._id} onClick={() => setChosen(canvas._id)}
            className={cn("h-8 shrink-0 rounded-full px-3 text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
              canvas._id === current._id ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink")}>
            {canvas.name}
          </button>
        ))}
      </div>
      {newCanvas}
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]">
      {action.error && <div className="px-4 pt-2"><Notice tone="danger">{action.error}</Notice></div>}
      <DrawingCanvas key={current._id} teamId={teamId} canvasId={current._id} userId={userId} name={current.name} readOnly={!canEdit} agent={agent} lead={tabs} />
    </div>
  );
}
