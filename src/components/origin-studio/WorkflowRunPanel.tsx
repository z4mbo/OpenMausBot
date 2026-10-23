import { AlertTriangle, Ban, Check, FolderInput, Loader2, Play, Square, Type, X } from "lucide-react";
import { relativeTime } from "@/lib/memory";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { iconButton, inputClass, primaryButton, ghostButton } from "../origin-pages/ui";
import { KIND_ICON, MediaThumb } from "./studio-ui";
import { setBlank, templateBlanks } from "../../../shared/studio-blanks";
import type { StudioMediaKind, StudioParams } from "../../../shared/studio";
import { workflowInputs, type StudioWorkflowGraph, type StudioWorkflowRun, type WorkflowProblem } from "../../../shared/studio-workflow";

function RunMark({ status }: { status: StudioWorkflowRun["status"] }) {
  if (status === "running") return <Loader2 size={13} className="animate-spin text-accent-text" aria-label="Running" />;
  if (status === "done") return <Check size={13} className="text-success" aria-label="Done" />;
  if (status === "failed") return <AlertTriangle size={13} className="text-danger" aria-label="Failed" />;
  return <Ban size={13} className="text-ink-tertiary" aria-label="Stopped" />;
}

/**
 * The workflow as a form, as ComfyUI's app mode shows it: each Prompt node's text or its `[placeholders]`, each input
 * file, then Run, the run's results and the workflow's earlier runs.
 */
export function WorkflowRunPanel({ graph, canEdit, assets, characters, character, run, runs, problems, live, busy, ready, onParams, onPickAsset, onCharacter, onRun, onStop, onShowRun, onFocusNode, onClose }: {
  graph: StudioWorkflowGraph; canEdit: boolean; assets: ReadonlyMap<string, { name: string; url: string }>;
  characters: readonly { id: string; name: string }[]; character: string; run?: StudioWorkflowRun; runs: readonly StudioWorkflowRun[];
  problems: readonly WorkflowProblem[]; live: boolean; busy: boolean; ready: boolean;
  onParams(nodeId: string, params: StudioParams, field: string): void; onPickAsset(nodeId: string, kind: StudioMediaKind): void; onCharacter(id: string): void;
  onRun(): void; onStop(): void; onShowRun(runId: string): void; onFocusNode(nodeId: string): void; onClose?(): void;
}) {
  const inputs = workflowInputs(graph);
  const nodeOf = (id: string) => graph.nodes.find((entry) => entry.id === id)!;
  const outputs = (run?.nodes ?? []).filter((entry) => entry.output && graph.nodes.find((node) => node.id === entry.nodeId)?.type === "output");
  return (
    <aside className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-hairline/40 bg-panel lg:w-[320px]" aria-label="Run this workflow" data-workflow-run-panel>
      <div className="flex items-center gap-2 border-b border-hairline/40 px-3 py-2.5">
        <h3 className="flex-1 text-[13px] font-medium text-ink">Inputs</h3>
        <span className="text-[11.5px] tabular-nums text-ink-tertiary">{inputs.length} {inputs.length === 1 ? "field" : "fields"}</span>
        {onClose && <button type="button" className={cn(iconButton, "size-7")} onClick={onClose} aria-label="Hide the inputs"><X size={14} /></button>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {!inputs.length && <p className="text-[12.5px] text-ink-tertiary">Add a Prompt or an input file node and it shows up here as a field.</p>}
        {inputs.map((input) => {
          const node = nodeOf(input.nodeId);
          const label = (
            <button type="button" className="flex items-center gap-1.5 text-left text-[12px] font-medium text-ink-secondary hover:text-ink" onClick={() => onFocusNode(input.nodeId)} title="Show the node">
              {input.kind === "text" ? <Type size={12} aria-hidden="true" /> : <FolderInput size={12} aria-hidden="true" />}{input.label}
            </button>
          );
          if (input.kind === "text") {
            const text = String(node.params.text ?? "");
            const blanks = templateBlanks(text);
            return (
              <div key={input.nodeId} className="flex flex-col gap-1.5" data-run-input={input.nodeId}>
                {label}
                {blanks.length ? (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-hairline/40 bg-inset/60 p-2">
                    {blanks.map((blank, index) => (
                      <label key={`${blank.start}-${index}`} className="flex flex-col gap-0.5">
                        <span className="text-[11px] text-ink-tertiary">{blank.label || `Blank ${index + 1}`}</span>
                        <input className={cn(inputClass, "h-8 py-1 text-[12.5px]")} value={blank.value} disabled={!canEdit} data-run-blank={index}
                          onChange={(event) => onParams(input.nodeId, { ...node.params, text: setBlank(text, index, event.target.value) }, `text:${index}`)} />
                      </label>
                    ))}
                    <p className="line-clamp-2 text-[11px] leading-snug text-ink-tertiary" title={text}>{text}</p>
                  </div>
                ) : (
                  <textarea className={cn(inputClass, "resize-y text-[12.5px]")} rows={3} maxLength={8_000} value={text} disabled={!canEdit}
                    onChange={(event) => onParams(input.nodeId, { ...node.params, text: event.target.value }, "text")} />
                )}
              </div>
            );
          }
          const asset = assets.get(input.value);
          const Icon = KIND_ICON[input.kind];
          return (
            <div key={input.nodeId} className="flex flex-col gap-1.5" data-run-input={input.nodeId}>
              {label}
              <button type="button" disabled={!canEdit} onClick={() => onPickAsset(input.nodeId, input.kind as StudioMediaKind)}
                className={cn("flex items-center gap-2.5 rounded-lg border p-1.5 text-left text-[12.5px] outline-none transition-colors duration-(--motion-fast) focus-visible:border-accent",
                  input.value ? "border-hairline/50 text-ink" : "border-dashed border-danger/50 text-ink-secondary hover:border-accent/60")}>
                {asset ? <MediaThumb kind={input.kind as StudioMediaKind} url={asset.url} className="size-11 shrink-0 rounded-md" /> : <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-inset text-ink-tertiary"><Icon size={16} /></span>}
                <span className="min-w-0 flex-1 truncate">{asset?.name ?? (input.value ? "Chosen file" : `Choose ${input.kind === "image" ? "an image" : `a ${input.kind} file`}`)}</span>
              </button>
            </div>
          );
        })}
        {characters.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-secondary">Every image and video step follows</span>
            <Select size="sm" className="w-full [&_select]:w-full" value={character} disabled={!canEdit} onChange={(event) => onCharacter(event.target.value)} aria-label="Character for every step">
              <option value="">Each step's own setting</option>
              {characters.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </Select>
          </label>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-hairline/40 p-3">
        {problems.length > 0 && !live && (
          <button type="button" className="text-left text-[12px] text-danger hover:underline" onClick={() => problems[0]!.nodeId && onFocusNode(problems[0]!.nodeId)}>
            {problems[0]!.message}{problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}
          </button>
        )}
        {live ? (
          <button type="button" className={cn(ghostButton, "w-full justify-center")} onClick={onStop} disabled={busy}><Square size={13} />Stop the run</button>
        ) : (
          <button type="button" className={cn(primaryButton, "w-full justify-center")} onClick={onRun} disabled={!ready} title="Run (Ctrl+Enter)" data-run-panel-run>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}Run workflow
          </button>
        )}
        {outputs.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5" aria-label="This run's results" data-run-results>
            {outputs.map((entry) => (
              <a key={entry.nodeId} href={entry.output!.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md bg-inset" title={String(nodeOf(entry.nodeId)?.params.name || "Result")}>
                <MediaThumb kind={entry.output!.kind} url={entry.output!.url} className="aspect-square w-full" />
              </a>
            ))}
          </div>
        )}
        {runs.length > 0 && (
          <details className="group/runs" open={runs.length <= 3}>
            <summary className="cursor-pointer list-none text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-tertiary hover:text-ink-secondary">History · {runs.length}</summary>
            <ul className="mt-1.5 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {runs.slice(0, 12).map((entry) => {
                const thumb = entry.nodes.find((node) => node.output && entry.graph.nodes.find((graphNode) => graphNode.id === node.nodeId)?.type === "output");
                return (
                  <li key={entry._id}>
                    <button type="button" onClick={() => onShowRun(entry._id)} aria-pressed={entry._id === run?._id}
                      className={cn("flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-ink-secondary hover:bg-raised", entry._id === run?._id && "bg-raised text-ink")}>
                      <RunMark status={entry.status} />
                      <span className="min-w-0 flex-1 truncate">{entry.agentName ?? entry.createdByName} · {relativeTime(entry.createdAt)}</span>
                      {thumb?.output && <MediaThumb kind={thumb.output.kind} url={thumb.output.url} className="size-6 rounded" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    </aside>
  );
}
