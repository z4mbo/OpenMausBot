import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { fitGroup } from "../../../../shared/canvas-ops";
import {
  CANVAS_ROW_FORMAT, childrenIndex, decodeScene, isLive, layoutRoot, layoutStacks, layoutText, randomNonce,
  type CanvasNode,
} from "../../../../shared/canvas-scene";
import type { drawingOutbox } from "@/lib/origin-drawing-outbox";
import { measureText } from "./geometry";

type Outbox = ReturnType<typeof drawingOutbox>;
type Snapshot = Map<string, CanvasNode | undefined>;

const HISTORY_MAX = 200;

const sameNode = (a: CanvasNode, b: CanvasNode | undefined) => {
  if (!b) return false;
  const { version: _a, versionNonce: _b, ...left } = a;
  const { version: _c, versionNonce: _d, ...right } = b;
  return JSON.stringify(left) === JSON.stringify(right);
};

const newer = (incoming: CanvasNode, current: CanvasNode | undefined) =>
  !current || incoming.version > current.version || (incoming.version === current.version && incoming.versionNonce < current.versionNonce);

function settle(work: Map<string, CanvasNode>, touched: Set<string>, before: Snapshot) {
  const put = (node: CanvasNode) => { work.set(node.id, node); touched.add(node.id); };
  for (const id of touched) {
    const node = work.get(id);
    if (!isLive(node) || node.type !== "text") continue;
    const size = layoutText(node, measureText);
    const { unmeasured: _measured, ...rest } = node;
    if (node.unmeasured || Math.abs(size.height - node.height) > 0.01 || (node.autoWidth && Math.abs(size.width - node.width) > 0.01)) {
      put({ ...rest, height: size.height, ...(node.autoWidth ? { width: size.width } : {}) });
    }
  }
  const roots = new Set<string>();
  for (const id of touched) {
    for (const candidate of [id, work.get(id)?.parentId, before.get(id)?.parentId]) {
      if (!candidate) continue;
      const root = layoutRoot(work, candidate);
      if (root) roots.add(root);
    }
  }
  for (const node of layoutStacks(work, roots, measureText)) put(node);
  const groups = new Set<string>();
  for (const id of touched) for (const parent of [work.get(id)?.parentId, before.get(id)?.parentId]) if (parent && work.get(parent)?.type === "group") groups.add(parent);
  for (const group of groups) {
    fitGroup(work, group, put);
    let parent = work.get(group)?.parentId;
    while (parent && work.get(parent)?.type === "group") { fitGroup(work, parent, put); parent = work.get(parent)?.parentId; }
  }
}

export interface CanvasScene {
  scene: ReadonlyMap<string, CanvasNode>;
  index: Map<string | null, CanvasNode[]>;
  revision: number;
  commit(nodes: readonly CanvasNode[], options?: { history?: boolean; before?: ReadonlyMap<string, CanvasNode | undefined> }): void;
  preview(nodes: readonly CanvasNode[] | null): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useCanvasScene(rows: readonly string[] | undefined, outbox: Outbox, readOnly: boolean): CanvasScene {
  const base = useRef(new Map<string, CanvasNode>());
  const draft = useRef(new Map<string, CanvasNode>());
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const [revision, bump] = useReducer((value: number) => value + 1, 0);

  const write = useCallback((nodes: readonly CanvasNode[], before: ReadonlyMap<string, CanvasNode | undefined> | undefined): Snapshot => {
    const work = new Map(base.current);
    const touched = new Set<string>();
    const snapshot: Snapshot = new Map();
    for (const node of nodes) {
      if (!snapshot.has(node.id)) snapshot.set(node.id, before?.has(node.id) ? before.get(node.id) : base.current.get(node.id));
      work.set(node.id, node);
      touched.add(node.id);
    }
    settle(work, touched, snapshot);
    const saved: CanvasNode[] = [];
    for (const id of touched) {
      if (!snapshot.has(id)) snapshot.set(id, base.current.get(id));
      const node = { ...work.get(id)!, version: (base.current.get(id)?.version ?? 0) + 1, versionNonce: randomNonce() };
      work.set(id, node);
      saved.push(node);
    }
    base.current = work;
    outbox.enqueue(saved.map((node) => ({ format: CANVAS_ROW_FORMAT, ...node })));
    return snapshot;
  }, [outbox]);

  const commit = useCallback<CanvasScene["commit"]>((all, options = {}) => {
    const nodes = all.filter((node) => !sameNode(node, base.current.get(node.id)));
    if (readOnly || !nodes.length) { if (draft.current.size) { draft.current.clear(); bump(); } return; }
    draft.current.clear();
    const snapshot = write(nodes, options.before);
    if (options.history !== false) {
      undoStack.current.push(snapshot);
      if (undoStack.current.length > HISTORY_MAX) undoStack.current.shift();
      redoStack.current = [];
    }
    bump();
  }, [readOnly, write]);

  const travel = useCallback((from: { current: Snapshot[] }, to: { current: Snapshot[] }) => {
    const step = from.current.pop();
    if (!step || readOnly) return;
    draft.current.clear();
    const restored = [...step].map(([id, node]) => {
      const current = base.current.get(id);
      return node ? { ...node } : { ...current!, deleted: true };
    }).filter((node) => node.id);
    to.current.push(write(restored, undefined));
    bump();
  }, [readOnly, write]);

  useEffect(() => {
    if (!rows) return;
    let changed = false;
    const merged = decodeScene([...rows, ...outbox.elements().map((element) => JSON.stringify(element))]);
    for (const node of merged) {
      if (newer(node, base.current.get(node.id))) { base.current.set(node.id, node); changed = true; }
    }
    if (changed) {
      base.current = new Map(base.current);
      bump();
    }
    if (!readOnly) {
      const unmeasured = [...base.current.values()].filter((node) => !node.deleted && node.unmeasured);
      if (unmeasured.length) { write(unmeasured, undefined); bump(); }
    }
  }, [rows, outbox, readOnly, write]);

  const scene = useMemo(() => {
    if (!draft.current.size) return base.current;
    const merged = new Map(base.current);
    for (const [id, node] of draft.current) merged.set(id, node);
    return merged;
  }, [revision]);
  const index = useMemo(() => childrenIndex(scene), [scene]);

  return {
    scene, index, revision, commit,
    preview: useCallback((nodes) => {
      draft.current = new Map((nodes ?? []).map((node) => [node.id, node]));
      bump();
    }, []),
    undo: useCallback(() => travel(undoStack, redoStack), [travel]),
    redo: useCallback(() => travel(redoStack, undoStack), [travel]),
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}
