import { useEffect } from "react";
import { PenTool, Presentation, StickyNote, type LucideIcon } from "lucide-react";
import { useCloudQuery, useCloudSession } from "@/lib/origin-cloud";
import { consumeCanvasFocus, useCanvasFocus } from "@/lib/origin-canvas-focus";
import { useDesignView } from "@/lib/origin-design-view";
import { cn } from "@/lib/cn";
import type { Bot } from "@/state/store";
import { canvasKind, type CanvasKind } from "../../../shared/origin-design";
import { ProjectCanvases } from "../OriginDraw";
import { CloudGate, EmptyState, type OriginPageProps } from "../origin-pages/ui";

const VIEWS: readonly { kind: CanvasKind; label: string; icon: LucideIcon; title: string }[] = [
  { kind: "design", label: "Design", icon: PenTool, title: "Design files: frames, components, prototypes" },
  { kind: "board", label: "Board", icon: StickyNote, title: "Boards: freehand drawing, sticky notes, diagrams" },
  { kind: "deck", label: "Presentations", icon: Presentation, title: "Presentations: pitch decks and slides" },
];

export function DesignPage({ agent, ...props }: OriginPageProps & { agent: Bot }) {
  return <CloudGate {...props} label="Design">{({ project, projectId, canEdit }) => <Design projectId={projectId} teamId={project.teamId} canEdit={canEdit} agent={agent} />}</CloudGate>;
}

function Design({ projectId, teamId, canEdit, agent }: { projectId: string; teamId: string | undefined; canEdit: boolean; agent: Bot }) {
  const session = useCloudSession();
  const [chosen, setKind] = useDesignView(agent.id);
  const canvases = useCloudQuery<{ _id: string; kind?: CanvasKind }[]>("draw:canvases", { projectId });
  const focus = useCanvasFocus(projectId);
  const target = focus ? canvases?.find((canvas) => canvas._id === focus.canvasId) : undefined;
  const kind = target ? canvasKind(target.kind) : chosen;
  useEffect(() => { if (kind !== chosen) setKind(kind); }, [kind]);
  const switcher = <DesignViews value={kind} onChange={(next) => { if (focus) consumeCanvasFocus(focus); setKind(next); }} />;
  return (
    <section aria-label="Design" data-design-page={kind} className="flex min-h-0 min-w-0 flex-1 flex-col bg-app">
      {session.user && teamId
        ? <ProjectCanvases key={`${projectId}:${kind}`} kind={kind} projectId={projectId} teamId={teamId} userId={session.user._id} canEdit={canEdit} agent={agent} switcher={switcher} />
        : (
          <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]">
            <div className="flex h-11 shrink-0 items-start px-4 pb-3 md:px-6"><div className="flex h-8 items-center gap-3">{switcher}</div></div>
            <EmptyState icon={<PenTool size={22} />} title="Share this project to design together" />
          </div>
        )}
    </section>
  );
}

function DesignViews({ value, onChange }: { value: CanvasKind; onChange(kind: CanvasKind): void }) {
  return (
    <div role="group" aria-label="Design view" data-design-views className="flex shrink-0 rounded-lg bg-inset p-0.5">
      {VIEWS.map(({ kind, label, icon: Icon, title }) => (
        <button key={kind} type="button" aria-pressed={kind === value} aria-label={label} title={title} onClick={() => onChange(kind)}
          className={cn("flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-ink-secondary outline-none transition-colors duration-(--motion-fast) hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60",
            kind === value && "bg-raised text-ink")}>
          <Icon size={13} aria-hidden="true" /><span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
