import { STUDIO_MODELS, studioModel, type StudioMediaKind, type StudioModel, type StudioParams } from "./studio.ts";

export type StudioPortKind = "text" | StudioMediaKind;
export type StudioNodeType = "prompt" | "asset" | "model" | "output";

/** One box of a Studio workflow; `params` holds a model node's controls and an input node's value. */
export interface StudioWorkflowNode {
  id: string;
  type: StudioNodeType;
  x: number;
  y: number;
  params: StudioParams;
}

export interface StudioWorkflowEdge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface StudioWorkflowGraph {
  nodes: StudioWorkflowNode[];
  edges: StudioWorkflowEdge[];
}

export interface StudioPort {
  id: string;
  kind: StudioPortKind | "any";
  label: string;
  required: boolean;
}

export const WORKFLOW_NODES_MAX = 40;
export const WORKFLOW_EDGES_MAX = 80;

export function workflowNodeModel(node: StudioWorkflowNode): StudioModel | undefined {
  return node.type === "model" ? studioModel(String(node.params.model ?? "")) : undefined;
}

const NEED_LABEL: Record<StudioMediaKind, string> = { image: "Image", video: "Video", audio: "Audio" };

export function workflowPorts(node: StudioWorkflowNode): { inputs: StudioPort[]; outputs: StudioPort[] } {
  switch (node.type) {
    case "prompt": return { inputs: [], outputs: [{ id: "text", kind: "text", label: "Text", required: false }] };
    case "asset": {
      const kind = (["image", "video", "audio"] as const).find((value) => value === node.params.kind) ?? "image";
      return { inputs: [], outputs: [{ id: "media", kind, label: NEED_LABEL[kind], required: false }] };
    }
    case "output": return { inputs: [{ id: "media", kind: "any", label: "Media", required: true }], outputs: [] };
    case "model": {
      const model = workflowNodeModel(node);
      if (!model) return { inputs: [], outputs: [] };
      const inputs: StudioPort[] = model.needs.map((kind, index) => ({ id: `in${index}`, kind, label: model.needs.filter((other) => other === kind).length > 1 ? `${NEED_LABEL[kind]} ${index + 1}` : NEED_LABEL[kind], required: true }));
      if (model.prompt !== "none") inputs.unshift({ id: "prompt", kind: "text", label: "Prompt", required: false });
      for (let index = 0; index < (model.references ?? 0) && index < 2; index += 1) inputs.push({ id: `ref${index}`, kind: "image", label: `Reference ${index + 1}`, required: false });
      return { inputs, outputs: [{ id: "media", kind: model.kind, label: NEED_LABEL[model.kind], required: false }] };
    }
  }
}

export function portsConnect(from: StudioPort, to: StudioPort): boolean {
  return to.kind === "any" ? from.kind !== "text" : from.kind === to.kind;
}

export interface WorkflowProblem {
  nodeId?: string;
  message: string;
}

/** The nodes in an order where every input runs before its consumer, or null on a cycle. */
export function workflowOrder(graph: StudioWorkflowGraph): StudioWorkflowNode[] | null {
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const ready = graph.nodes.filter((node) => !incoming.get(node.id));
  const order: StudioWorkflowNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    order.push(node);
    for (const edge of graph.edges.filter((candidate) => candidate.from === node.id)) {
      const left = (incoming.get(edge.to) ?? 0) - 1;
      incoming.set(edge.to, left);
      if (left === 0) ready.push(graph.nodes.find((candidate) => candidate.id === edge.to)!);
    }
  }
  return order.length === graph.nodes.length ? order : null;
}

/** Everything that would stop a run, in reading order; empty when the workflow can run. */
export function validateWorkflow(graph: StudioWorkflowGraph): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  if (!graph.nodes.length) return [{ message: "Add a node to start." }];
  if (graph.nodes.length > WORKFLOW_NODES_MAX) problems.push({ message: `A workflow holds at most ${WORKFLOW_NODES_MAX} nodes.` });
  if (graph.edges.length > WORKFLOW_EDGES_MAX) problems.push({ message: `A workflow holds at most ${WORKFLOW_EDGES_MAX} links.` });
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  if (byId.size !== graph.nodes.length) problems.push({ message: "Two nodes share an id." });
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    const out = from && workflowPorts(from).outputs.find((port) => port.id === edge.fromPort);
    const into = to && workflowPorts(to).inputs.find((port) => port.id === edge.toPort);
    if (!out || !into) problems.push({ nodeId: edge.to, message: "A link points at a port that is gone." });
    else if (!portsConnect(out, into)) problems.push({ nodeId: edge.to, message: `${out.label} cannot feed ${into.label}.` });
  }
  if (!workflowOrder(graph)) problems.push({ message: "The links form a loop." });
  for (const node of graph.nodes) {
    const ports = workflowPorts(node);
    if (node.type === "model" && !workflowNodeModel(node)) problems.push({ nodeId: node.id, message: "Choose a model." });
    if (node.type === "asset" && !String(node.params.assetId ?? "")) problems.push({ nodeId: node.id, message: "Choose a file from Assets." });
    for (const port of ports.inputs) {
      const linked = graph.edges.filter((edge) => edge.to === node.id && edge.toPort === port.id).length;
      if (linked > 1) problems.push({ nodeId: node.id, message: `${port.label} takes one link.` });
      if (port.required && !linked) problems.push({ nodeId: node.id, message: `Connect ${port.label}.` });
    }
    const model = workflowNodeModel(node);
    if (model?.prompt === "required" && !String(node.params.prompt ?? "").trim() && !graph.edges.some((edge) => edge.to === node.id && edge.toPort === "prompt")) {
      problems.push({ nodeId: node.id, message: `${model.label} needs a prompt.` });
    }
  }
  if (!graph.nodes.some((node) => node.type === "output")) problems.push({ message: "Add an Output node so the result lands in Assets." });
  return problems;
}

/** The value a person may change before a run: prompt text or an input file. */
export interface WorkflowInput {
  nodeId: string;
  kind: "text" | StudioMediaKind;
  label: string;
  value: string;
}

export function workflowInputs(graph: StudioWorkflowGraph): WorkflowInput[] {
  return graph.nodes.flatMap((node): WorkflowInput[] => {
    if (node.type === "prompt") return [{ nodeId: node.id, kind: "text", label: String(node.params.label ?? "Prompt"), value: String(node.params.text ?? "") }];
    if (node.type === "asset") return [{ nodeId: node.id, kind: workflowPorts(node).outputs[0]!.kind as StudioMediaKind, label: String(node.params.label ?? "File"), value: String(node.params.assetId ?? "") }];
    return [];
  });
}

/** A copy of the graph with prompt texts and asset ids replaced by node id. */
export function withWorkflowInputs(graph: StudioWorkflowGraph, values: Record<string, string>): StudioWorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const value = values[node.id];
      if (value === undefined) return node;
      if (node.type === "prompt") return { ...node, params: { ...node.params, text: value.slice(0, 8_000) } };
      if (node.type === "asset") return { ...node, params: { ...node.params, assetId: value.slice(0, 64) } };
      return node;
    }),
  };
}

export interface StudioWorkflowTemplate {
  id: string;
  name: string;
  description: string;
  graph: StudioWorkflowGraph;
}

const node = (id: string, type: StudioNodeType, x: number, y: number, params: StudioParams): StudioWorkflowNode => ({ id, type, x, y, params });
const link = (from: string, to: string, toPort: string, fromPort?: string): StudioWorkflowEdge => ({
  id: `${from}-${to}-${toPort}`, from, fromPort: fromPort ?? (from.startsWith("p") ? "text" : "media"), to, toPort,
});

/** The one-click set: hero, square post, a 9:16 reel with its voice-over, each saved and the posts drafted in Broadcast. */
export const CAMPAIGN_PACK_ID = "template:campaign-pack";
export const CAMPAIGN_BRIEF_NODE = "p1";
export const CAMPAIGN_SCRIPT_NODE = "p2";

export const STUDIO_WORKFLOW_TEMPLATES: readonly StudioWorkflowTemplate[] = [
  {
    id: "template:product-reel",
    name: "Product shot to 9:16 reel",
    description: "A product photo becomes a studio shot, then a vertical clip with its own music.",
    graph: {
      nodes: [
        node("a1", "asset", 40, 40, { kind: "image", label: "Product photo", assetId: "" }),
        node("p1", "prompt", 40, 240, { label: "Shot", text: "Premium studio product shot on a seamless backdrop, soft key light, crisp reflections" }),
        node("m1", "model", 340, 60, { model: "fal-ai/nano-banana-pro/edit", aspectRatio: "9:16" }),
        node("p2", "prompt", 340, 360, { label: "Motion", text: "The product slowly rotates as light sweeps across it" }),
        node("m2", "model", 640, 120, { model: "fal-ai/kling-video/v3/pro/image-to-video", duration: "5", motion: "orbit", sound: false }),
        node("p3", "prompt", 640, 440, { label: "Music", text: "Sleek minimal electronic beat, confident, 100 bpm" }),
        node("m3", "model", 940, 440, { model: "fal-ai/elevenlabs/music", duration: "15s" }),
        node("m4", "model", 1240, 260, { model: "fal-ai/ffmpeg-api/merge-audio-video" }),
        node("o1", "output", 1540, 260, { name: "Product reel" }),
      ],
      edges: [link("a1", "m1", "in0"), link("p1", "m1", "prompt"), link("m1", "m2", "in0"), link("p2", "m2", "prompt"), link("p3", "m3", "prompt"), link("m2", "m4", "in0"), link("m3", "m4", "in1"), link("m4", "o1", "media")],
    },
  },
  {
    id: "template:talking-avatar",
    name: "Talking avatar",
    description: "A generated presenter reads your script in an ElevenLabs voice, lip-synced by Kling Avatar.",
    graph: {
      nodes: [
        node("p1", "prompt", 40, 60, { label: "Presenter", text: "Friendly founder portrait, looking at camera, soft office light, shallow depth of field" }),
        node("m1", "model", 340, 60, { model: "fal-ai/nano-banana-pro", aspectRatio: "9:16" }),
        node("p2", "prompt", 40, 380, { label: "Script", text: "Hi! In thirty seconds I'll show you how our app saves your team an hour a day." }),
        node("m2", "model", 340, 380, { model: "fal-ai/elevenlabs/tts/eleven-v3", voice: "Rachel" }),
        node("m3", "model", 660, 220, { model: "fal-ai/kling-video/ai-avatar/v2/pro" }),
        node("o1", "output", 960, 220, { name: "Talking avatar" }),
      ],
      edges: [link("p1", "m1", "prompt"), link("p2", "m2", "prompt"), link("m1", "m3", "in0"), link("m2", "m3", "in1"), link("m3", "o1", "media")],
    },
  },
  {
    id: "template:podcast-kit",
    name: "Podcast cover and voice intro",
    description: "A square cover, a spoken intro and a music bed, each saved to Assets.",
    graph: {
      nodes: [
        node("p1", "prompt", 40, 40, { label: "Cover", text: "Bold podcast cover art, big readable title, graphic shapes, high contrast" }),
        node("m1", "model", 340, 40, { model: "fal-ai/nano-banana-pro", aspectRatio: "1:1" }),
        node("o1", "output", 640, 40, { name: "Podcast cover" }),
        node("p2", "prompt", 40, 340, { label: "Intro script", text: "Welcome back to the show. Today we go behind the scenes of our launch." }),
        node("m2", "model", 340, 340, { model: "fal-ai/elevenlabs/tts/eleven-v3", voice: "George" }),
        node("o2", "output", 640, 340, { name: "Voice intro" }),
        node("p3", "prompt", 40, 600, { label: "Music bed", text: "Warm lo-fi intro jingle, upbeat, no vocals" }),
        node("m3", "model", 340, 600, { model: "fal-ai/elevenlabs/music", duration: "15s" }),
        node("o3", "output", 640, 600, { name: "Intro music" }),
      ],
      edges: [link("p1", "m1", "prompt"), link("m1", "o1", "media"), link("p2", "m2", "prompt"), link("m2", "o2", "media"), link("p3", "m3", "prompt"), link("m3", "o3", "media")],
    },
  },
  {
    id: CAMPAIGN_PACK_ID,
    name: "Campaign pack",
    description: "From one brief: a hero image, a square post, a 9:16 reel with its voice-over, drafted as Broadcast posts.",
    graph: {
      nodes: [
        node("p1", "prompt", 40, 420, { label: "Brief", text: "A sleek productivity app on a phone, bright morning desk, confident and optimistic" }),
        node("p2", "prompt", 40, 1260, { label: "Voice-over", text: "Meet the app that gives your team an hour back every day. Try it free today." }),
        node("m1", "model", 380, 0, { model: "fal-ai/nano-banana-pro", aspectRatio: "16:9", prompt: "Campaign hero image, wide composition with room for a headline" }),
        node("m2", "model", 380, 420, { model: "fal-ai/nano-banana-pro", aspectRatio: "1:1", prompt: "Square social post, one bold centred subject, clean background" }),
        node("m3", "model", 380, 840, { model: "fal-ai/nano-banana-pro", aspectRatio: "9:16", prompt: "Vertical key frame for a short reel" }),
        node("m4", "model", 720, 840, { model: "fal-ai/kling-video/v3/pro/image-to-video", duration: "5", motion: "dolly-in", sound: false, prompt: "Subtle cinematic motion, the scene comes alive" }),
        node("m5", "model", 380, 1260, { model: "fal-ai/elevenlabs/tts/eleven-v3", voice: "Rachel" }),
        node("m6", "model", 1060, 1020, { model: "fal-ai/ffmpeg-api/merge-audio-video" }),
        node("o1", "output", 720, 40, { name: "Campaign hero" }),
        node("o2", "output", 720, 460, { name: "Square post", broadcast: "feed" }),
        node("o3", "output", 1400, 1040, { name: "Reel", broadcast: "reel" }),
        node("o4", "output", 720, 1300, { name: "Voice-over" }),
      ],
      edges: [
        link("p1", "m1", "prompt"), link("p1", "m2", "prompt"), link("p1", "m3", "prompt"), link("m3", "m4", "in0"), link("p2", "m5", "prompt"),
        link("m4", "m6", "in0"), link("m5", "m6", "in1"), link("m1", "o1", "media"), link("m2", "o2", "media"), link("m6", "o3", "media"), link("m5", "o4", "media"),
      ],
    },
  },
];

/** Where an Output node's file goes in Broadcast: one draft per group, on that group's channels. */
export const STUDIO_BROADCAST_GROUPS = {
  feed: { label: "Feed post", channels: ["instagram", "x", "linkedin"] },
  reel: { label: "Reel", channels: ["tiktok", "instagram"] },
} as const;
export type StudioBroadcastGroup = keyof typeof STUDIO_BROADCAST_GROUPS;

export function broadcastGroupOf(node: StudioWorkflowNode): StudioBroadcastGroup | undefined {
  const value = String(node.params.broadcast ?? "");
  return node.type === "output" && value in STUDIO_BROADCAST_GROUPS ? value as StudioBroadcastGroup : undefined;
}

/** A copy of the graph whose image and video steps follow one library entry. */
export function withCharacter(graph: StudioWorkflowGraph, characterId: string | undefined): StudioWorkflowGraph {
  if (!characterId) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((entry) => {
      const model = workflowNodeModel(entry);
      return model && model.kind !== "audio" && !model.needs.includes("video") ? { ...entry, params: { ...entry.params, character: characterId.slice(0, 64) } } : entry;
    }),
  };
}

export function studioWorkflowTemplate(id: string): StudioWorkflowTemplate | undefined {
  return STUDIO_WORKFLOW_TEMPLATES.find((template) => template.id === id);
}

/** The models a workflow node can run, grouped as the node palette shows them. */
export const WORKFLOW_PALETTE: readonly { group: string; models: readonly string[] }[] = [
  { group: "Image", models: STUDIO_MODELS.filter((model) => model.mode === "image").map((model) => model.id) },
  { group: "Edit", models: STUDIO_MODELS.filter((model) => model.mode === "edit").map((model) => model.id) },
  { group: "Video", models: STUDIO_MODELS.filter((model) => model.mode === "video").map((model) => model.id) },
  { group: "Audio", models: STUDIO_MODELS.filter((model) => model.mode === "audio").map((model) => model.id) },
];

export type StudioRunStatus = "running" | "done" | "failed" | "cancelled";
export type StudioRunNodeStatus = "waiting" | "running" | "done" | "failed" | "skipped" | "cancelled";

/** One node's progress in a run. */
export interface StudioRunNode {
  nodeId: string;
  status: StudioRunNodeStatus;
  generationId?: string;
  assetId?: string;
  output?: { url: string; kind: StudioMediaKind };
  error?: string;
}

/** A row of studioWorkflowRuns as studioWorkflows:runs returns it. */
export interface StudioWorkflowRun {
  _id: string;
  projectId: string;
  workflowId?: string;
  name: string;
  graph: StudioWorkflowGraph;
  status: StudioRunStatus;
  nodes: StudioRunNode[];
  createdByName: string;
  agentName?: string;
  /** The text of the Broadcast drafts its Output nodes fill. */
  caption?: string;
  /** The Broadcast drafts the run filled, one per group. */
  posts?: Array<{ group: string; postId: string }>;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

/** A row of studioWorkflows. */
export interface StudioWorkflow {
  _id: string;
  projectId: string;
  name: string;
  description?: string;
  graph: StudioWorkflowGraph;
  updatedByName: string;
  createdAt: number;
  updatedAt: number;
}
