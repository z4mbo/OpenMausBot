import { originIssueKey } from "../../../../shared/origin-issues";
import { worldOrigin, type CanvasNode, type Scene } from "../../../../shared/canvas-scene";
import { useOpenOriginIssue } from "@/lib/origin-issue-focus";
import { cn } from "@/lib/cn";
import { toScreen, type View } from "./geometry";

export type DesignLink = { _id: string; taskId: string; canvasId: string; canvasName: string; frameId: string; frameName: string; agentName?: string; status: "draft" | "review" | "approved"; title: string; done: boolean };

const STATUS = { draft: "Draft", review: "In review", approved: "Approved" } as const;

const onPage = (scene: Scene, index: ReadonlyMap<string | null, readonly CanvasNode[]>, node: CanvasNode) => {
  let top = node;
  while (top.parentId && scene.get(top.parentId)) top = scene.get(top.parentId)!;
  return (index.get(null) ?? []).some((root) => root.id === top.id);
};

/** The issue each designing frame belongs to, as a chip above the frame's top-right corner that opens the issue. */
export function IssueChips({ links, scene, index, view, projectId }: { links: readonly DesignLink[]; scene: Scene; index: ReadonlyMap<string | null, readonly CanvasNode[]>; view: View; projectId: string }) {
  const open = useOpenOriginIssue();
  return (
    <div data-canvas-chrome className="pointer-events-none absolute inset-0 z-[4] overflow-hidden">
      {links.map((link) => {
        const frame = scene.get(link.frameId);
        if (!frame || frame.deleted || frame.hidden || !onPage(scene, index, frame)) return null;
        const origin = worldOrigin(scene, frame);
        const corner = toScreen(view, { x: origin.x + frame.width, y: origin.y });
        return (
          <button key={link._id} type="button" data-issue-chip={link.taskId} title={`${link.title}${link.agentName ? ` · designed by ${link.agentName}` : ""}`}
            onClick={() => open({ projectId, issueId: link.taskId })}
            className={cn("pointer-events-auto absolute flex h-5 -translate-x-full -translate-y-[calc(100%+4px)] items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[10.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
              link.status === "approved" ? "border-success/40 bg-success/15 text-success" : "border-accent/40 bg-accent/15 text-accent-text hover:bg-accent/25")}
            style={{ left: corner.x, top: corner.y }}>
            {originIssueKey(link.taskId)}<span className="text-ink-tertiary">·</span>{STATUS[link.status]}
          </button>
        );
      })}
    </div>
  );
}
