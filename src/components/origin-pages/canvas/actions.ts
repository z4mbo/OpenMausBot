import { newNode } from "../../../../shared/canvas-ops";
import {
  descendants, effectiveParent, isLive, nextZ, randomId, sanitizeNode, worldOrigin, type CanvasNode, type CanvasNodeType, type Scene,
} from "../../../../shared/canvas-scene";
import { unionBox, worldBounds, type Box } from "./geometry";

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
