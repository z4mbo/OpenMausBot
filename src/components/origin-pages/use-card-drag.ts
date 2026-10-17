import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export type DropTarget = { columnId: string; beforeTaskId?: string };
export type CardDrag = { taskId: string; width: number; height: number; x: number; y: number };

const MOUSE_SLOP = 5;
const TOUCH_HOLD_MS = 280;
const TOUCH_SLOP = 8;
const EDGE = 56;
const EDGE_SPEED = 14;

/** Where a card dropped at (x, y) lands: the lane under the pointer and the first other card whose middle is below it. */
export function dropTargetAt(root: HTMLElement, taskId: string, x: number, y: number): DropTarget | null {
  const lanes = [...root.querySelectorAll<HTMLElement>("[data-column-id]")];
  if (!lanes.length) return null;
  const lane = lanes.find((item) => { const rect = item.getBoundingClientRect(); return x >= rect.left && x <= rect.right; })
    ?? lanes.reduce((best, item) => {
      const distance = (element: HTMLElement) => { const rect = element.getBoundingClientRect(); return Math.min(Math.abs(x - rect.left), Math.abs(x - rect.right)); };
      return distance(item) < distance(best) ? item : best;
    });
  const cards = [...lane.querySelectorAll<HTMLElement>("[data-task-id]")].filter((card) => card.dataset.taskId !== taskId);
  const before = cards.find((card) => { const rect = card.getBoundingClientRect(); return rect.height > 0 && rect.top + rect.height / 2 > y; });
  return { columnId: lane.dataset.columnId!, ...(before ? { beforeTaskId: before.dataset.taskId } : {}) };
}

/**
 * Pointer-driven card dragging: a floating copy follows the pointer (written straight to the DOM, so moving re-renders nothing)
 * and the board re-renders only when the drop target changes. Touch starts after a short hold so a swipe still scrolls.
 */
export function useCardDrag({ enabled, root, onDrop }: {
  enabled: boolean;
  root: RefObject<HTMLElement | null>;
  onDrop(taskId: string, target: DropTarget, from: DOMRect): void;
}) {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const live = useRef<{ drag: CardDrag; offsetX: number; offsetY: number; x: number; y: number; target: DropTarget | null } | null>(null);
  const dropped = useRef(false);
  const handler = useRef(onDrop);
  handler.current = onDrop;

  const active = drag !== null;
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const place = () => {
      const state = live.current;
      const board = root.current;
      if (!state || !board) return;
      if (ghost.current) ghost.current.style.transform = `translate3d(${state.x - state.offsetX}px, ${state.y - state.offsetY}px, 0)`;
      const bounds = board.getBoundingClientRect();
      if (state.x < bounds.left + EDGE) board.scrollLeft -= EDGE_SPEED;
      else if (state.x > bounds.right - EDGE) board.scrollLeft += EDGE_SPEED;
      const list = document.elementsFromPoint(state.x, state.y).find((element) => element instanceof HTMLElement && element.dataset.laneList !== undefined) as HTMLElement | undefined;
      if (list) {
        const rect = list.getBoundingClientRect();
        if (state.y < rect.top + EDGE) list.scrollTop -= EDGE_SPEED;
        else if (state.y > rect.bottom - EDGE) list.scrollTop += EDGE_SPEED;
      }
      const next = dropTargetAt(board, state.drag.taskId, state.x, state.y);
      if (next?.columnId !== state.target?.columnId || next?.beforeTaskId !== state.target?.beforeTaskId) {
        state.target = next;
        setTarget(next);
      }
      frame = requestAnimationFrame(place);
    };
    const move = (event: PointerEvent) => { if (live.current) { live.current.x = event.clientX; live.current.y = event.clientY; } };
    const blockScroll = (event: TouchEvent) => event.preventDefault();
    const finish = (commit: boolean) => {
      const state = live.current;
      live.current = null;
      document.body.style.userSelect = "";
      if (state && commit && state.target) {
        dropped.current = true;
        setTimeout(() => { dropped.current = false; }, 0);
        handler.current(state.drag.taskId, state.target, ghost.current?.getBoundingClientRect() ?? new DOMRect(state.x - state.offsetX, state.y - state.offsetY, state.drag.width, state.drag.height));
      }
      setDrag(null);
      setTarget(null);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); finish(false); } };
    document.body.style.userSelect = "none";
    frame = requestAnimationFrame(place);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("touchmove", blockScroll, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("touchmove", blockScroll);
      document.body.style.userSelect = "";
    };
  }, [active, root]);

  const begin = (card: HTMLElement, taskId: string, x: number, y: number, startX: number, startY: number) => {
    const rect = card.getBoundingClientRect();
    const next = { taskId, width: rect.width, height: rect.height, x: rect.left + (x - startX), y: rect.top + (y - startY) };
    live.current = { drag: next, offsetX: startX - rect.left, offsetY: startY - rect.top, x, y, target: null };
    setDrag(next);
  };

  /** Wire to a card's onPointerDown. */
  const press = (event: ReactPointerEvent<HTMLElement>, taskId: string) => {
    if (!enabled || event.button !== 0 || drag || (event.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    const card = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const touch = event.pointerType === "touch";
    let timer = 0;
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", watch);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    const watch = (move: PointerEvent) => {
      const distance = Math.hypot(move.clientX - startX, move.clientY - startY);
      if (touch) { if (distance > TOUCH_SLOP) stop(); return; }
      if (distance > MOUSE_SLOP) { stop(); begin(card, taskId, move.clientX, move.clientY, startX, startY); }
    };
    if (touch) timer = window.setTimeout(() => { stop(); navigator.vibrate?.(10); begin(card, taskId, startX, startY, startX, startY); }, TOUCH_HOLD_MS);
    window.addEventListener("pointermove", watch);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  return { drag, target, ghost, press, justDropped: () => dropped.current };
}
