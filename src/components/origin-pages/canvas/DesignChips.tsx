import { Frame } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { requestCanvasFocus } from "@/lib/origin-canvas-focus";
import { cn } from "@/lib/cn";
import type { DesignLink } from "./IssueChips";

const STATUS = { draft: "draft", review: "in review", approved: "approved" } as const;

/** The canvas frames that design an issue, as chips that open the canvas on the frame. */
export function DesignChips({ projectId, taskId, onOpen, className }: { projectId: string; taskId: string; onOpen?: () => void; className: string }) {
  const links = useCloudQuery<DesignLink[]>("canvasCollab:designsForIssue", { taskId });
  if (!links?.length) return null;
  return <>
    {links.map((link) => (
      <button key={link._id} type="button" className={className} data-design-chip={link.frameId} title={`${link.canvasName} · ${link.frameName}${link.agentName ? ` · by ${link.agentName}` : ""}`}
        onClick={() => { requestCanvasFocus({ projectId, canvasId: link.canvasId, frameId: link.frameId }); onOpen?.(); }}>
        <Frame size={14} aria-hidden="true" className="shrink-0" />Design<span className="max-w-32 truncate text-ink-secondary">{link.frameName}</span>
        <span className={cn(link.status === "approved" ? "text-success" : "text-ink-tertiary")}>{STATUS[link.status]}</span>
      </button>
    ))}
  </>;
}
