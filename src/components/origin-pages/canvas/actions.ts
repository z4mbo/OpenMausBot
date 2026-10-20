import { newNode } from "../../../../shared/canvas-ops";
import {
  descendants, effectiveParent, isLive, nextZ, randomId, sanitizeNode, worldOrigin, type CanvasNode, type CanvasNodeType, type Scene,
} from "../../../../shared/canvas-scene";
import { containsPoint, unionBox, worldBounds, worldBox, type Box, type Point } from "./geometry";

type Index = ReadonlyMap<string | null, readonly CanvasNode[]>;

export function topmost(scene: Scene, ids: readonly string[]): CanvasNode[] {
  const chosen = new Set(ids);
  return ids.flatMap((id) => {
    const node = scene.get(id);
    if (!isLive(node)) return [];
    let parent = effectiveParent(scene, node);
    while (parent) {
      if (chosen.has(parent)) return [];
      parent = effectiveParent(scene, scene.get(parent)!);
    }
    return [node];
  });
}

export function deleteNodes(scene: Scene, index: Index, ids: readonly string[]): CanvasNode[] {
  const out = new Map<string, CanvasNode>();
  for (const node of topmost(scene, ids)) {
    if (node.locked) continue;
    for (const gone of [node, ...descendants(scene, node.id, index as Map<string | null, CanvasNode[]>)]) out.set(gone.id, { ...gone, deleted: true });
  }
  return [...out.values()];
}

export function duplicateNodes(scene: Scene, index: Index, ids: readonly string[], offset = 0): { nodes: CanvasNode[]; roots: string[] } {
  const nodes: CanvasNode[] = [];
  const roots: string[] = [];
  const copy = (node: CanvasNode, parentId: string | null, root: boolean, z: number) => {
    const id = randomId();
    const { locked: _locked, ...rest } = node;
    nodes.push({ ...rest, id, parentId, z, version: 1, x: node.x + (root ? offset : 0), y: node.y + (root ? offset : 0), name: node.name });
    for (const child of index.get(node.id) ?? []) copy(child, id, false, child.z);
    return id;
  };
  for (const node of topmost(scene, ids)) {
    const parent = effectiveParent(scene, node);
    roots.push(copy(node, parent, true, nextZ([...(index.get(parent) ?? []), ...nodes.filter((item) => item.parentId === parent)])));
  }
  return { nodes, roots };
}

export function siblingsBox(scene: Scene, nodes: readonly CanvasNode[]): Box | null {
  return unionBox(nodes.map((node) => worldBounds(scene, node)));
}

export function wrapNodes(scene: Scene, ids: readonly string[], type: Extract<CanvasNodeType, "group" | "frame">): { nodes: CanvasNode[]; id: string } | null {
  const chosen = topmost(scene, ids).filter((node) => !node.locked);
  if (!chosen.length) return null;
  const parent = effectiveParent(scene, chosen[0]);
  if (chosen.some((node) => effectiveParent(scene, node) !== parent)) return null;
  const left = Math.min(...chosen.map((node) => node.x));
  const top = Math.min(...chosen.map((node) => node.y));
  const right = Math.max(...chosen.map((node) => node.x + node.width));
  const bottom = Math.max(...chosen.map((node) => node.y + node.height));
  const wrapper = newNode(type, parent, Math.max(...chosen.map((node) => node.z)), {
    x: left, y: top, width: right - left, height: bottom - top, ...(type === "frame" ? { fill: "#FFFFFF" } : {}),
  });
  return { id: wrapper.id, nodes: [wrapper, ...chosen.map((node) => ({ ...node, parentId: wrapper.id, x: node.x - left, y: node.y - top }))] };
}

/** Shift+A: a frame gains or loses auto layout; other layers are wrapped in a hugging auto-layout frame. */
export function toggleAutoLayout(scene: Scene, ids: readonly string[]): { nodes: CanvasNode[]; id: string } | null {
  const only = ids.length === 1 ? scene.get(ids[0]!) : undefined;
  if (only?.type === "frame") {
    if (!only.layout) return { nodes: [{ ...only, layout: { direction: "column", gap: 16, padding: [16, 16, 16, 16], align: "start", justify: "start" } }], id: only.id };
    const { layout: _layout, ...rest } = only;
    return { nodes: [rest], id: only.id };
  }
  const wrapped = wrapNodes(scene, ids, "frame");
  if (!wrapped) return null;
  const frame = wrapped.nodes[0]!;
  const direction = frame.height >= frame.width ? "column" : "row";
  return { id: wrapped.id, nodes: [{ ...frame, fill: null, layout: { direction, gap: 16, padding: [0, 0, 0, 0], align: "start", justify: "start", hug: "both" } }, ...wrapped.nodes.slice(1)] };
}

export function unwrap(scene: Scene, index: Index, id: string): CanvasNode[] {
  const wrapper = scene.get(id);
  if (!isLive(wrapper) || (wrapper.type !== "group" && wrapper.type !== "frame")) return [];
  const children = index.get(id) ?? [];
  const parent = effectiveParent(scene, wrapper);
  const siblings = index.get(parent) ?? [];
  const next = siblings[siblings.findIndex((item) => item.id === id) + 1]?.z ?? wrapper.z + 1;
  return [
    { ...wrapper, deleted: true },
    ...children.map((child, order) => ({ ...child, parentId: parent, x: child.x + wrapper.x, y: child.y + wrapper.y, z: wrapper.z + ((next - wrapper.z) * order) / children.length })),
  ];
}

export type Reorder = "forward" | "backward" | "front" | "back";

export function reorder(scene: Scene, index: Index, ids: readonly string[], how: Reorder): CanvasNode[] {
  const out: CanvasNode[] = [];
  for (const node of topmost(scene, ids)) {
    const siblings = index.get(effectiveParent(scene, node)) ?? [];
    const at = siblings.findIndex((item) => item.id === node.id);
    let z = node.z;
    if (how === "front") z = siblings[siblings.length - 1].z + 1;
    else if (how === "back") z = siblings[0].z - 1;
    else if (how === "forward" && at < siblings.length - 1) z = at + 2 < siblings.length ? (siblings[at + 1].z + siblings[at + 2].z) / 2 : siblings[at + 1].z + 1;
    else if (how === "backward" && at > 0) z = at - 2 >= 0 ? (siblings[at - 1].z + siblings[at - 2].z) / 2 : siblings[at - 1].z - 1;
    if (z !== node.z) out.push({ ...node, z });
  }
  return out;
}

export function zAt(siblings: readonly CanvasNode[], position: number): number {
  const before = siblings[position - 1];
  const after = siblings[position];
  if (before && after) return (before.z + after.z) / 2;
  if (before) return before.z + 1;
  if (after) return after.z - 1;
  return 1;
}

export function reparent(scene: Scene, node: CanvasNode, parentId: string | null, z: number): CanvasNode {
  const world = worldOrigin(scene, node);
  const parent = parentId ? scene.get(parentId) : undefined;
  const origin = parent ? worldOrigin(scene, parent) : { x: 0, y: 0 };
  return { ...node, parentId, z, x: world.x - origin.x, y: world.y - origin.y };
}

export function frameAt(scene: Scene, index: Index, point: Point, exclude: ReadonlySet<string>): string | null {
  let best: { id: string; depth: number; order: number } | null = null;
  let order = 0;
  const walk = (parent: string | null, depth: number) => {
    for (const node of index.get(parent) ?? []) {
      order++;
      if (node.hidden || exclude.has(node.id)) continue;
      if (node.type === "frame" && containsPoint(worldBox(scene, node), point)) {
        if (!best || depth > best.depth || (depth === best.depth && order > best.order)) best = { id: node.id, depth, order };
        walk(node.id, depth + 1);
      } else if (node.type === "group") walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return (best as { id: string } | null)?.id ?? null;
}

export function dropMoved(scene: Scene, index: Index, moved: readonly CanvasNode[], world: Point, copiedFrom: readonly string[] = []): CanvasNode[] {
  const exclude = new Set([...moved, ...topmost(scene, copiedFrom)].flatMap((node) => [node.id, ...descendants(scene, node.id, index as Map<string | null, CanvasNode[]>).map((child) => child.id)]));
  const target = frameAt(scene, index, world, exclude);
  const container = target ? scene.get(target) : undefined;
  const siblings = (index.get(target) ?? []).filter((item) => !moved.some((node) => node.id === item.id));
  return moved.map((node) => {
    const parent = effectiveParent(scene, node);
    if (parent && scene.get(parent)?.type === "group") return node;
    if (container?.layout) {
      const row = container.layout.direction === "row";
      const origin = worldOrigin(scene, container);
      const position = siblings.filter((item) => (row ? origin.x + item.x + item.width / 2 : origin.y + item.y + item.height / 2) < (row ? world.x : world.y)).length;
      const z = zAt(siblings, position);
      return target === parent ? { ...node, z } : reparent(scene, node, target, z);
    }
    if (target === parent) return node;
    return reparent(scene, node, target, nextZ(siblings));
  });
}

export const CLIPBOARD_MARK = "origin-canvas/v1";
export type Clipboard = { mark: typeof CLIPBOARD_MARK; nodes: CanvasNode[]; roots: string[] };

export function copySelection(scene: Scene, index: Index, ids: readonly string[]): Clipboard | null {
  const roots = topmost(scene, ids);
  if (!roots.length) return null;
  const nodes: CanvasNode[] = [];
  for (const root of roots) {
    const world = worldOrigin(scene, root);
    nodes.push({ ...root, parentId: null, x: world.x, y: world.y });
    nodes.push(...descendants(scene, root.id, index as Map<string | null, CanvasNode[]>));
  }
  return { mark: CLIPBOARD_MARK, nodes, roots: roots.map((node) => node.id) };
}

export function pasteClipboard(scene: Scene, index: Index, clip: Clipboard, parentId: string | null, offset: number): { nodes: CanvasNode[]; roots: string[] } {
  const ids = new Map(clip.nodes.map((node) => [node.id, randomId()]));
  const parent = parentId ? scene.get(parentId) : undefined;
  const origin = parent ? worldOrigin(scene, parent) : { x: 0, y: 0 };
  let z = nextZ(index.get(parentId) ?? []);
  const nodes = clip.nodes.map((node) => {
    const root = clip.roots.includes(node.id);
    return {
      ...node, id: ids.get(node.id)!, version: 1,
      parentId: root ? parentId : ids.get(node.parentId ?? "") ?? null,
      ...(root ? { x: node.x - origin.x + offset, y: node.y - origin.y + offset, z: z++ } : {}),
    };
  });
  return { nodes, roots: clip.roots.map((id) => ids.get(id)!) };
}

export function parseClipboard(text: string): Clipboard | null {
  try {
    const value = JSON.parse(text) as Partial<Clipboard>;
    if (value.mark !== CLIPBOARD_MARK || !Array.isArray(value.nodes) || !Array.isArray(value.roots)) return null;
    const nodes = value.nodes.map(sanitizeNode).filter((node): node is CanvasNode => Boolean(node && !node.deleted));
    const roots = value.roots.filter((id) => nodes.some((node) => node.id === id));
    return roots.length ? { mark: CLIPBOARD_MARK, nodes, roots } : null;
  } catch {
    return null;
  }
}
