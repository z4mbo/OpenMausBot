import { useLayoutEffect, useRef, type RefObject } from "react";
import { EASE_OUT, MOTION_MS } from "@/lib/motion";

type Ordered = { _id: string; columnId: string; order: number };

/** The order `tasks:moveTask` gives a task dropped into `columnId` before `beforeTaskId`, or at the end of the column without one. */
export function orderForMove(tasks: readonly Ordered[], taskId: string, columnId: string, beforeTaskId?: string): number {
  const lane = tasks.filter((task) => task.columnId === columnId && task._id !== taskId).sort((a, b) => a.order - b.order);
  const index = beforeTaskId ? lane.findIndex((task) => task._id === beforeTaskId) : -1;
  if (index < 0) return lane.length ? Math.max(...lane.map((task) => task.order)) + 1 : 0;
  const before = lane[index]!;
  const previous = lane[index - 1];
  return previous ? (previous.order + before.order) / 2 : before.order - 1;
}

export type PendingMove = { columnId: string; order: number };

/** Drops `move` once its request settles, unless a later move of the same task has replaced it. */
export function settlePendingMove(pending: ReadonlyMap<string, PendingMove>, taskId: string, move: PendingMove): ReadonlyMap<string, PendingMove> {
  if (pending.get(taskId) !== move) return pending;
  const next = new Map(pending);
  next.delete(taskId);
  return next;
}

export function withPendingMoves<T extends Ordered>(tasks: readonly T[], pending: ReadonlyMap<string, PendingMove>): T[] {
  return tasks.map((task) => {
    const move = pending.get(task._id);
    return move ? { ...task, ...move } : task;
  }).sort((a, b) => a.order - b.order);
}

/** The neighbour to drop before when a task moves one step up or down its lane, or undefined for the end. */
export function stepTarget(lane: readonly { _id: string }[], taskId: string, direction: -1 | 1): { beforeTaskId?: string } | null {
  const index = lane.findIndex((task) => task._id === taskId);
  if (index < 0) return null;
  if (direction === -1) return index === 0 ? null : { beforeTaskId: lane[index - 1]!._id };
  if (index === lane.length - 1) return null;
  const after = lane[index + 2];
  return after ? { beforeTaskId: after._id } : {};
}

type Spot = { x: number; y: number };

/** Where an element sits inside `root`'s scrolled content, so scrolling a lane or the board is not mistaken for a move. */
function spotOf(root: HTMLElement, element: HTMLElement, rect: { left: number; top: number }): Spot {
  const frame = root.getBoundingClientRect();
  const lane = element.closest<HTMLElement>("[data-lane-list]");
  return { x: rect.left - frame.left + root.scrollLeft, y: rect.top - frame.top + (lane?.scrollTop ?? 0) };
}

/**
 * Slides each `[data-flip-id]` child from where it was to where it is, on the renders where `moves` changed, and fades in a child that was not there before.
 * The returned `seed` sets where one child should start from, such as the spot a dragged copy was let go.
 */
export function useFlip(container: RefObject<HTMLElement | null>, moves: unknown): (id: string, from: DOMRect) => void {
  const last = useRef(new Map<string, Spot>());
  const seeds = useRef(new Map<string, DOMRect>());
  const animations = useRef(new Map<HTMLElement, Animation>());
  const seen = useRef(moves);
  useLayoutEffect(() => () => {
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
  }, []);
  useLayoutEffect(() => {
    const displayed = new Map<HTMLElement, DOMRect>();
    for (const [element, animation] of animations.current) {
      if (element.isConnected) displayed.set(element, element.getBoundingClientRect());
      animation.cancel();
    }
    animations.current.clear();
    const root = container.current;
    if (!root) return;
    const animate = seen.current !== moves;
    seen.current = moves;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const still = !animate || reduced;
    const arriving = last.current.size > 0 && !reduced;
    const next = new Map<string, Spot>();
    for (const element of root.querySelectorAll<HTMLElement>("[data-flip-id]")) {
      const id = element.dataset.flipId!;
      const rect = element.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      const spot = spotOf(root, element, rect);
      next.set(id, spot);
      const seed = seeds.current.get(id);
      let before = seed ? spotOf(root, element, seed) : last.current.get(id);
      const visual = displayed.get(element);
      if (!seed && before && visual) before = { x: before.x + visual.left - rect.left, y: before.y + visual.top - rect.top };
      if (!before && arriving && typeof element.animate === "function") {
        animations.current.set(element, element.animate([{ opacity: 0, transform: "scale(0.97)" }, { opacity: 1, transform: "none" }], { duration: MOTION_MS.base, easing: EASE_OUT }));
        continue;
      }
      if (still || !before || typeof element.animate !== "function") continue;
      const dx = before.x - spot.x;
      const dy = before.y - spot.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      animations.current.set(element, element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: MOTION_MS.slow, easing: EASE_OUT }));
    }
    if (animate) seeds.current.clear();
    last.current = next;
  });
  return (id, from) => { seeds.current.set(id, from); };
}
