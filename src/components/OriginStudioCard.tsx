import { AlertTriangle, Loader2 } from "lucide-react";
import type { Message } from "@/state/store";
import { useCloudQuery } from "@/lib/origin-cloud";
import { useCanOpenOriginProject } from "@/lib/origin-issue-focus";
import { useOpenOriginStudio } from "@/lib/studio-focus";
import { cn } from "@/lib/cn";
import { PresetTile } from "./origin-studio/StudioPresets";
import { KIND_ICON } from "./origin-studio/studio-ui";
import { studioPreset } from "../../shared/studio-presets";
import type { OriginStudioCardGeneration } from "../../shared/origin-studio-cards";
import type { StudioGeneration } from "../../shared/studio";

function GenerationTile({ row, onOpen }: { row: OriginStudioCardGeneration; onOpen?(): void }) {
  const output = row.outputs[0];
  const Icon = KIND_ICON[output?.kind ?? row.kind];
  const working = row.status === "queued" || row.status === "running";
  return (
    <li data-origin-studio-generation={row.id} data-status={row.status} className="min-w-0">
      <figure className="flex flex-col overflow-hidden rounded-xl border border-hairline/40 bg-panel">
        <div className={cn("relative flex items-center justify-center overflow-hidden bg-inset", output?.kind === "audio" ? "h-16 px-2" : "aspect-square")}>
          {output?.kind === "image" && <img src={output.url} alt={row.prompt} loading="lazy" className="size-full object-cover" />}
          {output?.kind === "video" && <video src={output.url} muted loop playsInline controls preload="metadata" className="size-full object-cover" />}
          {output?.kind === "audio" && <audio src={output.url} controls preload="none" className="w-full" />}
          {!output && (working
            ? <span className="flex flex-col items-center gap-1.5 text-[11.5px] text-ink-tertiary"><Loader2 size={16} className="animate-spin text-accent-text" />{row.status === "queued" ? "Queued" : "Generating"}</span>
            : row.status === "failed"
              ? <span className="flex flex-col items-center gap-1.5 px-2 text-center text-[11.5px] text-danger"><AlertTriangle size={16} />{row.error ? row.error.slice(0, 80) : "Failed"}</span>
              : <Icon size={18} className="text-ink-tertiary" aria-hidden="true" />)}
        </div>
        <figcaption className="flex min-w-0 items-center gap-1.5 px-2 py-1.5">
          {onOpen
            ? <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-[11.5px] text-ink-secondary outline-none hover:text-ink focus-visible:underline" title={row.prompt}>{row.prompt || row.modelLabel}</button>
            : <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-secondary" title={row.prompt}>{row.prompt || row.modelLabel}</span>}
          <span className="shrink-0 text-[10.5px] text-ink-tertiary">{row.modelLabel}</span>
        </figcaption>
      </figure>
    </li>
  );
}

/** Generations and presets a Studio tool returned, live while this app reaches the project, each opening Studio. */
export function OriginStudioCard({ message }: { message: Message }) {
  const cards = message.originStudio;
  const openable = useCanOpenOriginProject(cards?.projectId ?? "");
  const open = useOpenOriginStudio();
  const live = useCloudQuery<StudioGeneration[]>("studio:list", openable && cards?.generations?.length ? { projectId: cards.projectId } : "skip");
  if (!cards || (!cards.generations?.length && !cards.presets?.length)) return null;
  const rows = (cards.generations ?? []).map((row) => {
    const now = live?.find((entry) => entry._id === row.id);
    return now ? { ...row, status: now.status, outputs: now.outputs.map(({ url, kind }) => ({ url, kind })), ...(now.error ? { error: now.error } : {}) } : row;
  });
  const presets = (cards.presets ?? []).flatMap((id) => { const preset = studioPreset(id); return preset ? [preset] : []; });
  return (
    <section data-origin-studio={message.id} aria-label={cards.heading} className="w-full max-w-[34rem] rounded-2xl bg-inset/50 p-2">
      <div className="px-2 pb-2 pt-1 text-[12px] text-ink-tertiary">{cards.heading}</div>
      {rows.length > 0 && (
        <ol className={cn("grid gap-2 p-0.5", rows.length === 1 ? "grid-cols-1 max-w-[16rem]" : "grid-cols-2 sm:grid-cols-3")} aria-label="Generations">
          {rows.map((row) => <GenerationTile key={row.id} row={row} onOpen={openable ? () => open({ projectId: cards.projectId, generationId: row.id }) : undefined} />)}
        </ol>
      )}
      {presets.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 p-0.5" aria-label="Presets">
          {presets.map((preset) => (
            <PresetTile key={preset.id} preset={preset} onPick={() => { if (openable) open({ projectId: cards.projectId, presetId: preset.id }); }} />
          ))}
        </div>
      )}
      {!openable && <div className="px-2 pb-1 pt-1.5 text-[11.5px] text-ink-tertiary">Open this project in Origin to use them in Studio.</div>}
    </section>
  );
}
