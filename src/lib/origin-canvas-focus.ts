import { useSyncExternalStore } from "react";

/** The canvas frame a Canvas page should open on once it shows its project. */
export interface CanvasFocus {
  projectId: string;
  canvasId: string;
  frameId: string;
}

let focus: CanvasFocus | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function requestCanvasFocus(next: CanvasFocus): void {
  focus = next;
  notify();
}

export function consumeCanvasFocus(done: CanvasFocus): void {
  if (focus !== done) return;
  focus = null;
  notify();
}

export function useCanvasFocus(projectId: string | null | undefined): CanvasFocus | null {
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => focus, () => null);
  return current && current.projectId === projectId ? current : null;
}
