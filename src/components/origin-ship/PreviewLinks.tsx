import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { SHIP_PROVIDER_LABEL, deploymentBusy, type ShipPreview } from "../../../shared/origin-ship";
import { PROVIDER_ICON } from "./TargetCard";
import { STATE_DOT, STATE_LABEL, hostOf } from "./ship-model";

/** A pull request's preview deployments as links; a preview still building says so instead of linking. */
export function PreviewLinks({ previews, className }: { previews: readonly ShipPreview[] | undefined; className?: string }) {
  if (!previews?.length) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label="Preview deployments">
      {previews.map((preview) => {
        const Icon = PROVIDER_ICON[preview.provider];
        const title = `${preview.targetName} on ${SHIP_PROVIDER_LABEL[preview.provider]}: ${STATE_LABEL[preview.state]}${preview.state === "ready" ? ` · ${hostOf(preview.url)}` : ""}`;
        const face = (
          <>
            <Icon size={11} aria-hidden="true" />
            <span className={cn("size-1.5 rounded-full", STATE_DOT[preview.state])} aria-hidden="true" />
            Preview{deploymentBusy(preview.state) ? " building" : preview.state === "ready" ? "" : ` ${STATE_LABEL[preview.state].toLowerCase()}`}
            {preview.state === "ready" && <ExternalLink size={10} aria-hidden="true" />}
          </>
        );
        const chip = "inline-flex min-h-6 items-center gap-1 rounded-full border border-hairline/50 bg-raised/60 px-2 py-0.5 text-[11.5px] font-medium text-ink-secondary";
        return (
          <li key={preview.targetId}>
            {preview.state === "ready"
              ? <a href={preview.url} target="_blank" rel="noreferrer" title={title} className={cn(chip, "transition-colors duration-(--motion-fast) hover:border-hairline hover:text-ink")}>{face}</a>
              : <span title={title} className={chip}>{face}</span>}
          </li>
        );
      })}
    </ul>
  );
}
