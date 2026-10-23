import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

type Drag = { key: string; pointerId: number; x: number; y: number; active: boolean; handle: HTMLButtonElement };

export function usePointerReorder<TList extends HTMLElement = HTMLOListElement>(keys: readonly string[], disabled: boolean, onMove: (from: string, to: string) => void) {
  const listRef = useRef<TList | null>(null);
  const drag = useRef<Drag | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const release = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  };
  const cancel = () => { release(); setTargetKey(null); };
  useEffect(() => release, []);
  const targetAt = (event: PointerEvent<HTMLButtonElement>): string | null => {
    const list = listRef.current;
    if (!list) return null;
    const bounds = list.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return null;
    for (const element of event.currentTarget.ownerDocument.elementsFromPoint(event.clientX, event.clientY)) {
      const row = element.closest<HTMLElement>("[data-reorder-key]");
      const key = row?.dataset.reorderKey;
      if (row && list.contains(row) && row.closest("[data-reorder-list]") === list && key && keys.includes(key)) return key;
    }
    return null;
  };
  const activate = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || disabled) return null;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 3) current.active = true;
    return current;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
  };
  const handleProps = (key: string) => ({
    draggable: false,
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (disabled || event.button !== 0 || !event.isPrimary) return;
      cancel();
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      drag.current = { key, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, handle: event.currentTarget };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const current = activate(event);
      if (!current?.active) return;
      event.preventDefault(); event.stopPropagation();
      setTargetKey(targetAt(event));
    },
    onPointerUp(event: PointerEvent<HTMLButtonElement>) {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      const target = activate(event)?.active ? targetAt(event) : null;
      cancel();
      if (target && current.key !== target && keys.includes(current.key)) onMove(current.key, target);
    },
    onPointerCancel(event: PointerEvent<HTMLButtonElement>) { if (drag.current?.pointerId === event.pointerId) cancel(); },
    onLostPointerCapture(event: PointerEvent<HTMLButtonElement>) { if (drag.current?.pointerId === event.pointerId) cancel(); },
  });
  return { listRef, targetKey, handleProps, onKeyDown, cancel };
}
