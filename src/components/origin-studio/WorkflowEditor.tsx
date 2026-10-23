import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, LayoutDashboard, Loader2, Maximize, Minus, PanelRight, Play, Plus, Redo2, Save, Send, Square, Undo2 } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { chipButton, ghostButton, iconButton, inputClass, Notice, primaryButton, useAction } from "../origin-pages/ui";
import { StudioMediaPicker } from "./StudioMediaPicker";
import { WorkflowNodeCard, portColor } from "./WorkflowNodeCard";
import { WorkflowPalette } from "./WorkflowPalette";
import { WorkflowMinimap } from "./WorkflowMinimap";
import { WorkflowRunPanel } from "./WorkflowRunPanel";
import { GENERATION_DRAG, studioPost, typing } from "./studio-ui";
import { useCanvasView } from "./use-canvas-view";
import { copyNodes, emptyHistory, pasteNodes, recordEdit, redoEdit, undoEdit, type PaletteEntry, type WorkflowClip, type WorkflowHistory } from "./workflow-edit";
import { NODE_WIDTH, edgePath, fitView, newNodeId, portPoint, toGraph, type Point } from "./workflow-geometry";
import type { StudioCharacter, StudioGeneration, StudioMediaKind } from "../../../shared/studio";
import {
  portsConnect, tidyWorkflow, validateWorkflow, withCharacter, workflowPorts,
  type StudioPort, type StudioWorkflowGraph, type StudioWorkflowNode, type StudioWorkflowRun,
} from "../../../shared/studio-workflow";
import type { CloudDesign } from "../origin-pages/cloud-types";

/** The workflow being edited: a saved one has its id, a template or new one does not until saved. */
export interface WorkflowDraft {
  workflowId?: string;
  name: string;
  graph: StudioWorkflowGraph;
  /** A run to show, such as the Campaign pack just started. */
  runId?: string;
}

type Linking = { node: string; port: StudioPort; at: Point };
type Selection = { nodes: readonly string[]; edge?: string };

const PASTE_STEP = 32;
let clipboard: WorkflowClip | null = null;

export function WorkflowEditor({ projectId, canEdit, falReady, rows, draft, onDraft, onBack, onOpenBroadcast }: {
  projectId: string; canEdit: boolean; falReady: boolean | null; rows: readonly StudioGeneration[];
  draft: WorkflowDraft; onDraft(draft: WorkflowDraft): void; onBack(): void; onOpenBroadcast?(): void;
}) {
  const { graph } = draft;
  const surface = useRef<HTMLDivElement>(null);
  const { view, setView, local, drag, pan, zoomBy, onPointerDownCapture } = useCanvasView(surface);
  const [selected, setSelected] = useState<Selection>({ nodes: [] });
  const [linking, setLinking] = useState<Linking | null>(null);
  const [palette, setPalette] = useState<{ at?: Point; screen?: Point } | null>(null);
  const [picking, setPicking] = useState<{ node: string; kind: StudioMediaKind } | null>(null);
  const [runId, setRunId] = useState<string | null>(draft.runId ?? null);
  const [shownRun, setShownRun] = useState(draft.runId);
  if (draft.runId !== shownRun) {
    setShownRun(draft.runId);
    if (draft.runId) setRunId(draft.runId);
  }
  const [dirty, setDirty] = useState(false);
  const [panel, setPanel] = useState(() => draft.graph.nodes.length > 0 && window.matchMedia?.("(min-width: 1024px)").matches !== false);
  const [character, setCharacter] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [history, setHistory] = useState<WorkflowHistory>(emptyHistory);
  const pastes = useRef(0);
  const saving = useAction();
  const running = useAction();
  const design = useCloudQuery<CloudDesign>("design:list", { projectId });
  const library = useCloudQuery<StudioCharacter[]>("studioLibrary:list", { projectId });
  const runs = useCloudQuery<StudioWorkflowRun[]>("studioWorkflows:runs", draft.workflowId ? { projectId, workflowId: draft.workflowId } : "skip");
  const ownRun = useCloudQuery<StudioWorkflowRun>("studioWorkflows:getRun", runId ? { projectId, runId } : "skip");
  const run = ownRun ?? runs?.[0];
  const problems = useMemo(() => validateWorkflow(graph), [graph]);
  useEffect(() => {
    if (!ownRun || draft.runId !== ownRun._id || draft.graph.nodes.length) return;
    latest.current = { ...draft, name: ownRun.name, graph: ownRun.graph, ...(ownRun.workflowId ? { workflowId: ownRun.workflowId } : {}) };
    onDraft(latest.current);
    window.setTimeout(fit, 0);
  }, [ownRun, draft, onDraft]);
  const problemOf = useMemo(() => new Map(problems.filter((problem) => problem.nodeId).map((problem) => [problem.nodeId!, problem.message])), [problems]);
  const states = useMemo(() => new Map((run?.nodes ?? []).map((node) => [node.nodeId, node])), [run]);
  const live = run?.status === "running";
  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const characters = useMemo(() => (library ?? []).map((entry) => ({ id: entry._id, name: entry.name })), [library]);

  const latest = useRef(draft);
  latest.current = draft;
  const historyRef = useRef(history);
  historyRef.current = history;

  /** Replaces the graph as one undoable step; edits sharing `key` within a moment merge into one. */
  const commit = useCallback((next: StudioWorkflowGraph, key?: string) => {
    const nextHistory = recordEdit(historyRef.current, latest.current.graph, key, Date.now());
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    setDirty(true);
    latest.current = { ...latest.current, graph: next };
    onDraft(latest.current);
  }, [onDraft]);

  /** Keeps the keyboard in the editor when the focused node goes away. */
  const keepFocus = () => window.setTimeout(() => {
    if (!document.activeElement || document.activeElement === document.body) surface.current?.focus();
  }, 0);

  const restore = (step: ReturnType<typeof undoEdit>) => {
    if (!step || !canEdit) return;
    historyRef.current = step.history;
    setHistory(step.history);
    setDirty(true);
    latest.current = { ...latest.current, graph: step.graph };
    onDraft(latest.current);
    setSelected((current) => ({ nodes: current.nodes.filter((id) => step.graph.nodes.some((node) => node.id === id)) }));
    keepFocus();
  };
  const undo = () => restore(undoEdit(historyRef.current, latest.current.graph));
  const redo = () => restore(redoEdit(historyRef.current, latest.current.graph));

  const measured = useCallback(() => new Map([...(surface.current?.querySelectorAll<HTMLElement>("[data-workflow-node]") ?? [])].map((element) => [element.dataset.workflowNode!, element.offsetHeight])), []);

  const fit = useCallback(() => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return;
    setView(fitView(latest.current.graph, box.width, box.height, measured()));
  }, [setView, measured]);

  /** Lays the graph out left to right by its links, as one undoable step. */
  const tidy = () => {
    const sizes = measured();
    commit(tidyWorkflow(latest.current.graph, (entry) => sizes.get(entry.id) ?? 200), `tidy:${Date.now()}`);
    window.setTimeout(fit, 0);
  };

  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    fit();
  }, [fit]);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
      setHeights(measured());
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measured]);
  useEffect(() => { setHeights(measured()); }, [graph, run, measured]);

  const isSelected = (id: string) => selected.nodes.includes(id);

  const onBackground = (event: ReactPointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-workflow-node]")) return;
    setSelected({ nodes: [] });
    pan(event);
  };

  const onDragStart = (id: string, event: ReactPointerEvent) => {
    if (!canEdit || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const moving = isSelected(id) ? selected.nodes : [id];
    if (event.shiftKey) {
      setSelected({ nodes: isSelected(id) ? selected.nodes.filter((other) => other !== id) : [...selected.nodes, id] });
      return;
    }
    if (!isSelected(id)) setSelected({ nodes: [id] });
    const origin = new Map(latest.current.graph.nodes.filter((node) => moving.includes(node.id)).map((node) => [node.id, { x: node.x, y: node.y }]));
    const start = { x: event.clientX, y: event.clientY, zoom: view.zoom };
    const key = `move:${moving.join(",")}:${Date.now()}`;
    drag((move) => {
      const dx = (move.clientX - start.x) / start.zoom;
      const dy = (move.clientY - start.y) / start.zoom;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      const current = latest.current.graph;
      commit({ ...current, nodes: current.nodes.map((node) => {
        const from = origin.get(node.id);
        return from ? { ...node, x: Math.round(from.x + dx), y: Math.round(from.y + dy) } : node;
      }) }, key);
    });
  };

  const connect = (from: { node: string; port: string }, to: { node: string; port: string }) => {
    const current = latest.current.graph;
    const source = current.nodes.find((node) => node.id === from.node);
    const target = current.nodes.find((node) => node.id === to.node);
    if (!source || !target || source.id === target.id) return;
    const out = workflowPorts(source).outputs.find((port) => port.id === from.port);
    const into = workflowPorts(target).inputs.find((port) => port.id === to.port);
    if (!out || !into || !portsConnect(out, into)) return;
    const edges = current.edges.filter((edge) => !(edge.to === to.node && edge.toPort === to.port));
    commit({ ...current, edges: [...edges, { id: `${from.node}-${to.node}-${to.port}`, from: from.node, fromPort: from.port, to: to.node, toPort: to.port }] });
  };

  const onPortDown = (id: string, side: "in" | "out", port: StudioPort, event: ReactPointerEvent) => {
    if (!canEdit || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    let origin = { node: id, port };
    if (side === "in") {
      const existing = graph.edges.find((edge) => edge.to === id && edge.toPort === port.id);
      if (!existing) return;
      const source = graph.nodes.find((node) => node.id === existing.from)!;
      origin = { node: source.id, port: workflowPorts(source).outputs.find((candidate) => candidate.id === existing.fromPort)! };
      commit({ ...graph, edges: graph.edges.filter((edge) => edge !== existing) });
    }
    setLinking({ ...origin, at: toGraph(local(event), view) });
    drag((move) => setLinking((current) => current && { ...current, at: toGraph(local(move), view) }), (up, interrupted) => {
      setLinking(null);
      if (interrupted) return;
      const target = (document.elementFromPoint(up.clientX, up.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-port-in]");
      if (target) connect({ node: origin.node, port: origin.port.id }, { node: target.dataset.portNode!, port: target.dataset.portIn! });
    });
  };

  const addNode = (entry: PaletteEntry) => {
    const box = surface.current?.getBoundingClientRect();
    const centre = palette?.at ?? toGraph({ x: (box?.width ?? 600) / 2 - NODE_WIDTH / 2, y: (box?.height ?? 400) / 2 - 80 }, view);
    const offset = palette?.at ? 0 : (graph.nodes.length % 5) * 24;
    const node: StudioWorkflowNode = { id: newNodeId(), type: entry.type, x: Math.round(centre.x + offset), y: Math.round(centre.y + offset), params: structuredClone(entry.params) };
    commit({ ...graph, nodes: [...graph.nodes, node] });
    setSelected({ nodes: [node.id] });
    setPalette(null);
    window.setTimeout(() => surface.current?.querySelector<HTMLElement>(`[data-workflow-node="${node.id}"]`)?.focus(), 0);
  };

  const removeNodes = (ids: readonly string[]) => {
    commit({ nodes: graph.nodes.filter((node) => !ids.includes(node.id)), edges: graph.edges.filter((edge) => !ids.includes(edge.from) && !ids.includes(edge.to)) });
    setSelected({ nodes: [] });
    keepFocus();
  };

  const copy = () => {
    const clip = copyNodes(graph, new Set(selected.nodes));
    if (!clip) return false;
    clipboard = clip;
    pastes.current = 0;
    return true;
  };

  const paste = () => {
    if (!clipboard || !canEdit) return;
    pastes.current += 1;
    const pasted = pasteNodes(graph, clipboard, { x: PASTE_STEP * pastes.current, y: PASTE_STEP * pastes.current });
    if (!pasted) return;
    commit(pasted.graph);
    setSelected({ nodes: pasted.ids });
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
      const { runId: id } = await studioPost<{ runId: string }>("workflow/run", { projectId, name: draft.name, graph: withCharacter(graph, character || undefined), ...(draft.workflowId ? { workflowId: draft.workflowId } : {}) });
      setRunId(id);
    }, "Could not start the run");
  };

  const stop = () => {
    if (run && live) void running.run(() => studioPost("workflow/cancel", { projectId, runId: run._id }), "Could not stop the run");
  };

  const onKey = (event: globalThis.KeyboardEvent) => {
    if (event.defaultPrevented || document.querySelector("[data-centered-dialog]")) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === "s") { event.preventDefault(); save(); return; }
    if (mod && event.key === "Enter") { event.preventDefault(); start(); return; }
    if (typing(event) || event.altKey) return;
    if (mod) {
      if (key === "z" && !event.shiftKey) undo();
      else if ((key === "z" && event.shiftKey) || key === "y") redo();
      else if (key === "c") { if (!copy()) return; }
      else if (key === "x" && canEdit) { if (!copy()) return; removeNodes(selected.nodes); }
      else if (key === "v") paste();
      else if (key === "d" && canEdit) { if (!copy()) return; paste(); }
      else if (key === "a") setSelected({ nodes: graph.nodes.map((node) => node.id) });
      else return;
      event.preventDefault();
      return;
    }
    if (key === "f") { event.preventDefault(); fit(); return; }
    if (key === "l" && canEdit) { event.preventDefault(); tidy(); return; }
    if (key === "i") { event.preventDefault(); setPanel((open) => !open); return; }
    if ((key === "n" || key === "/") && canEdit) { event.preventDefault(); setPalette({}); return; }
    if (event.key === "Escape") { setSelected({ nodes: [] }); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && canEdit) {
      if (selected.edge) commit({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selected.edge) });
      else if (selected.nodes.length) removeNodes(selected.nodes);
      else return;
      event.preventDefault();
      setSelected({ nodes: [] });
      return;
    }
    if (selected.nodes.length && canEdit && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const step = event.shiftKey ? 48 : 12;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      commit({ ...graph, nodes: graph.nodes.map((node) => (isSelected(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node)) }, `nudge:${selected.nodes.join(",")}`);
    }
  };

  const keys = useRef(onKey);
  keys.current = onKey;
  useEffect(() => {
    const listen = (event: globalThis.KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, []);

  const focusNode = (id: string) => {
    const node = latest.current.graph.nodes.find((entry) => entry.id === id);
    const box = surface.current?.getBoundingClientRect();
    if (!node || !box) return;
    setView({ ...view, x: box.width / 2 - (node.x + NODE_WIDTH / 2) * view.zoom, y: box.height / 2 - (node.y + 80) * view.zoom });
    setSelected({ nodes: [id] });
    window.setTimeout(() => surface.current?.querySelector<HTMLElement>(`[data-workflow-node="${id}"]`)?.focus({ preventScroll: true }), 0);
  };

  /** A result dragged from Create becomes an input file node where it lands. */
  const onDrop = (event: DragEvent) => {
    if (!canEdit || !event.dataTransfer.types.includes(GENERATION_DRAG)) return;
    event.preventDefault();
    const row = rows.find((candidate) => candidate._id === event.dataTransfer.getData(GENERATION_DRAG));
    const saved = row?.saved.find((entry) => entry.index === 0);
    const kind = row?.outputs[0]?.kind;
    if (!row || !saved || !kind) return;
    const at = toGraph(local(event), view);
    const node: StudioWorkflowNode = { id: newNodeId(), type: "asset", x: Math.round(at.x - NODE_WIDTH / 2), y: Math.round(at.y - 20), params: { kind, label: (row.prompt || row.modelLabel).slice(0, 40), assetId: saved.assetId } };
    commit({ ...latest.current.graph, nodes: [...latest.current.graph.nodes, node] });
    setSelected({ nodes: [node.id] });
  };

  const onDoubleClick = (event: ReactMouseEvent) => {
    if (!canEdit || (event.target as HTMLElement).closest("[data-workflow-node]")) return;
    const screen = local(event);
    setPalette({ at: toGraph(screen, view), screen });
  };

  const assets = new Map((design?.assets ?? []).map((asset) => [asset._id, { name: asset.name, url: asset.fileUrl || asset.url || "" }]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const linkedPorts = (id: string) => new Set(graph.edges.filter((edge) => edge.to === id).map((edge) => `in:${edge.toPort}`));
  const outputs = (run?.nodes ?? []).filter((node) => nodeById.get(node.nodeId)?.type === "output" && node.output);
  const done = run?.nodes.filter((node) => node.status === "done").length ?? 0;
  const surfaceBox = surface.current?.getBoundingClientRect();
  const paletteStyle = palette?.screen && surfaceBox
    ? { left: Math.min(palette.screen.x, Math.max(surfaceBox.width - 336, 8)), top: Math.min(palette.screen.y, Math.max(surfaceBox.height - 420, 8)) }
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pb-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={iconButton} onClick={onBack} aria-label="All workflows" title="All workflows"><ArrowLeft size={16} /></button>
        <input className={cn(inputClass, "h-8 w-56 max-w-[52vw] border-transparent bg-transparent font-medium hover:border-hairline/60 focus:bg-inset")} value={draft.name} aria-label="Workflow name" maxLength={120} disabled={!canEdit}
          onChange={(event) => { setDirty(true); onDraft({ ...draft, name: event.target.value }); }} />
        <span className="mx-1 h-5 w-px bg-hairline/50 max-sm:hidden" aria-hidden="true" />
        <button type="button" className={chipButton} onClick={() => setPalette(palette ? null : {})} disabled={!canEdit} aria-expanded={Boolean(palette)} title="Add a node (N)"><Plus size={13} />Node</button>
        <button type="button" className={iconButton} onClick={undo} disabled={!canEdit || !history.past.length} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
        <button type="button" className={iconButton} onClick={redo} disabled={!canEdit || !history.future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
        <button type="button" className={iconButton} onClick={fit} aria-label="Fit to view (F)" title="Fit to view (F)"><Maximize size={15} /></button>
        <button type="button" className={iconButton} onClick={() => tidy()} disabled={!canEdit || graph.nodes.length < 2} aria-label="Tidy up the layout (L)" title="Tidy up the layout (L)" data-workflow-tidy><LayoutDashboard size={15} /></button>
        <span className="flex-1" />
        {problems.length > 0 && !live && <span className="max-w-[260px] truncate text-[12px] text-ink-tertiary max-sm:hidden" title={problems.map((problem) => problem.message).join("\n")}>{problems[0]!.message}{problems.length > 1 ? ` +${problems.length - 1}` : ""}</span>}
        <button type="button" className={ghostButton} onClick={save} disabled={!canEdit || saving.busy || (!dirty && Boolean(draft.workflowId))} title="Save (Ctrl+S)">
          {saving.busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{draft.workflowId && !dirty ? "Saved" : "Save"}
        </button>
        <button type="button" className={cn(iconButton, panel && "bg-raised text-ink")} onClick={() => setPanel(!panel)} aria-pressed={panel} aria-label="Inputs and runs (I)" title="Inputs and runs (I)" data-workflow-panel-toggle><PanelRight size={15} /></button>
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-secondary" role="status" data-workflow-run={run.status}>
          <span className="relative h-1 w-24 overflow-hidden rounded-full bg-hairline/40" aria-hidden="true">
            <span className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-(--motion-slow)", run.status === "failed" ? "bg-danger" : "bg-accent")} style={{ width: `${Math.round((done / Math.max(run.nodes.length, 1)) * 100)}%` }} />
          </span>
          <span className={cn("font-medium tabular-nums", run.status === "failed" ? "text-danger" : run.status === "done" ? "text-ink" : "text-ink")}>
            {run.status === "running" ? `Running · ${done} of ${run.nodes.length}` : run.status === "done" ? "Finished" : run.status === "failed" ? "Failed" : "Stopped"}
          </span>
          <span className="text-ink-tertiary">by {run.agentName ?? run.createdByName}</span>
          {outputs.length > 0 && <span className="text-ink-tertiary">· {outputs.length} in Assets</span>}
          {(run.posts?.length ?? 0) > 0 && (
            <button type="button" className="inline-flex items-center gap-1 rounded-md px-1 text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={onOpenBroadcast} data-workflow-posts>
              <Send size={12} aria-hidden="true" />{run.posts!.length} {run.posts!.length === 1 ? "draft" : "drafts"} in Publish
            </button>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-2 max-lg:flex-col">
      <div ref={surface} tabIndex={-1} onPointerDownCapture={onPointerDownCapture} onPointerDown={onBackground} onDoubleClick={onDoubleClick} data-workflow-canvas
        onDragOver={(event) => { if (canEdit && event.dataTransfer.types.includes(GENERATION_DRAG)) event.preventDefault(); }} onDrop={onDrop}
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
              const chosen = selected.edge === edge.id || (isSelected(edge.from) && isSelected(edge.to));
              return (
                <g key={edge.id}>
                  <path d={path} fill="none" stroke="transparent" strokeWidth={14} className="pointer-events-auto cursor-pointer" onPointerDown={(event) => { event.stopPropagation(); setSelected({ nodes: [], edge: edge.id }); surface.current?.focus(); }} />
                  <path d={path} fill="none" stroke={portColor(kind)} strokeWidth={chosen ? 2.5 : 1.75} strokeOpacity={chosen ? 1 : 0.7} strokeDasharray={active ? "6 6" : undefined}>
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
            <WorkflowNodeCard key={node.id} node={node} selected={isSelected(node.id)} state={states.get(node.id)} problem={problemOf.get(node.id)} canEdit={canEdit}
              assetLabel={node.type === "asset" ? assets.get(String(node.params.assetId ?? "")) : undefined} linked={linkedPorts(node.id)} characters={characters}
              onSelect={(id, additive) => setSelected((current) => (additive || current.nodes.includes(id) ? current : { nodes: [id] }))}
              onRemove={(id) => removeNodes([id])} onDragStart={onDragStart} onPortDown={onPortDown}
              onParams={(id, params, field) => commit({ ...latest.current.graph, nodes: latest.current.graph.nodes.map((candidate) => (candidate.id === id ? { ...candidate, params } : candidate)) }, `params:${id}:${field}`)}
              onPickAsset={(id, kind) => setPicking({ node: id, kind })} />
          ))}
        </div>
        {!graph.nodes.length && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-ink-tertiary">Double-click or press N to add a node</p>
        )}
        {palette && <WorkflowPalette onPick={addNode} onClose={() => setPalette(null)} className={paletteStyle ? undefined : "left-2 top-2"} style={paletteStyle} />}
        {selected.nodes.length > 1 && (
          <p className="absolute left-2 top-2 rounded-md bg-panel/90 px-2 py-1 text-[11.5px] tabular-nums text-ink-secondary" role="status">{selected.nodes.length} selected</p>
        )}
        <div className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-lg border border-hairline/40 bg-panel p-0.5" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" className={cn(iconButton, "size-7")} aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Minus size={13} /></button>
          <span className="w-10 text-center text-[11px] tabular-nums text-ink-tertiary" data-workflow-zoom>{Math.round(view.zoom * 100)}%</span>
          <button type="button" className={cn(iconButton, "size-7")} aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus size={13} /></button>
        </div>
        <WorkflowMinimap graph={graph} view={view} size={size} heights={heights} states={states} onView={setView} />
      </div>
      {panel && (
        <WorkflowRunPanel graph={graph} canEdit={canEdit} assets={assets} characters={characters} character={character} run={run} runs={runs ?? (run ? [run] : [])}
          problems={problems} live={live} busy={running.busy} ready={canEdit && !running.busy && !problems.length && falReady === true}
          onParams={(id, params, field) => commit({ ...latest.current.graph, nodes: latest.current.graph.nodes.map((candidate) => (candidate.id === id ? { ...candidate, params } : candidate)) }, `params:${id}:${field}`)}
          onPickAsset={(id, kind) => setPicking({ node: id, kind })} onCharacter={setCharacter} onRun={start} onStop={stop} onShowRun={setRunId} onFocusNode={focusNode}
          onClose={() => setPanel(false)} />
      )}
      </div>
      {picking && (
        <StudioMediaPicker projectId={projectId} kind={picking.kind} rows={rows} assetsOnly onClose={() => setPicking(null)}
          onPick={(ref) => {
            if (!("assetId" in ref.source)) return;
            const assetId = ref.source.assetId;
            commit({ ...graph, nodes: graph.nodes.map((node) => (node.id === picking.node ? { ...node, params: { ...node.params, assetId, label: node.params.label || ref.label } } : node)) });
          }} />
      )}
    </div>
  );
}
