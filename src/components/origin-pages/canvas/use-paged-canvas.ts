import { useCallback, useMemo } from "react";
import type { CanvasNode } from "../../../../shared/canvas-scene";
import type { CanvasScene } from "./use-canvas-scene";

export type CanvasPage = { id: string; name: string; guides?: { axis: "x" | "y"; at: number }[] };

export const FIRST_PAGE = "page-1";

export const pageOf = (node: Pick<CanvasNode, "page">, first: string) => node.page ?? first;

/** The canvas seen from one page: only that page's top-level nodes, and new top-level nodes land on it. */
export function usePagedCanvas(canvas: CanvasScene, page: string, first: string): CanvasScene {
  const { index, commit, preview } = canvas;
  const paged = useMemo(() => {
    const out = new Map(index);
    out.set(null, (index.get(null) ?? []).filter((node) => pageOf(node, first) === page));
    return out;
  }, [index, page, first]);
  const place = useCallback((nodes: readonly CanvasNode[]) => nodes.map((node) => {
    if (node.parentId !== null || node.deleted || pageOf(node, first) === page) return node;
    const { page: _page, ...rest } = node;
    return page === first ? rest : { ...rest, page };
  }), [page, first]);
  const pagedCommit = useCallback<CanvasScene["commit"]>((nodes, options) => commit(place(nodes), options), [commit, place]);
  const pagedPreview = useCallback<CanvasScene["preview"]>((nodes, options) => preview(nodes ? place(nodes) : null, options), [preview, place]);
  return { ...canvas, index: paged, commit: pagedCommit, preview: pagedPreview };
}
