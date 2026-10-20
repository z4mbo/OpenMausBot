import {
  SYNCED_KEYS, ancestors, childrenIndex, descendants, isLive, nextZ, randomId, randomNonce,
  type CanvasNode, type Constraints, type Scene, type SyncedKey,
} from "./canvas-scene.ts";

type Index = ReadonlyMap<string | null, readonly CanvasNode[]>;
type Put = (node: CanvasNode) => void;

const ROOT_OWN = new Set<SyncedKey>(["x", "y"]);
function bare(node: CanvasNode): CanvasNode {
  const { component: _component, instanceOf: _instance, library: _library, overrides: _overrides, issue: _issue, page: _page, locked: _locked, prototype: _prototype, ...rest } = node;
  return rest;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Where a child of a resized frame without auto layout lands under its constraints. */
export function constrain(child: Pick<CanvasNode, "x" | "y" | "width" | "height" | "constraints">, from: { width: number; height: number }, to: { width: number; height: number }) {
  const rule: Constraints = child.constraints ?? { h: "left", v: "top" };
  const axis = (start: number, size: number, before: number, after: number, how: string) => {
    const delta = after - before;
    if (how === "right" || how === "bottom") return { start: start + delta, size };
    if (how === "center") return { start: start + delta / 2, size };
    if (how === "stretch") return { start, size: Math.max(1, size + delta) };
    if (how === "scale" && before > 0) return { start: (start * after) / before, size: Math.max(1, (size * after) / before) };
    return { start, size };
  };
  const h = axis(child.x, child.width, from.width, to.width, rule.h);
  const v = axis(child.y, child.height, from.height, to.height, rule.v);
  return { x: h.start, width: h.size, y: v.start, height: v.size };
}

/** The children of `frame` moved and sized by their constraints after the frame went from `from` to its current size. */
export function constrainChildren(index: Index, frame: CanvasNode, from: { width: number; height: number }): CanvasNode[] {
  if (frame.layout || (frame.type !== "frame" && frame.type !== "group") || (Math.abs(from.width - frame.width) < 0.01 && Math.abs(from.height - frame.height) < 0.01)) return [];
  return (index.get(frame.id) ?? []).flatMap((child) => {
    if (!child.constraints) return [];
    const box = constrain(child, from, frame);
    const scaleX = box.width / Math.max(1, child.width);
    const scaleY = box.height / Math.max(1, child.height);
    return [{ ...child, ...box, ...(child.points ? { points: child.points.map((value, at) => value * (at % 2 === 0 ? scaleX : scaleY)) } : {}) }];
  });
}

/** The component a node belongs to: itself when it is one, else its nearest component ancestor. */
export function componentOf(scene: Scene, node: CanvasNode): CanvasNode | null {
  if (node.component) return node;
  return [...ancestors(scene, node)].reverse().find((parent) => parent.component) ?? null;
}

/** The instance root a node belongs to: itself when it is one, else its nearest instance ancestor. */
export function instanceOf(scene: Scene, node: CanvasNode): CanvasNode | null {
  if (node.instanceOf) return node;
  return [...ancestors(scene, node)].reverse().find((parent) => parent.instanceOf) ?? null;
}

/** A fresh copy of a component's subtree as an instance under `parentId`, every node mirroring its source. */
export function instantiate(masterNodes: readonly CanvasNode[], parentId: string | null, at: { x: number; y: number; z: number }, library?: string): CanvasNode[] {
  const master = masterNodes[0];
  if (!master) return [];
  const ids = new Map(masterNodes.map((node) => [node.id, randomId()]));
  return masterNodes.map((node, order) => {
    const copy: CanvasNode = { ...bare(node), id: ids.get(node.id)!, version: 1, versionNonce: randomNonce(), sourceId: node.id, parentId: order === 0 ? parentId : ids.get(node.parentId ?? "") ?? null };
    if (order === 0) Object.assign(copy, { instanceOf: master.id, x: at.x, y: at.y, z: at.z, ...(library ? { library } : {}) });
    return copy;
  });
}

/**
 * Brings one instance in line with its component's nodes (root first): copies every property the instance did not
 * override, adds nodes the component gained and deletes the ones it lost. Children of a resized instance follow their constraints.
 */
export function syncInstance(scene: Scene, index: Index, rootId: string, masterNodes: readonly CanvasNode[], put: Put): void {
  const root = scene.get(rootId);
  const master = masterNodes[0];
  if (!isLive(root) || !master) return;
  const own = [root, ...descendants(scene, root.id, index as Map<string | null, CanvasNode[]>)];
  const bySource = new Map(own.map((node) => [node.id === root.id ? master.id : node.sourceId ?? "", node]));
  const mapped = new Map<string, string>([[master.id, root.id]]);
  for (const node of masterNodes.slice(1)) mapped.set(node.id, bySource.get(node.id)?.id ?? randomId());
  const resized = { width: root.overrides?.includes("width") ? root.width : master.width, height: root.overrides?.includes("height") ? root.height : master.height };
  for (const source of masterNodes) {
    const target = source.id === master.id ? root : bySource.get(source.id);
    const id = mapped.get(source.id)!;
    const parentId = source.id === master.id ? root.parentId : mapped.get(source.parentId ?? "") ?? root.id;
    const base: CanvasNode = target ?? { ...bare(source), id, version: 1, versionNonce: randomNonce(), parentId, sourceId: source.id };
    const next: Record<string, unknown> = { ...base };
    const kept = new Set(base.overrides ?? []);
    for (const key of SYNCED_KEYS) {
      if (kept.has(key) || (source.id === master.id && ROOT_OWN.has(key))) continue;
      if (source[key] === undefined) delete next[key]; else next[key] = source[key];
    }
    if (source.id !== master.id) {
      next.parentId = parentId;
      next.z = source.z;
      if (source.parentId === master.id && !master.layout && (resized.width !== master.width || resized.height !== master.height) && !kept.has("x") && !kept.has("width")) {
        Object.assign(next, constrain(source, master, resized));
      }
    }
    if (!target || SYNCED_KEYS.some((key) => !same(next[key], base[key])) || next.parentId !== base.parentId || next.z !== base.z) put(next as unknown as CanvasNode);
  }
  const wanted = new Set(masterNodes.map((node) => node.id));
  for (const node of own) if (node.id !== root.id && (!node.sourceId || !wanted.has(node.sourceId))) put({ ...node, deleted: true });
}

/** A component's own subtree, root first. */
export const masterTree = (scene: Scene, index: Index, id: string): CanvasNode[] => {
  const master = scene.get(id);
  return isLive(master) ? [master, ...descendants(scene, id, index as Map<string | null, CanvasNode[]>)] : [];
};

/**
 * After `touched` nodes changed: records the properties a person changed on instance nodes as overrides (against `before`),
 * then re-syncs every instance of a touched component and every touched instance, repeating for nested components.
 */
export function settleComponents(work: Map<string, CanvasNode>, touched: Set<string>, before: ReadonlyMap<string, CanvasNode | undefined>): void {
  const put = (node: CanvasNode) => { work.set(node.id, node); touched.add(node.id); };
  for (const id of touched) {
    const node = work.get(id);
    const previous = before.get(id);
    if (!isLive(node) || !node.sourceId || !previous || previous.deleted) continue;
    const isRoot = Boolean(node.instanceOf);
    const changed = SYNCED_KEYS.filter((key) => !(isRoot && ROOT_OWN.has(key)) && !same(node[key], previous[key]));
    const added = changed.filter((key) => !node.overrides?.includes(key));
    if (added.length) work.set(id, { ...node, overrides: [...(node.overrides ?? []), ...added] });
  }
  let pending = new Set(touched);
  for (let round = 0; round < 4 && pending.size; round++) {
    const index = childrenIndex(work);
    const masters = new Set<string>();
    const roots = new Set<string>();
    for (const id of pending) {
      const node = work.get(id);
      if (!node) continue;
      const anchor = node.deleted ? work.get(node.parentId ?? "") : node;
      if (!isLive(anchor)) continue;
      const component = componentOf(work, anchor);
      if (component) masters.add(component.id);
      const instance = instanceOf(work, anchor);
      if (instance && !instance.library) roots.add(instance.id);
    }
    for (const node of work.values()) if (isLive(node) && node.instanceOf && masters.has(node.instanceOf) && !node.library) roots.add(node.id);
    const changed = new Set<string>();
    for (const rootId of roots) {
      const root = work.get(rootId)!;
      const tree = masterTree(work, index, root.instanceOf!);
      if (!tree.length || tree.some((node) => node.id === rootId)) continue;
      syncInstance(work, index, rootId, tree, (node) => { put(node); changed.add(node.id); });
    }
    pending = changed;
  }
}

/** Removes the instance link from an instance's subtree, keeping how it looks. */
export function detach(scene: Scene, index: Index, rootId: string): CanvasNode[] {
  const root = scene.get(rootId);
  if (!isLive(root) || !root.instanceOf) return [];
  return [root, ...descendants(scene, rootId, index as Map<string | null, CanvasNode[]>)].filter((node) => node.sourceId || node.instanceOf).map((node) => {
    const { instanceOf: _instance, library: _library, sourceId: _source, overrides: _overrides, ...rest } = node;
    return rest;
  });
}

/** Drops an instance node's overrides so it follows its component again. */
export const resetOverrides = (nodes: readonly CanvasNode[]): CanvasNode[] => nodes.filter((node) => node.overrides?.length).map((node) => ({ ...node, overrides: undefined }));

/** The components of the scene, grouped by variant set (a lone component is its own set). */
export function componentSets(scene: Scene): { set: string; components: CanvasNode[] }[] {
  const sets = new Map<string, CanvasNode[]>();
  for (const node of scene.values()) {
    if (!isLive(node) || !node.component) continue;
    const key = node.component.set || `\u0000${node.id}`;
    sets.set(key, [...(sets.get(key) ?? []), node]);
  }
  return [...sets.entries()].map(([set, components]) => ({ set: set.startsWith("\u0000") ? components[0]!.name : set, components: components.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.set.localeCompare(b.set));
}

/** Each variant property of a set with the values its components use. */
export function variantProps(components: readonly CanvasNode[]): Map<string, string[]> {
  const props = new Map<string, string[]>();
  for (const component of components) for (const [key, value] of Object.entries(component.component?.props ?? {})) {
    const values = props.get(key) ?? [];
    if (!values.includes(value)) values.push(value);
    props.set(key, values);
  }
  return props;
}

/** The component of `components` closest to `current` with property `key` set to `value`. */
export function pickVariant(components: readonly CanvasNode[], current: CanvasNode, key: string, value: string): CanvasNode | null {
  const wanted = { ...current.component?.props, [key]: value };
  const score = (node: CanvasNode) => Object.entries(wanted).filter(([prop, expected]) => node.component?.props?.[prop] === expected).length;
  const candidates = components.filter((node) => node.component?.props?.[key] === value);
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
}

const pathOf = (nodes: ReadonlyMap<string, CanvasNode>, node: CanvasNode, rootId: string) => {
  const names: string[] = [];
  let current: CanvasNode | undefined = node;
  while (current && current.id !== rootId) { names.unshift(current.name); current = current.parentId ? nodes.get(current.parentId) : undefined; }
  return names.join("/");
};

/** An instance pointed at another variant: nodes keep their overrides where the new variant has a layer of the same name path. */
export function swapVariant(scene: Scene, index: Index, rootId: string, from: readonly CanvasNode[], to: readonly CanvasNode[]): CanvasNode[] {
  const root = scene.get(rootId);
  if (!isLive(root) || !from[0] || !to[0]) return [];
  const fromMap = new Map(from.map((node) => [node.id, node]));
  const toMap = new Map(to.map((node) => [node.id, node]));
  const target = new Map(to.slice(1).map((node) => [pathOf(toMap, node, to[0]!.id), node.id]));
  const work = new Map(scene);
  const out = new Map<string, CanvasNode>();
  const put = (node: CanvasNode) => { work.set(node.id, node); out.set(node.id, node); };
  put({ ...root, instanceOf: to[0].id, sourceId: to[0].id, name: root.overrides?.includes("name") ? root.name : to[0].name });
  for (const node of descendants(scene, rootId, index as Map<string | null, CanvasNode[]>)) {
    const source = node.sourceId ? fromMap.get(node.sourceId) : undefined;
    const next = source ? target.get(pathOf(fromMap, source, from[0].id)) : undefined;
    if (next) put({ ...node, sourceId: next });
  }
  syncInstance(work, childrenIndex(work), rootId, to, put);
  return [...out.values()];
}

/** A frame made a component, or a new component frame around the given siblings. */
export function makeComponent(node: CanvasNode): CanvasNode {
  const { instanceOf: _instance, library: _library, sourceId: _source, overrides: _overrides, ...rest } = node;
  return { ...rest, component: node.component ?? {} };
}

export const nextSiblingZ = (index: Index, parentId: string | null) => nextZ(index.get(parentId) ?? []);
