import { STUDIO_MODELS, studioModel, type StudioGeneration, type StudioMediaKind, type StudioModel, type StudioParams } from "./studio.ts";
import { templateBlanks, type TemplateBlank } from "./studio-blanks.ts";
import { templateFromGeneration } from "./studio-templates.ts";

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
      const inputs: StudioPort[] = model.needs.map((kind, index) => ({ id: `in${index}`, kind, label: model.inputLabels?.[index] ?? model.needs.filter((other) => other === kind).length > 1 ? `${NEED_LABEL[kind]} ${index + 1}` : NEED_LABEL[kind], required: true }));
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
  /** The STUDIO_PRESETS id whose preview image the template's card shows. */
  preview?: string;
}

const node = (id: string, type: StudioNodeType, x: number, y: number, params: StudioParams): StudioWorkflowNode => ({ id, type, x, y, params });
const link = (from: string, to: string, toPort: string, fromPort?: string): StudioWorkflowEdge => ({
  id: `${from}-${to}-${toPort}`, from, fromPort: fromPort ?? (from.startsWith("p") ? "text" : "media"), to, toPort,
});

/** The one-click set: hero, square post, a 9:16 reel with its voice-over, each saved and the posts drafted in Publish. */
export const CAMPAIGN_PACK_ID = "template:campaign-pack";
export const CAMPAIGN_BRIEF_NODE = "p1";
export const CAMPAIGN_SCRIPT_NODE = "p2";

export const STUDIO_WORKFLOW_TEMPLATES: readonly StudioWorkflowTemplate[] = [
  {
    id: "template:motion-transfer",
    name: "Motion transfer",
    description: "A generated character performs every move of your reference video, as in ComfyUI's Kling Motion Control template.",
    preview: "motion-transfer",
    graph: {
      nodes: [
        node("p1", "prompt", 40, 40, { label: "Character", text: "Full-body portrait of a stylish dancer in streetwear, plain studio backdrop, even light" }),
        node("m1", "model", 340, 40, { model: "fal-ai/nano-banana-pro", aspectRatio: "9:16" }),
        node("a1", "asset", 40, 340, { kind: "video", label: "Motion video", assetId: "" }),
        node("m2", "model", 660, 180, { model: "fal-ai/kling-video/v3/pro/motion-control" }),
        node("o1", "output", 960, 180, { name: "Motion transfer" }),
      ],
      edges: [link("p1", "m1", "prompt"), link("m1", "m2", "in0"), link("a1", "m2", "in1"), link("m2", "o1", "media")],
    },
  },
  {
    id: "template:character-swap",
    name: "Character swap",
    description: "Your character takes the lead role in an existing video, as in ComfyUI's Wan Animate character replacement.",
    preview: "character-swap",
    graph: {
      nodes: [
        node("a1", "asset", 40, 40, { kind: "image", label: "Character", assetId: "" }),
        node("a2", "asset", 40, 300, { kind: "video", label: "Video", assetId: "" }),
        node("m1", "model", 340, 140, { model: "fal-ai/wan/v2.2-14b/animate/replace", resolution: "720p" }),
        node("o1", "output", 640, 140, { name: "Character swap" }),
      ],
      edges: [link("a1", "m1", "in0"), link("a2", "m1", "in1"), link("m1", "o1", "media")],
    },
  },
  {
    id: "template:try-on-reel",
    name: "Try-on to runway clip",
    description: "A person wears your garment, then turns for the camera in a vertical clip.",
    preview: "virtual-try-on",
    graph: {
      nodes: [
        node("a1", "asset", 40, 40, { kind: "image", label: "Person", assetId: "" }),
        node("a2", "asset", 40, 300, { kind: "image", label: "Garment", assetId: "" }),
        node("m1", "model", 340, 140, { model: "fal-ai/fashn/tryon/v1.6" }),
        node("o1", "output", 640, 0, { name: "Try-on photo" }),
        node("p1", "prompt", 340, 440, { label: "Motion", text: "The model turns slowly to show the outfit, confident runway pose, soft studio light" }),
        node("m2", "model", 660, 240, { model: "fal-ai/kling-video/v3/pro/image-to-video", duration: "5", motion: "orbit", sound: false }),
        node("o2", "output", 960, 240, { name: "Try-on clip" }),
      ],
      edges: [link("a1", "m1", "in0"), link("a2", "m1", "in1"), link("m1", "o1", "media"), link("m1", "m2", "in0"), link("p1", "m2", "prompt"), link("m2", "o2", "media")],
    },
  },
  {
    id: "template:product-angles",
    name: "Product from every angle",
    description: "One product photo becomes a set of new camera angles, as in ComfyUI's multiple-angles template.",
    preview: "camera-angle",
    graph: {
      nodes: [
        node("a1", "asset", 40, 200, { kind: "image", label: "Product photo", assetId: "" }),
        node("m1", "model", 340, 0, { model: "fal-ai/qwen-image-edit-2511-multiple-angles", angle: "three-quarter-left" }),
        node("m2", "model", 340, 260, { model: "fal-ai/qwen-image-edit-2511-multiple-angles", angle: "back" }),
        node("m3", "model", 340, 520, { model: "fal-ai/qwen-image-edit-2511-multiple-angles", angle: "top" }),
        node("o1", "output", 660, 0, { name: "Three-quarter view" }),
        node("o2", "output", 660, 260, { name: "Back view" }),
        node("o3", "output", 660, 520, { name: "Top view" }),
      ],
      edges: [link("a1", "m1", "in0"), link("a1", "m2", "in0"), link("a1", "m3", "in0"), link("m1", "o1", "media"), link("m2", "o2", "media"), link("m3", "o3", "media")],
    },
  },
  {
    id: "template:product-reel",
    name: "Product shot to 9:16 reel",
    description: "A product photo becomes a studio shot, then a vertical clip with its own music.",
    preview: "product-turntable",
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
    preview: "talking-photo",
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
    preview: "voice-over",
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
    description: "From one brief: a hero image, a square post, a 9:16 reel with its voice-over, drafted as Publish posts.",
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

/** Where an Output node's file goes in Publish: one draft per group, on that group's channels. */
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
  /** The text of the Publish drafts its Output nodes fill. */
  caption?: string;
  /** The Publish drafts the run filled, one per group. */
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

/** The `[placeholders]` of each Prompt node, which a run form offers as fields of their own. */
export function workflowBlanks(graph: StudioWorkflowGraph): Array<{ nodeId: string; blanks: TemplateBlank[] }> {
  return graph.nodes.flatMap((entry) => {
    if (entry.type !== "prompt") return [];
    const blanks = templateBlanks(String(entry.params.text ?? ""));
    return blanks.length ? [{ nodeId: entry.id, blanks }] : [];
  });
}

const LINEAGE_MAX = 6;

/**
 * A workflow that makes a generation again: one model step per generation in its line (an animate of a remix of an
 * image becomes three), each prompt as a Prompt node, starting files as input nodes and the last step saved by an Output.
 */
export function workflowFromGeneration(rows: readonly StudioGeneration[], generationId: string): StudioWorkflowGraph | null {
  const byId = new Map(rows.map((row) => [row._id, row]));
  const line: StudioGeneration[] = [];
  for (let row = byId.get(generationId); row && line.length < LINEAGE_MAX; row = row.parentId ? byId.get(row.parentId) : undefined) line.unshift(row);
  if (!line.length || line.some((row) => !studioModel(row.model))) return null;
  const nodes: StudioWorkflowNode[] = [];
  const edges: StudioWorkflowEdge[] = [];
  const edge = (from: string, fromPort: string, to: string, toPort: string) => edges.push({ id: `${from}-${to}-${toPort}`, from, fromPort, to, toPort });
  line.forEach((row, step) => {
    const model = studioModel(row.model)!;
    const settings = templateFromGeneration(row);
    const id = `m${step + 1}`;
    nodes.push(node(id, "model", 380 + step * 340, 40, { model: model.id, ...settings.params }));
    if (model.prompt !== "none" && row.prompt.trim()) {
      nodes.push(node(`p${step + 1}`, "prompt", 40 + step * 340, 320, { label: step ? `Step ${step + 1} prompt` : "Prompt", text: row.prompt }));
      edge(`p${step + 1}`, "text", id, "prompt");
    }
    model.needs.forEach((kind, index) => {
      const previous = step > 0 ? studioModel(line[step - 1]!.model) : undefined;
      if (index === 0 && previous?.kind === kind) return edge(`m${step}`, "media", id, "in0");
      const input = `a${step + 1}${index + 1}`;
      const assetId = index === 0 && step === 0 && row.sourceAssetId ? row.sourceAssetId : "";
      nodes.push(node(input, "asset", 40 + step * 340, 40 + index * 180, { kind, label: model.inputLabels?.[index] ?? `${kind[0]!.toUpperCase()}${kind.slice(1)}`, assetId }));
      edge(input, "media", id, `in${index}`);
    });
  });
  const last = line[line.length - 1]!;
  nodes.push(node("o1", "output", 380 + line.length * 340, 40, { name: (last.prompt.trim() || last.modelLabel).slice(0, 60) }));
  edge(`m${line.length}`, "media", "o1", "media");
  return tidyWorkflow({ nodes, edges });
}

/** A node's height on the canvas, close enough to lay out a graph before it is drawn. */
export function estimatedNodeHeight(entry: StudioWorkflowNode): number {
  const { inputs, outputs } = workflowPorts(entry);
  const ports = Math.max(inputs.length, outputs.length) * 26 + 36;
  if (entry.type === "prompt") return ports + 130;
  if (entry.type === "asset") return ports + 96;
  if (entry.type === "output") return ports + 90;
  const model = workflowNodeModel(entry);
  const settings = model && (model.aspectRatios || model.durations || model.resolutions || model.voices || model.motion || model.angles) ? 40 : 0;
  return ports + 52 + (model?.prompt === "none" ? 0 : 64) + settings + (model && model.kind !== "audio" ? 34 : 0);
}

export const TIDY_COLUMN = 340;
export const TIDY_GAP = 28;

/**
 * The graph laid out left to right: each node one column after its furthest input, columns ordered to keep links
 * short, nodes stacked without overlapping. A loop leaves the graph as it was.
 */
export function tidyWorkflow(graph: StudioWorkflowGraph, heightOf: (entry: StudioWorkflowNode) => number = estimatedNodeHeight): StudioWorkflowGraph {
  const order = workflowOrder(graph);
  if (!order) return graph;
  const column = new Map<string, number>();
  for (const entry of order) {
    const parents = graph.edges.filter((link) => link.to === entry.id).map((link) => column.get(link.from) ?? 0);
    column.set(entry.id, parents.length ? Math.max(...parents) + 1 : 0);
  }
  for (const entry of [...order].reverse()) {
    if (graph.edges.some((link) => link.to === entry.id)) continue;
    const children = graph.edges.filter((link) => link.from === entry.id).map((link) => column.get(link.to) ?? 1);
    if (children.length) column.set(entry.id, Math.min(...children) - 1);
  }
  const columns = [...new Set(column.values())].sort((a, b) => a - b);
  const heights = new Map(graph.nodes.map((entry) => [entry.id, heightOf(entry)]));
  let placed = new Map<string, { x: number; y: number }>();
  for (let sweep = 0; sweep < 2; sweep += 1) {
    const previous = placed;
    placed = new Map();
    const centre = (id: string) => { const at = placed.get(id) ?? previous.get(id); return at ? at.y + heights.get(id)! / 2 : undefined; };
    columns.forEach((value, index) => {
      const members = order.filter((entry) => column.get(entry.id) === value);
      const wanted = (entry: StudioWorkflowNode) => {
        const linked = graph.edges.filter((link) => link.to === entry.id || link.from === entry.id).map((link) => centre(link.to === entry.id ? link.from : link.to)).filter((y): y is number => y !== undefined);
        return linked.length ? linked.reduce((sum, y) => sum + y, 0) / linked.length - heights.get(entry.id)! / 2 : Number.POSITIVE_INFINITY;
      };
      const sorted = members.map((entry, at) => ({ entry, at, y: wanted(entry) })).sort((a, b) => (a.y - b.y) || (a.at - b.at));
      let next = 40;
      for (const { entry, y } of sorted) {
        const top = Math.max(next, Number.isFinite(y) ? Math.round(y) : next);
        placed.set(entry.id, { x: 40 + index * TIDY_COLUMN, y: top });
        next = top + heights.get(entry.id)! + TIDY_GAP;
      }
    });
  }
  return { ...graph, nodes: graph.nodes.map((entry) => ({ ...entry, ...placed.get(entry.id) })) };
}

/** Whether any two nodes' boxes overlap. */
export function workflowOverlaps(graph: StudioWorkflowGraph, width: number, heightOf: (entry: StudioWorkflowNode) => number = estimatedNodeHeight): boolean {
  return graph.nodes.some((a, index) => graph.nodes.slice(index + 1).some((b) =>
    a.x < b.x + width && b.x < a.x + width && a.y < b.y + heightOf(b) && b.y < a.y + heightOf(a)));
}
