import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Loader2, Maximize, Minus, Play, Plus, Save, Square } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { chipButton, ghostButton, iconButton, inputClass, Notice, primaryButton, useAction } from "../origin-pages/ui";
import { StudioMediaPicker } from "./StudioMediaPicker";
import { WorkflowNodeCard, portColor } from "./WorkflowNodeCard";
import { Popover, studioPost, typing } from "./studio-ui";
import { edgePath, fitView, newNodeId, portPoint, toGraph, zoomAt, type Point, type View } from "./workflow-geometry";
import { studioModel, type StudioGeneration, type StudioMediaKind, type StudioParams } from "../../../shared/studio";
import {
  WORKFLOW_PALETTE, portsConnect, validateWorkflow, workflowPorts,
  type StudioNodeType, type StudioPort, type StudioWorkflowGraph, type StudioWorkflowNode, type StudioWorkflowRun,
} from "../../../shared/studio-workflow";
import type { CloudDesign } from "../origin-pages/cloud-types";

/** The workflow being edited: a saved one has its id, a template or new one does not until saved. */
export interface WorkflowDraft {
  workflowId?: string;
  name: string;
  graph: StudioWorkflowGraph;
}

type Linking = { node: string; port: StudioPort; side: "in" | "out"; at: Point };

const PRESETS: readonly { label: string; type: StudioNodeType; params: StudioParams }[] = [
  { label: "Prompt", type: "prompt", params: { label: "Prompt", text: "" } },
  { label: "Image from Assets", type: "asset", params: { kind: "image", label: "Image", assetId: "" } },
  { label: "Video from Assets", type: "asset", params: { kind: "video", label: "Video", assetId: "" } },
  { label: "Audio from Assets", type: "asset", params: { kind: "audio", label: "Audio", assetId: "" } },
  { label: "Text overlay", type: "model", params: { model: "fal-ai/nano-banana-pro/edit", prompt: "Add the headline \"Launch day\" in clean bold type, keeping everything else unchanged" } },
  { label: "Output to Assets", type: "output", params: { name: "" } },
];

export function WorkflowEditor({ projectId, canEdit, falReady, rows, draft, onDraft, onBack }: {
  projectId: string; canEdit: boolean; falReady: boolean | null; rows: readonly StudioGeneration[];
  draft: WorkflowDraft; onDraft(draft: WorkflowDraft): void; onBack(): void;
}) {
  const { graph } = draft;
  const surface = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 24, y: 24, zoom: 1 });
  const [selected, setSelected] = useState<{ node?: string; edge?: string }>({});
  const [linking, setLinking] = useState<Linking | null>(null);
  const [palette, setPalette] = useState(false);
  const [picking, setPicking] = useState<{ node: string; kind: StudioMediaKind } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const saving = useAction();
  const running = useAction();
  const design = useCloudQuery<CloudDesign>("design:list", { projectId });
  const runs = useCloudQuery<StudioWorkflowRun[]>("studioWorkflows:runs", draft.workflowId ? { projectId, workflowId: draft.workflowId } : "skip");
  const ownRun = useCloudQuery<StudioWorkflowRun>("studioWorkflows:getRun", runId ? { projectId, runId } : "skip");
  const run = ownRun ?? runs?.[0];
  const problems = useMemo(() => validateWorkflow(graph), [graph]);
  const problemOf = useMemo(() => new Map(problems.filter((problem) => problem.nodeId).map((problem) => [problem.nodeId!, problem.message])), [problems]);
  const states = useMemo(() => new Map((run?.nodes ?? []).map((node) => [node.nodeId, node])), [run]);
  const live = run?.status === "running";
  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const latest = useRef(draft);
  latest.current = draft;
  const setGraph = useCallback((next: StudioWorkflowGraph) => {
    setDirty(true);
    latest.current = { ...latest.current, graph: next };
    onDraft(latest.current);
  }, [onDraft]);

  const fit = useCallback(() => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return;
    const heights = new Map([...surface.current!.querySelectorAll<HTMLElement>("[data-workflow-node]")].map((element) => [element.dataset.workflowNode!, element.offsetHeight]));
    setView(fitView(graph, box.width, box.height, heights));
  }, [graph]);

  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    fit();
  }, [fit]);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const point = { x: event.clientX - box.left, y: event.clientY - box.top };
      const mouseWheel = event.deltaMode !== 0 || (event.deltaX === 0 && Math.abs(event.deltaY) >= 50);
      if (event.ctrlKey || event.metaKey || mouseWheel) {
        setView((current) => zoomAt(current, point, Math.exp(-event.deltaY * 0.0015)));
      } else {
        setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const box = surface.current?.getBoundingClientRect();
    setView((current) => zoomAt(current, { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 }, factor));
  };

  const local = (event: { clientX: number; clientY: number }): Point => {
    const box = surface.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const drag = (onMove: (event: PointerEvent) => void, onUp?: (event: PointerEvent) => void) => {
    const up = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      onUp?.(event);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  const onBackground = (event: ReactPointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-workflow-node]")) return;
    setSelected({});
    const start = { x: event.clientX, y: event.clientY, view };
    drag((move) => setView({ ...start.view, x: start.view.x + move.clientX - start.x, y: start.view.y + move.clientY - start.y }));
  };

  const onDragStart = (id: string, event: ReactPointerEvent) => {
    if (!canEdit || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const node = graph.nodes.find((candidate) => candidate.id === id)!;
    const start = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y };
    drag((move) => {
      const x = Math.round(start.nodeX + (move.clientX - start.x) / view.zoom);
      const y = Math.round(start.nodeY + (move.clientY - start.y) / view.zoom);
      const current = latest.current.graph;
      setGraph({ ...current, nodes: current.nodes.map((candidate) => (candidate.id === id ? { ...candidate, x, y } : candidate)) });
    });
  };

  const connect = (from: { node: string; port: string }, to: { node: string; port: string }) => {
    const graph = latest.current.graph;
    const source = graph.nodes.find((node) => node.id === from.node);
    const target = graph.nodes.find((node) => node.id === to.node);
    if (!source || !target || source.id === target.id) return;
    const out = workflowPorts(source).outputs.find((port) => port.id === from.port);
    const into = workflowPorts(target).inputs.find((port) => port.id === to.port);
    if (!out || !into || !portsConnect(out, into)) return;
    const edges = graph.edges.filter((edge) => !(edge.to === to.node && edge.toPort === to.port));
    setGraph({ ...graph, edges: [...edges, { id: `${from.node}-${to.node}-${to.port}`, from: from.node, fromPort: from.port, to: to.node, toPort: to.port }] });
  };

  const onPortDown = (id: string, side: "in" | "out", port: StudioPort, event: ReactPointerEvent) => {
    if (!canEdit || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    let origin = { node: id, port, side };
    if (side === "in") {
      const existing = graph.edges.find((edge) => edge.to === id && edge.toPort === port.id);
      if (!existing) return;
      const source = graph.nodes.find((node) => node.id === existing.from)!;
      origin = { node: source.id, port: workflowPorts(source).outputs.find((candidate) => candidate.id === existing.fromPort)!, side: "out" };
      setGraph({ ...graph, edges: graph.edges.filter((edge) => edge !== existing) });
    }
    setLinking({ ...origin, at: toGraph(local(event), view) });
    drag((move) => setLinking((current) => current && { ...current, at: toGraph(local(move), view) }), (up) => {
      setLinking(null);
      const target = (document.elementFromPoint(up.clientX, up.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-port-in]");
      if (target) connect({ node: origin.node, port: origin.port.id }, { node: target.dataset.portNode!, port: target.dataset.portIn! });
    });
  };

  const addNode = (type: StudioNodeType, params: StudioParams) => {
    const box = surface.current?.getBoundingClientRect();
    const centre = toGraph({ x: (box?.width ?? 600) / 2 - 124, y: (box?.height ?? 400) / 2 - 80 }, view);
    const offset = (graph.nodes.length % 5) * 24;
    const node: StudioWorkflowNode = { id: newNodeId(), type, x: Math.round(centre.x + offset), y: Math.round(centre.y + offset), params };
    setGraph({ ...graph, nodes: [...graph.nodes, node] });
    setSelected({ node: node.id });
    setPalette(false);
    window.setTimeout(() => surface.current?.querySelector<HTMLElement>(`[data-workflow-node="${node.id}"]`)?.focus(), 0);
  };

  const removeNode = (id: string) => {
    setGraph({ nodes: graph.nodes.filter((node) => node.id !== id), edges: graph.edges.filter((edge) => edge.from !== id && edge.to !== id) });
    setSelected({});
  };

  const save = () => {
    if (!canEdit || saving.busy) return;
    void saving.run(async () => {
      const workflowId = await cloudMutation<string>("studioWorkflows:save", { projectId, ...(draft.workflowId ? { workflowId: draft.workflowId } : {}), name: draft.name, graph });
      onDraft({ ...draft, workflowId });
      setDirty(false);
    }, "Could not save the workflow");
  };

  const start = () => {
    if (!canEdit || running.busy || problems.length || live || !falReady) return;
    void running.run(async () => {
      const { runId: id } = await studioPost<{ runId: string }>("workflow/run", { projectId, name: draft.name, graph, ...(draft.workflowId ? { workflowId: draft.workflowId } : {}) });
      setRunId(id);
    }, "Could not start the run");
  };

  const stop = () => {
    if (run && live) void running.run(() => studioPost("workflow/cancel", { projectId, runId: run._id }), "Could not stop the run");
  };

  const onKey = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); save(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); start(); return; }
    if (typing(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "f") { event.preventDefault(); fit(); return; }
    if (event.key === "n" && canEdit) { event.preventDefault(); setPalette(true); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && canEdit) {
      if (selected.edge) setGraph({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selected.edge) });
      else if (selected.node) removeNode(selected.node);
      else return;
      event.preventDefault();
      setSelected({});
      return;
    }
    if (selected.node && canEdit && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const step = event.shiftKey ? 48 : 12;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      setGraph({ ...graph, nodes: graph.nodes.map((node) => (node.id === selected.node ? { ...node, x: node.x + dx, y: node.y + dy } : node)) });
    }
  };

  const assets = new Map((design?.assets ?? []).map((asset) => [asset._id, { name: asset.name, url: asset.fileUrl || asset.url || "" }]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const linkedPorts = (id: string) => new Set(graph.edges.filter((edge) => edge.to === id).map((edge) => `in:${edge.toPort}`));
  const outputs = (run?.nodes ?? []).filter((node) => nodeById.get(node.nodeId)?.type === "output" && node.output);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pb-4" onKeyDown={onKey}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={iconButton} onClick={onBack} aria-label="All workflows"><ArrowLeft size={16} /></button>
        <input className={cn(inputClass, "w-56 max-w-[60vw] font-medium")} value={draft.name} aria-label="Workflow name" maxLength={120} disabled={!canEdit}
          onChange={(event) => { setDirty(true); onDraft({ ...draft, name: event.target.value }); }} />
        <div className="relative">
          <button type="button" className={chipButton} onClick={() => setPalette(!palette)} disabled={!canEdit} aria-expanded={palette} title="Add a node (N)"><Plus size={13} />Node</button>
          <Popover open={palette} onClose={() => setPalette(false)} label="Add a node" className="top-[calc(100%+6px)] bottom-auto">
            {PRESETS.map((preset) => (
              <button key={preset.label} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-raised focus-visible:bg-raised focus-visible:outline-none" onClick={() => addNode(preset.type, preset.params)}>{preset.label}</button>
            ))}
            {WORKFLOW_PALETTE.map((group) => (
              <div key={group.group} className="mt-1 border-t border-hairline/30 pt-1">
                <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">{group.group}</p>
                {group.models.map((id) => (
                  <button key={id} type="button" className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-raised focus-visible:bg-raised focus-visible:outline-none" onClick={() => addNode("model", { model: id })}>{studioModel(id)!.label}</button>
                ))}
              </div>
            ))}
          </Popover>
        </div>
        <button type="button" className={iconButton} onClick={fit} aria-label="Fit to view (F)" title="Fit to view (F)"><Maximize size={15} /></button>
        <span className="flex-1" />
        {problems.length > 0 && <span className="max-w-[260px] truncate text-[12px] text-ink-tertiary" title={problems.map((problem) => problem.message).join("\n")}>{problems[0]!.message}{problems.length > 1 ? ` +${problems.length - 1}` : ""}</span>}
        <button type="button" className={ghostButton} onClick={save} disabled={!canEdit || saving.busy || (!dirty && Boolean(draft.workflowId))} title="Save (Ctrl+S)">
          {saving.busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{draft.workflowId && !dirty ? "Saved" : "Save"}
        </button>
        {live ? (
          <button type="button" className={ghostButton} onClick={stop} disabled={running.busy}><Square size={13} />Stop</button>
        ) : (
          <button type="button" className={primaryButton} onClick={start} disabled={!canEdit || running.busy || problems.length > 0 || falReady !== true} title="Run (Ctrl+Enter)">
            {running.busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}Run
          </button>
        )}
      </div>
      {(saving.error || running.error) && <Notice tone="danger">{saving.error || running.error}</Notice>}
      {run && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-secondary" role="status" data-workflow-run={run.status}>
          <span className={cn("font-medium", run.status === "failed" ? "text-danger" : run.status === "done" ? "text-success" : "text-ink")}>
            {run.status === "running" ? `Running · ${run.nodes.filter((node) => node.status === "done").length} of ${run.nodes.length} steps` : run.status === "done" ? "Last run finished" : run.status === "failed" ? "Last run failed" : "Last run stopped"}
          </span>
          <span className="text-ink-tertiary">by {run.agentName ?? run.createdByName}</span>
          {outputs.length > 0 && <span className="text-ink-tertiary">· {outputs.length} saved to Assets</span>}
        </div>
      )}
      <div ref={surface} tabIndex={-1} onPointerDown={onBackground} data-workflow-canvas
        className="relative min-h-[420px] flex-1 touch-none overflow-hidden rounded-xl border border-hairline/40 bg-inset outline-none [background-image:radial-gradient(var(--color-hairline)_1px,transparent_1px)]"
        style={{ backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
            {graph.edges.map((edge) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              if (!from || !to) return null;
              const kind = workflowPorts(from).outputs.find((port) => port.id === edge.fromPort)?.kind ?? "any";
              const path = edgePath(portPoint(from, "out", edge.fromPort), portPoint(to, "in", edge.toPort));
              const active = states.get(edge.to)?.status === "running";
              return (
                <g key={edge.id}>
                  <path d={path} fill="none" stroke="transparent" strokeWidth={14} className="pointer-events-auto cursor-pointer" onPointerDown={(event) => { event.stopPropagation(); setSelected({ edge: edge.id }); surface.current?.focus(); }} />
                  <path d={path} fill="none" stroke={portColor(kind)} strokeWidth={selected.edge === edge.id ? 3 : 2} strokeOpacity={selected.edge === edge.id ? 1 : 0.75}
                    strokeDasharray={active ? "6 6" : undefined}>
                    {active && !reduceMotion && <animate attributeName="stroke-dashoffset" from="12" to="0" dur="0.8s" repeatCount="indefinite" />}
                  </path>
                </g>
              );
            })}
            {linking && (() => {
              const node = nodeById.get(linking.node);
              if (!node) return null;
              return <path d={edgePath(portPoint(node, "out", linking.port.id), linking.at)} fill="none" stroke={portColor(linking.port.kind)} strokeWidth={2} strokeDasharray="5 5" />;
            })()}
          </svg>
          {graph.nodes.map((node) => (
            <WorkflowNodeCard key={node.id} node={node} selected={selected.node === node.id} state={states.get(node.id)} problem={problemOf.get(node.id)} canEdit={canEdit}
              assetLabel={node.type === "asset" ? assets.get(String(node.params.assetId ?? "")) : undefined} linked={linkedPorts(node.id)}
              onSelect={(id) => setSelected({ node: id })} onRemove={removeNode} onDragStart={onDragStart} onPortDown={onPortDown}
              onParams={(id, params) => setGraph({ ...graph, nodes: graph.nodes.map((candidate) => (candidate.id === id ? { ...candidate, params } : candidate)) })}
              onPickAsset={(id, kind) => setPicking({ node: id, kind })} />
          ))}
        </div>
        {!graph.nodes.length && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-ink-tertiary">Add a node to start (N)</p>}
        <div className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-lg border border-hairline/40 bg-panel p-0.5" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" className={cn(iconButton, "size-7")} aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Minus size={13} /></button>
          <span className="w-10 text-center text-[11px] tabular-nums text-ink-tertiary">{Math.round(view.zoom * 100)}%</span>
          <button type="button" className={cn(iconButton, "size-7")} aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus size={13} /></button>
        </div>
      </div>
      {picking && (
        <StudioMediaPicker projectId={projectId} kind={picking.kind} rows={rows} assetsOnly onClose={() => setPicking(null)}
          onPick={(ref) => {
            if (!("assetId" in ref.source)) return;
            const assetId = ref.source.assetId;
            setGraph({ ...graph, nodes: graph.nodes.map((node) => (node.id === picking.node ? { ...node, params: { ...node.params, assetId, label: node.params.label || ref.label } } : node)) });
          }} />
      )}
    </div>
  );
}
