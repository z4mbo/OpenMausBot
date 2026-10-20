import { STUDIO_MODELS, type StudioParams } from "../../../shared/studio";
import { WORKFLOW_NODES_MAX, type StudioNodeType, type StudioWorkflowEdge, type StudioWorkflowGraph, type StudioWorkflowNode } from "../../../shared/studio-workflow";
import { newNodeId } from "./workflow-geometry";

/** Nodes copied from a workflow with the links between them; links to nodes left behind are dropped. */
export interface WorkflowClip {
  nodes: StudioWorkflowNode[];
  edges: StudioWorkflowEdge[];
}

export function copyNodes(graph: StudioWorkflowGraph, ids: ReadonlySet<string>): WorkflowClip | null {
  const nodes = graph.nodes.filter((node) => ids.has(node.id));
  if (!nodes.length) return null;
  return { nodes: structuredClone(nodes), edges: structuredClone(graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))) };
}

/** The graph with a clip added under fresh ids, shifted by `offset`; null when it would pass the node limit. */
export function pasteNodes(graph: StudioWorkflowGraph, clip: WorkflowClip, offset: { x: number; y: number }): { graph: StudioWorkflowGraph; ids: string[] } | null {
  if (graph.nodes.length + clip.nodes.length > WORKFLOW_NODES_MAX) return null;
  const renamed = new Map(clip.nodes.map((node) => [node.id, newNodeId()]));
  const nodes = clip.nodes.map((node) => ({ ...structuredClone(node), id: renamed.get(node.id)!, x: Math.round(node.x + offset.x), y: Math.round(node.y + offset.y) }));
  const edges = clip.edges.map((edge) => {
    const from = renamed.get(edge.from)!;
    const to = renamed.get(edge.to)!;
    return { ...edge, id: `${from}-${to}-${edge.toPort}`, from, to };
  });
  return { graph: { nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] }, ids: nodes.map((node) => node.id) };
}

/** Past and future graphs; edits that share a key within a moment, such as one drag or one burst of typing, undo together. */
export interface WorkflowHistory {
  past: StudioWorkflowGraph[];
  future: StudioWorkflowGraph[];
  last?: { key: string; at: number };
}

const HISTORY_MAX = 100;
const MERGE_MS = 800;

export const emptyHistory = (): WorkflowHistory => ({ past: [], future: [] });

export function recordEdit(history: WorkflowHistory, before: StudioWorkflowGraph, key: string | undefined, now: number): WorkflowHistory {
  const merge = key !== undefined && history.last?.key === key && now - history.last.at < MERGE_MS;
  return { past: merge ? history.past : [...history.past, before].slice(-HISTORY_MAX), future: [], ...(key ? { last: { key, at: now } } : {}) };
}

export function undoEdit(history: WorkflowHistory, current: StudioWorkflowGraph): { history: WorkflowHistory; graph: StudioWorkflowGraph } | null {
  const graph = history.past.at(-1);
  return graph ? { graph, history: { past: history.past.slice(0, -1), future: [current, ...history.future] } } : null;
}

export function redoEdit(history: WorkflowHistory, current: StudioWorkflowGraph): { history: WorkflowHistory; graph: StudioWorkflowGraph } | null {
  const graph = history.future[0];
  return graph ? { graph, history: { past: [...history.past, current], future: history.future.slice(1) } } : null;
}

/** One thing the node palette can add. */
export interface PaletteEntry {
  id: string;
  label: string;
  group: string;
  hint: string;
  type: StudioNodeType;
  params: StudioParams;
}

const GROUP_OF = { image: "Image", edit: "Edit", video: "Video", audio: "Audio" } as const;

export const PALETTE: readonly PaletteEntry[] = [
  { id: "prompt", label: "Prompt", group: "Inputs", hint: "Text that feeds a model", type: "prompt", params: { label: "Prompt", text: "" } },
  { id: "asset-image", label: "Image from Assets", group: "Inputs", hint: "A project image", type: "asset", params: { kind: "image", label: "Image", assetId: "" } },
  { id: "asset-video", label: "Video from Assets", group: "Inputs", hint: "A project clip", type: "asset", params: { kind: "video", label: "Video", assetId: "" } },
  { id: "asset-audio", label: "Audio from Assets", group: "Inputs", hint: "A project sound", type: "asset", params: { kind: "audio", label: "Audio", assetId: "" } },
  { id: "output", label: "Output to Assets", group: "Outputs", hint: "Saves what reaches it", type: "output", params: { name: "" } },
  { id: "output-broadcast", label: "Output to Broadcast", group: "Outputs", hint: "Saves it and drafts a post", type: "output", params: { name: "", broadcast: "feed" } },
  { id: "text-overlay", label: "Text overlay", group: "Edit", hint: "Adds a headline to an image", type: "model", params: { model: "fal-ai/nano-banana-pro/edit", prompt: "Add the headline \"Launch day\" in clean bold type, keeping everything else unchanged" } },
  ...STUDIO_MODELS.map((model): PaletteEntry => ({ id: model.id, label: model.label, group: GROUP_OF[model.mode], hint: model.description, type: "model", params: { model: model.id } })),
];

/** Palette entries for a query: every word must match, label matches first. */
export function searchPalette(query: string, entries: readonly PaletteEntry[] = PALETTE): PaletteEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...entries];
  const scored = entries.flatMap((entry) => {
    const label = entry.label.toLowerCase();
    const text = `${label} ${entry.group} ${entry.hint} ${entry.id}`.toLowerCase();
    if (!words.every((word) => text.includes(word))) return [];
    const score = (label.startsWith(words[0]!) ? 0 : 2) + (words.every((word) => label.includes(word)) ? 0 : 1);
    return [{ entry, score }];
  });
  return scored.sort((a, b) => a.score - b.score).map(({ entry }) => entry);
}
