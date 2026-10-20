import { useState } from "react";
import { AlertTriangle, Ban, Check, Loader2, Plus, Trash2, Workflow } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { relativeTime } from "@/lib/memory";
import { cn } from "@/lib/cn";
import { Loading, cardClass, iconButton } from "../origin-pages/ui";
import { WorkflowEditor, type WorkflowDraft } from "./WorkflowEditor";
import { MediaThumb } from "./studio-ui";
import type { StudioGeneration } from "../../../shared/studio";
import { STUDIO_WORKFLOW_TEMPLATES, workflowNodeModel, type StudioWorkflow, type StudioWorkflowGraph, type StudioWorkflowRun } from "../../../shared/studio-workflow";

function steps(graph: StudioWorkflowGraph): string {
  return graph.nodes.filter((node) => node.type === "model").map((node) => workflowNodeModel(node)?.label ?? "Model").join(" → ") || "No steps yet";
}

function RunMark({ status }: { status: StudioWorkflowRun["status"] }) {
  if (status === "running") return <Loader2 size={13} className="animate-spin text-accent-text" aria-label="Running" />;
  if (status === "done") return <Check size={13} className="text-success" aria-label="Done" />;
  if (status === "failed") return <AlertTriangle size={13} className="text-danger" aria-label="Failed" />;
  return <Ban size={13} className="text-ink-tertiary" aria-label="Stopped" />;
}

function WorkflowCard({ name, description, graph, meta, onOpen, onRemove }: { name: string; description?: string; graph: StudioWorkflowGraph; meta?: string; onOpen(): void; onRemove?(): void }) {
  return (
    <article className={cn(cardClass, "group relative flex flex-col transition-colors duration-(--motion-fast) hover:border-hairline")}>
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col gap-1.5 rounded-xl p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <span className="flex items-center gap-2 text-[13.5px] font-medium text-ink"><Workflow size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" /><span className="truncate">{name}</span></span>
        {description && <span className="line-clamp-2 text-[12px] text-ink-secondary">{description}</span>}
        <span className="line-clamp-2 text-[11.5px] text-ink-tertiary">{steps(graph)}</span>
        {meta && <span className="text-[11.5px] text-ink-tertiary">{meta}</span>}
      </button>
      {onRemove && (
        <button type="button" className={cn(iconButton, "absolute right-1.5 top-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100")} onClick={onRemove} aria-label={`Delete ${name}`}><Trash2 size={13} /></button>
      )}
    </article>
  );
}

/** Saved workflows, templates and recent runs; opening one shows its node graph. */
export function StudioWorkflows({ projectId, canEdit, falReady, rows }: { projectId: string; canEdit: boolean; falReady: boolean | null; rows: readonly StudioGeneration[] }) {
  const workflows = useCloudQuery<StudioWorkflow[]>("studioWorkflows:list", { projectId });
  const runs = useCloudQuery<StudioWorkflowRun[]>("studioWorkflows:runs", { projectId });
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [error, setError] = useState("");
  if (draft) return <WorkflowEditor projectId={projectId} canEdit={canEdit} falReady={falReady} rows={rows} draft={draft} onDraft={setDraft} onBack={() => setDraft(null)} />;
  const remove = (workflow: StudioWorkflow) => {
    if (!window.confirm(`Delete ${workflow.name}? Its runs and outputs stay.`)) return;
    void cloudMutation("studioWorkflows:remove", { projectId, workflowId: workflow._id }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const lastRun = (workflowId: string) => runs?.find((run) => run.workflowId === workflowId);
  return (
    <div className="flex flex-col gap-6 pb-6" data-studio-workflows>
      {error && <p className="text-[12.5px] text-danger" role="alert">{error}</p>}
      <section aria-label="Your workflows">
        <h3 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">Workflows</h3>
        {!workflows ? <Loading label="Loading workflows" variant="grid" /> : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3">
            {canEdit && (
              <button type="button" onClick={() => setDraft({ name: "Untitled workflow", graph: { nodes: [], edges: [] } })}
                className="flex min-h-[104px] items-center justify-center gap-2 rounded-xl border border-dashed border-hairline text-[13px] text-ink-secondary outline-none transition-colors duration-(--motion-fast) hover:border-accent/60 hover:text-ink focus-visible:border-accent">
                <Plus size={15} />New workflow
              </button>
            )}
            {workflows.map((workflow) => {
              const run = lastRun(workflow._id);
              return (
                <WorkflowCard key={workflow._id} name={workflow.name} description={workflow.description} graph={workflow.graph}
                  meta={`${workflow.updatedByName} · ${relativeTime(workflow.updatedAt)}${run ? ` · last run ${run.status === "done" ? "finished" : run.status}` : ""}`}
                  onOpen={() => setDraft({ workflowId: workflow._id, name: workflow.name, graph: workflow.graph })} onRemove={canEdit ? () => remove(workflow) : undefined} />
              );
            })}
          </div>
        )}
      </section>
      <section aria-label="Templates">
        <h3 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">Templates</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3">
          {STUDIO_WORKFLOW_TEMPLATES.map((template) => (
            <WorkflowCard key={template.id} name={template.name} description={template.description} graph={template.graph}
              onOpen={() => setDraft({ name: template.name, graph: structuredClone(template.graph) })} />
          ))}
        </div>
      </section>
      {runs && runs.length > 0 && (
        <section aria-label="Recent runs">
          <h3 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">Recent runs</h3>
          <div className={cn(cardClass, "divide-y divide-hairline/30")}>
            {runs.slice(0, 12).map((run) => {
              const outputs = run.nodes.filter((node) => node.output && run.graph.nodes.find((graphNode) => graphNode.id === node.nodeId)?.type === "output");
              const done = run.nodes.filter((node) => node.status === "done").length;
              return (
                <button key={run._id} type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-raised/40 focus-visible:bg-raised/60" data-studio-run={run.status}
                  onClick={() => setDraft({ ...(run.workflowId ? { workflowId: run.workflowId } : {}), name: run.name, graph: run.graph })}>
                  <RunMark status={run.status} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] text-ink">{run.name}</span>
                    <span className="truncate text-[11.5px] text-ink-tertiary">{run.agentName ?? run.createdByName} · {relativeTime(run.createdAt)} · {done} of {run.nodes.length} steps</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {outputs.slice(0, 3).map((node) => <MediaThumb key={node.nodeId} kind={node.output!.kind} url={node.output!.url} className="size-9 rounded-md" />)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
