"use client";
import { useEffect, useRef } from "react";

export function useBoardScroll(enabled: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const board = ref.current?.querySelector<HTMLDivElement>(".kanban-scroll");
    if (!board || !enabled) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || matchMedia("(max-width: 700px)").matches) return;
      const target = event.target instanceof Element ? event.target.closest(".task-list") : null;
      if (target && target.scrollHeight > target.clientHeight && ((event.deltaY > 0 && target.scrollTop + target.clientHeight < target.scrollHeight - 1) || (event.deltaY < 0 && target.scrollTop > 0))) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board.clientWidth : 1);
      const next = Math.max(0, Math.min(board.scrollWidth - board.clientWidth, board.scrollLeft + delta));
      if (next === board.scrollLeft) return;
      event.preventDefault(); board.scrollLeft = next;
    };
    // On phones one lane fills the screen: start on the first lane that has issues.
    if (matchMedia("(max-width: 760px)").matches && board.scrollLeft === 0) {
      const lane = Array.from(board.querySelectorAll<HTMLElement>(".kanban-column")).find(column => column.querySelector(".task-card"));
      if (lane && lane !== board.firstElementChild) board.scrollLeft = lane.getBoundingClientRect().left - board.getBoundingClientRect().left - 16;
    }
    board.addEventListener("wheel", wheel, { passive: false });
    return () => board.removeEventListener("wheel", wheel);
  }, [enabled]);
  return ref;
}
