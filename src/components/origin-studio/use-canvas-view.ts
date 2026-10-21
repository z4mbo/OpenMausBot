import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clampZoom, toGraph, zoomAt, type Point, type View } from "./workflow-geometry";

interface Pinch {
  distance: number;
  middle: Point;
  view: View;
}

/** Follows the pointer until it is released; a pinch interrupts it for good. */
export type Drag = (onMove: (event: PointerEvent) => void, onUp?: (event: PointerEvent, interrupted: boolean) => void) => void;

/**
 * The workflow canvas's pan and zoom: wheel and trackpad, a drag on empty canvas, and a two-finger pinch on touch
 * screens, which zooms about the fingers' midpoint and pans with it.
 */
export function useCanvasView(surface: RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState<View>({ x: 24, y: 24, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<Pinch | null>(null);

  const local = useCallback((event: { clientX: number; clientY: number }): Point => {
    const box = surface.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  }, [surface]);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = local(event);
      const mouseWheel = event.deltaMode !== 0 || (event.deltaX === 0 && Math.abs(event.deltaY) >= 50);
      if (event.ctrlKey || event.metaKey || mouseWheel) setView((current) => zoomAt(current, point, Math.exp(-event.deltaY * 0.0015)));
      else setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [surface, local]);

  useEffect(() => {
    const measure = () => {
      const points = [...touches.current.values()];
      const [a, b] = points;
      return a && b ? { distance: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1), middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } } : null;
    };
    const onMove = (event: PointerEvent) => {
      if (!touches.current.has(event.pointerId)) return;
      touches.current.set(event.pointerId, local(event));
      const start = pinch.current;
      const now = measure();
      if (!start || !now) return;
      const zoom = clampZoom(start.view.zoom * (now.distance / start.distance));
      const anchor = toGraph(start.middle, start.view);
      setView({ zoom, x: now.middle.x - anchor.x * zoom, y: now.middle.y - anchor.y * zoom });
    };
    const onUp = (event: PointerEvent) => {
      touches.current.delete(event.pointerId);
      if (touches.current.size < 2) pinch.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [local]);

  /** Registers a finger on the canvas before any node or port sees it, so the second one starts a pinch. */
  const onPointerDownCapture = useCallback((event: ReactPointerEvent) => {
    if (event.pointerType !== "touch") return;
    touches.current.set(event.pointerId, local(event));
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      pinch.current = { distance: Math.max(Math.hypot(a!.x - b!.x, a!.y - b!.y), 1), middle: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }, view: viewRef.current };
    }
  }, [local]);

  const drag: Drag = useCallback((onMove, onUp) => {
    let interrupted = false;
    const move = (event: PointerEvent) => {
      interrupted ||= pinch.current !== null;
      if (!interrupted) onMove(event);
    };
    const up = (event: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onUp?.(event, interrupted);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, []);

  const pan = useCallback((event: ReactPointerEvent) => {
    const start = { x: event.clientX, y: event.clientY, view: viewRef.current };
    drag((move) => setView({ ...start.view, x: start.view.x + move.clientX - start.x, y: start.view.y + move.clientY - start.y }));
  }, [drag]);

  const zoomBy = useCallback((factor: number) => {
    const box = surface.current?.getBoundingClientRect();
    setView((current) => zoomAt(current, { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 }, factor));
  }, [surface]);

  return { view, setView, local, drag, pan, zoomBy, onPointerDownCapture, pinching: () => pinch.current !== null };
}
