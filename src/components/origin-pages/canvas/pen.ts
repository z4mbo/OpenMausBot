import { useState } from "react";
import { newNode } from "../../../../shared/canvas-ops";
import { nextZ, worldOrigin, type CanvasNode, type Scene } from "../../../../shared/canvas-scene";
import type { Point } from "./geometry";
import type { CanvasScene } from "./use-canvas-scene";

/** A path being drawn with the pen: anchors and their handles in world space. */
export type PenDraft = { parentId: string | null; anchors: Point[]; handles: { in: Point; out: Point }[]; node: CanvasNode | null };

export const ZERO: Point = { x: 0, y: 0 };

/** The path node a pen draft makes, its points relative to `origin` (the parent's world origin). */
export function draftNode(base: CanvasNode, draft: PenDraft, origin: Point, closed: boolean): CanvasNode {
  const xs = draft.anchors.map((point) => point.x);
  const ys = draft.anchors.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const points = draft.anchors.flatMap((point) => [round(point.x - left), round(point.y - top)]);
  const curves = draft.handles.flatMap((handle) => [round(handle.in.x), round(handle.in.y), round(handle.out.x), round(handle.out.y)]);
  return {
    ...base, x: round(left - origin.x), y: round(top - origin.y), width: Math.max(...xs) - left, height: Math.max(...ys) - top, points,
    ...(curves.some((value) => value !== 0) ? { curves } : { curves: undefined }), closed: closed || undefined,
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

export type Anchor = { at: number; point: Point; in: Point; out: Point };

/** The anchors of a path node in world space. */
export function anchorsOf(node: CanvasNode, world: Point): Anchor[] {
  const points = node.points ?? [];
  const out: Anchor[] = [];
  for (let at = 0; at * 2 + 1 < points.length; at++) {
    const curve = node.curves ? node.curves.slice(at * 4, at * 4 + 4) : [0, 0, 0, 0];
    out.push({ at, point: { x: world.x + points[at * 2]!, y: world.y + points[at * 2 + 1]! }, in: { x: curve[0] ?? 0, y: curve[1] ?? 0 }, out: { x: curve[2] ?? 0, y: curve[3] ?? 0 } });
  }
  return out;
}

/** A path node with its anchors and handles replaced and its box refitted around the anchors. */
export function withAnchors(node: CanvasNode, world: Point, anchors: readonly Anchor[]): CanvasNode {
  if (anchors.length < 2) return node;
  const xs = anchors.map((anchor) => anchor.point.x);
  const ys = anchors.map((anchor) => anchor.point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const curves = anchors.flatMap((anchor) => [anchor.in.x, anchor.in.y, anchor.out.x, anchor.out.y].map(round));
  return {
    ...node, x: round(node.x + left - world.x), y: round(node.y + top - world.y), width: Math.max(...xs) - left, height: Math.max(...ys) - top,
    points: anchors.flatMap((anchor) => [round(anchor.point.x - left), round(anchor.point.y - top)]),
    curves: curves.some((value) => value !== 0) ? curves : undefined,
    ...(node.breaks ? { breaks: node.breaks.filter((at) => at < anchors.length) } : {}),
  };
}

/** Turns a sharp anchor smooth (handles along its neighbours) or a smooth one sharp. */
export function toggleSmooth(anchors: readonly Anchor[], at: number, closed: boolean): Anchor[] {
  const anchor = anchors[at];
  if (!anchor) return [...anchors];
  if (anchor.in.x || anchor.in.y || anchor.out.x || anchor.out.y) return anchors.map((item, index) => (index === at ? { ...item, in: ZERO, out: ZERO } : item));
  const previous = anchors[at - 1] ?? (closed ? anchors[anchors.length - 1] : undefined);
  const next = anchors[at + 1] ?? (closed ? anchors[0] : undefined);
  const from = previous?.point ?? anchor.point;
  const to = next?.point ?? anchor.point;
  const dx = (to.x - from.x) / 4;
  const dy = (to.y - from.y) / 4;
  return anchors.map((item, index) => (index === at ? { ...item, in: { x: -dx, y: -dy }, out: { x: dx, y: dy } } : item));
}

export const isPathNode = (node: CanvasNode | undefined): node is CanvasNode => Boolean(node && node.type === "path" && node.points && !node.locked);

type PenOptions = {
  canvas: CanvasScene; index: ReadonlyMap<string | null, readonly CanvasNode[]>; scene: Scene; zoom: number;
  frameAt(point: Point, exclude: ReadonlySet<string>): string | null; inkOn(parentId: string | null): string; onDone(id: string): void;
};

/** The pen tool: click to add sharp anchors, drag to pull smooth handles, click the first anchor to close, Enter to finish open. */
export function usePenTool({ canvas, index, scene, zoom, frameAt, inkOn, onDone }: PenOptions) {
  const [draft, setDraft] = useState<PenDraft | null>(null);
  const [hovered, setHovered] = useState<Point | null>(null);
  const base = (pen: PenDraft) => pen.node ?? newNode("path", pen.parentId, nextZ(index.get(pen.parentId) ?? []), { name: "Vector", stroke: inkOn(pen.parentId), strokeWidth: 2, fill: null });
  const origin = (pen: PenDraft) => (pen.parentId ? worldOrigin(scene, scene.get(pen.parentId)!) : { x: 0, y: 0 });
  const show = (pen: PenDraft) => {
    setDraft(pen);
    if (pen.anchors.length < 2) { canvas.preview(null); return; }
    pen.node = draftNode(base(pen), pen, origin(pen), false);
    canvas.preview([pen.node]);
  };
  const finish = (closed: boolean) => {
    const pen = draft;
    setDraft(null);
    setHovered(null);
    canvas.preview(null);
    if (!pen || pen.anchors.length < 2) return;
    const node = draftNode(base(pen), pen, origin(pen), closed);
    canvas.commit([node]);
    onDone(node.id);
  };
  return {
    draft, hovered, finish,
    hover: setHovered,
    cancel: () => { setDraft(null); setHovered(null); },
    /** Adds an anchor at `world` (or closes the path on its first anchor); true when a drag may pull its handles. */
    down(world: Point, straight: boolean): boolean {
      const pen: PenDraft = draft ?? { parentId: frameAt(world, new Set()), anchors: [], handles: [], node: null };
      const first = pen.anchors[0];
      if (first && pen.anchors.length >= 2 && Math.hypot(world.x - first.x, world.y - first.y) * zoom < 8) { finish(true); return false; }
      let point = { x: Math.round(world.x), y: Math.round(world.y) };
      const last = pen.anchors[pen.anchors.length - 1];
      if (straight && last) {
        const angle = Math.round(Math.atan2(point.y - last.y, point.x - last.x) / (Math.PI / 4)) * (Math.PI / 4);
        const length = Math.hypot(point.x - last.x, point.y - last.y);
        point = { x: Math.round(last.x + Math.cos(angle) * length), y: Math.round(last.y + Math.sin(angle) * length) };
      }
      show({ ...pen, anchors: [...pen.anchors, point], handles: [...pen.handles, { in: ZERO, out: ZERO }] });
      return true;
    },
    /** Pulls the last anchor's handles towards `world`, mirrored, for a smooth curve. */
    pull(world: Point) {
      if (!draft) return;
      const last = draft.anchors[draft.anchors.length - 1]!;
      const out = { x: Math.round(world.x - last.x), y: Math.round(world.y - last.y) };
      if (Math.hypot(out.x, out.y) * zoom < 3) return;
      show({ ...draft, handles: [...draft.handles.slice(0, -1), { in: { x: -out.x, y: -out.y }, out }] });
    },
    undo() {
      if (!draft) return;
      const pen = { ...draft, anchors: draft.anchors.slice(0, -1), handles: draft.handles.slice(0, -1) };
      if (!pen.anchors.length) { setDraft(null); canvas.preview(null); } else show(pen);
    },
  };
}
