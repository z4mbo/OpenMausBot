import { ancestors, type CanvasNode } from "../shared/canvas-scene.ts";
import { ORIGIN_DESIGN_FRAMES_MAX, type CanvasKind, type OriginDesignCard } from "../shared/origin-design.ts";

type Scene = ReadonlyMap<string, CanvasNode>;

export function topFrames(scene: Scene, nodes: readonly CanvasNode[]): CanvasNode[] {
  const found = new Map<string, CanvasNode>();
  for (const node of nodes) {
    const root = ancestors(scene, node)[0] ?? scene.get(node.id) ?? node;
    if (root.type === "frame" && !root.deleted && !root.hidden) found.set(root.id, root);
  }
  return [...found.values()];
}

export function designCard(
  project: { projectId: string; teamId: string },
  canvas: { id: string; name: string; kind?: CanvasKind },
  frames: readonly CanvasNode[],
  heading: string,
  issueKey?: string,
): OriginDesignCard | undefined {
  const kind = canvas.kind ?? "design";
  if ((!frames.length && kind !== "board") || !project.teamId) return undefined;
  return {
    heading, projectId: project.projectId, teamId: project.teamId, canvasId: canvas.id, canvasName: canvas.name, kind,
    frames: (kind === "board" ? [] : frames).slice(0, ORIGIN_DESIGN_FRAMES_MAX).map((frame) => ({ id: frame.id, name: frame.name })),
    ...(issueKey ? { issueKey } : {}),
  };
}

export const framesLabel = (count: number) => `${count} frame${count === 1 ? "" : "s"}`;
