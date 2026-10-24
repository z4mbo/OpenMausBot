import { Check, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import type { Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { placeLabelKey, type Place } from "@/lib/place";
import { nameIsCommand } from "@/lib/verify-steps";
import { useAdvancedMode } from "@/lib/interface-mode";
import { toolStepLabel } from "@/lib/tool-step-label";
import { PlaceIcon } from "./PlaceIcon";
import { WorkingDots } from "./WorkingIndicator";

export function ToolActivity({ tool, place = null }: { tool: NonNullable<Message["tool"]>; place?: Place | null }) {
  const [expanded, setExpanded] = useState(false);
  const failed = tool.ok === false;
  const advanced = useAdvancedMode();
  const label = advanced ? tool.name : toolStepLabel(tool);
  const status = tool.ok === undefined ? t("toolDetail.running") : failed ? t("toolDetail.failed") : t("toolDetail.completed");
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)} className="group/tool w-fit max-w-full overflow-hidden rounded-lg border border-hairline/40 bg-panel/70 text-[12.5px] transition-colors open:w-[min(38rem,100%)] open:bg-panel" data-testid="tool-activity">
      <summary
        role="button"
        aria-expanded={expanded}
        aria-label={t("toolDetail.label", { name: label, status })}
        className={cn("flex min-h-8 cursor-pointer list-none items-center gap-2 px-2.5 py-1 transition-colors hover:bg-control/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden", failed ? "text-danger" : "text-ink-secondary hover:text-ink")}
      >
        <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full", tool.ok === undefined ? "" : failed ? "bg-danger/15" : "bg-success/15")} aria-hidden="true">{tool.ok === undefined ? <WorkingDots size={3.5} /> : failed ? <X size={11} strokeWidth={2.5} /> : <Check size={11} strokeWidth={2.5} className="text-success" />}</span>
        {place && <PlaceIcon place={place} size={13} className="shrink-0 opacity-70" role="img" aria-label={t(placeLabelKey(place))} data-testid="tool-place" />}
        <span className={cn("min-w-0 max-w-[30rem] truncate leading-5", advanced ? "font-mono" : "font-medium")}>{label}</span>
        {advanced && tool.summary && tool.summary !== tool.name && !nameIsCommand(tool.name) && <span className="min-w-0 flex-1 truncate font-mono" title={tool.summary}>{tool.summary}</span>}
        <ChevronRight size={13} className="ml-auto shrink-0 opacity-70 transition-transform group-open/tool:rotate-90" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-hairline/40 px-3 pb-3 pt-2.5 text-ink-secondary">
        <div className={cn("text-[11px] font-medium", failed && "text-danger")}>{status}</div>
        {label !== tool.name && <div>
          <div className="mb-1 text-[11px] font-medium">{t("toolDetail.tool")}</div>
          <p dir="ltr" className="break-words font-mono text-xs text-ink" data-testid="tool-name">{tool.name}</p>
        </div>}
        <div>
          <div className="mb-1 text-[11px] font-medium">{t("toolDetail.input")}</div>
          <pre dir="ltr" className="max-h-52 overflow-auto rounded-md border border-hairline/30 bg-inset p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-ink">{tool.input ?? tool.summary ?? tool.name}</pre>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium">{t("toolDetail.output")}</div>
          {tool.output ? <pre dir="ltr" className="max-h-64 overflow-auto rounded-md border border-hairline/30 bg-inset p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-ink">{tool.output}</pre> : <p className="text-xs">{tool.ok === undefined ? t("toolDetail.waiting") : t("toolDetail.noOutput")}</p>}
        </div>
        <p className="text-[11px] text-ink-secondary">{t("toolDetail.previewHint")}</p>
      </div>
    </details>
  );
}
