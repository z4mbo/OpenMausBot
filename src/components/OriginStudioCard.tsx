import { AlertTriangle, Ban, Check, Loader2, Sparkles, TextCursorInput, Workflow } from "lucide-react";
import type { Message } from "@/state/store";
import { useCloudQuery } from "@/lib/origin-cloud";
import { useCanOpenOriginProject } from "@/lib/origin-issue-focus";
import { useOpenOriginStudio } from "@/lib/studio-focus";
import { cn } from "@/lib/cn";
import { PresetTile } from "./origin-studio/StudioTemplates";
import { MediaThumb } from "./origin-studio/studio-ui";
import { KIND_ICON } from "./origin-studio/studio-ui";
import { CardFrame } from "./origin-cards/CardFrame";
import { studioPreset } from "../../shared/studio-presets";
import type { OriginStudioCardGeneration, OriginStudioCardRun, OriginStudioCardTemplate } from "../../shared/origin-studio-cards";
import type { StudioWorkflowRun } from "../../shared/studio-workflow";
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

function TemplateCardTile({ template, onOpen }: { template: OriginStudioCardTemplate; onOpen?(): void }) {
  const body = (
    <>
      <span className="relative block aspect-[4/5] overflow-hidden bg-inset">
        {template.cover && <MediaThumb kind={template.cover.kind} url={template.cover.url} className="size-full" />}
        <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" aria-hidden="true" />
        <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-2 text-left text-white">
          <span className="truncate text-[12.5px] font-semibold">{template.name}</span>
          {template.blanks.length > 0 && <span className="flex items-center gap-1 truncate text-[10.5px] text-white/75"><TextCursorInput size={10} aria-hidden="true" />{template.blanks.join(", ")}</span>}
          {template.inputs.length > 0 && <span className="truncate text-[10.5px] text-white/60">{template.inputs.join(" + ")}</span>}
        </span>
      </span>
    </>
  );
  return (
    <li className="min-w-0 overflow-hidden rounded-xl border border-hairline/40" data-origin-studio-template={template.id} title={template.description}>
      {onOpen ? <button type="button" onClick={onOpen} className="block w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60">{body}</button> : body}
    </li>
  );
}

function RunTile({ run, onOpen }: { run: OriginStudioCardRun; onOpen?(): void }) {
  const mark = run.status === "running" ? <Loader2 size={13} className="animate-spin text-accent-text" aria-hidden="true" />
    : run.status === "done" ? <Check size={13} className="text-success" aria-hidden="true" />
      : run.status === "failed" ? <AlertTriangle size={13} className="text-danger" aria-hidden="true" /> : <Ban size={13} className="text-ink-tertiary" aria-hidden="true" />;
  const label = run.status === "running" ? `Running · ${run.done} of ${run.total}` : run.status === "done" ? "Finished" : run.status === "failed" ? "Failed" : "Stopped";
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-hairline/40 bg-panel p-2.5" data-origin-studio-run={run.id} data-status={run.status}>
      <div className="flex min-w-0 items-center gap-2">
        <Workflow size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        {onOpen
          ? <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-ink outline-none hover:underline focus-visible:underline">{run.name}</button>
          : <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{run.name}</span>}
        <span className="flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums text-ink-secondary" role="status">{mark}{label}</span>
      </div>
      <span className="relative h-1 overflow-hidden rounded-full bg-hairline/40" aria-hidden="true">
        <span className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-(--motion-slow)", run.status === "failed" ? "bg-danger" : "bg-accent")} style={{ width: `${Math.round((run.done / Math.max(run.total, 1)) * 100)}%` }} />
      </span>
      {run.outputs.length > 0 && (
        <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" aria-label="Results">
          {run.outputs.map((output) => (
            <li key={output.url} className="overflow-hidden rounded-md bg-inset" title={output.name}>
              {output.kind === "audio" ? <audio src={output.url} controls preload="none" className="w-full" /> : <MediaThumb kind={output.kind} url={output.url} className="aspect-square w-full" />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const liveRun = (run: OriginStudioCardRun, now: StudioWorkflowRun | undefined): OriginStudioCardRun => {
  if (!now) return run;
  const outputs = now.nodes.flatMap((node) => {
    const graphNode = now.graph.nodes.find((candidate) => candidate.id === node.nodeId);
    return graphNode?.type === "output" && node.output ? [{ ...node.output, name: String(graphNode.params.name || now.name) }] : [];
  });
  return { ...run, status: now.status, done: now.nodes.filter((node) => node.status === "done").length, total: now.nodes.length, outputs };
};

/** Generations and presets a Studio tool returned, live while this app reaches the project, each opening Studio. */
export function OriginStudioCard({ message }: { message: Message }) {
  const cards = message.originStudio;
  const openable = useCanOpenOriginProject(cards?.projectId ?? "");
  const open = useOpenOriginStudio();
  const live = useCloudQuery<StudioGeneration[]>("studio:list", openable && cards?.generations?.length ? { projectId: cards.projectId } : "skip");
  const liveRuns = useCloudQuery<StudioWorkflowRun[]>("studioWorkflows:runs", openable && cards?.runs?.length ? { projectId: cards.projectId } : "skip");
  if (!cards || (!cards.generations?.length && !cards.presets?.length && !cards.templates?.length && !cards.runs?.length)) return null;
  const runs = (cards.runs ?? []).map((run) => liveRun(run, liveRuns?.find((entry) => entry._id === run.id)));
  const rows = (cards.generations ?? []).map((row) => {
    const now = live?.find((entry) => entry._id === row.id);
    return now ? { ...row, status: now.status, outputs: now.outputs.map(({ url, kind }) => ({ url, kind })), ...(now.error ? { error: now.error } : {}) } : row;
  });
  const presets = (cards.presets ?? []).flatMap((id) => { const preset = studioPreset(id); return preset ? [preset] : []; });
  return (
    <CardFrame kind="studio" data={{ "data-origin-studio": message.id }} label={cards.heading} icon={Sparkles} title={cards.heading} wide>
      {rows.length > 0 && (
        <ol className={cn("mt-2.5 grid gap-2", rows.length === 1 ? "grid-cols-1 max-w-[16rem]" : "grid-cols-2 sm:grid-cols-3")} aria-label="Generations">
          {rows.map((row) => <GenerationTile key={row.id} row={row} onOpen={openable ? () => open({ projectId: cards.projectId, generationId: row.id }) : undefined} />)}
        </ol>
      )}
      {runs.length > 0 && (
        <ol className="mt-2.5 flex flex-col gap-2" aria-label="Workflow runs">
          {runs.map((run) => <RunTile key={run.id} run={run} onOpen={openable ? () => open({ projectId: cards.projectId, runId: run.id }) : undefined} />)}
        </ol>
      )}
      {(cards.templates?.length ?? 0) > 0 && (
        <ul className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2" aria-label="Templates">
          {cards.templates!.map((template) => <TemplateCardTile key={template.id} template={template} onOpen={openable ? () => open({ projectId: cards.projectId, templateId: template.id }) : undefined} />)}
        </ul>
      )}
      {presets.length > 0 && (
        <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2" aria-label="Presets">
          {presets.map((preset) => (
            <PresetTile key={preset.id} preset={preset} onPick={() => { if (openable) open({ projectId: cards.projectId, presetId: preset.id }); }} />
          ))}
        </div>
      )}
      {!openable && <p className="pt-2 text-[12px] text-ink-tertiary">Open this project in Origin to use them in Studio.</p>}
    </CardFrame>
  );
}
