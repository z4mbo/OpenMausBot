"use client";

import { useRef, useState } from "react";
import { SIDEBAR_COLLAPSE_WIDTH, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, sidebarDragResult } from "@/lib/sidebar-layout";

export function SidebarResizeHandle({ width, onResize, onCollapse }: { width: number; onResize: (width: number) => void; onCollapse: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number; delta: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return <div role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-controls="workspace-sidebar" aria-valuemin={SIDEBAR_COLLAPSE_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuenow={width} tabIndex={0}
    className={`sidebar-resize-handle ${dragging ? "is-dragging" : ""}`}
    onDoubleClick={() => onResize(SIDEBAR_DEFAULT_WIDTH)}
    onPointerDown={event => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      event.preventDefault();
      drag.current = { x: event.clientX, width, delta: 0 };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }}
    onPointerMove={event => {
      if (!drag.current) return;
      drag.current.delta = event.clientX - drag.current.x;
      onResize(sidebarDragResult(drag.current.width, drag.current.delta).width);
    }}
    onPointerUp={event => {
      const start = drag.current;
      if (!start) return;
      drag.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (sidebarDragResult(start.width, event.clientX - start.x).collapsed) onCollapse(start.width);
    }}
    onPointerCancel={() => { if (drag.current) onResize(drag.current.width); drag.current = null; setDragging(false); }}
    onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home" || event.key === "Enter") onCollapse(width);
      else if (event.key === "End") onResize(SIDEBAR_MAX_WIDTH);
      else onResize(sidebarDragResult(width, event.key === "ArrowLeft" ? -20 : 20).width);
    }} />;
}
