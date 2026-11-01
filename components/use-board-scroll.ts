"use client";
import { useEffect, useRef } from "react";

/**
 * Board scrolling: vertical wheel scrolls lanes sideways on desktop, the board fades at an edge that has more lanes
 * behind it, and phones open on the first lane that has issues.
 */
export function useBoardScroll(enabled: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const board = ref.current?.querySelector<HTMLDivElement>(".kanban-scroll");
    if (!board || !enabled) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || matchMedia("(max-width: 760px)").matches) return;
      const target = event.target instanceof Element ? event.target.closest(".task-list") : null;
      if (target && target.scrollHeight > target.clientHeight && ((event.deltaY > 0 && target.scrollTop + target.clientHeight < target.scrollHeight - 1) || (event.deltaY < 0 && target.scrollTop > 0))) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board.clientWidth : 1);
      const next = Math.max(0, Math.min(board.scrollWidth - board.clientWidth, board.scrollLeft + delta));
      if (next === board.scrollLeft) return;
      event.preventDefault(); board.scrollLeft = next;
    };
    let frame = 0;
    const edges = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const max = board.scrollWidth - board.clientWidth;
        board.toggleAttribute("data-fade-start", board.scrollLeft > 2 && !matchMedia("(max-width: 760px)").matches);
        board.toggleAttribute("data-fade-end", max > 2 && board.scrollLeft < max - 2);
      });
    };
    // On phones one lane fills the screen: start on the first lane that has issues, with the lane before it fully out of view.
    if (matchMedia("(max-width: 760px)").matches && board.scrollLeft === 0) {
      const lane = Array.from(board.querySelectorAll<HTMLElement>(".kanban-column")).find(column => column.querySelector(".task-card"));
      if (lane && lane !== board.firstElementChild) board.scrollLeft = lane.offsetLeft - board.offsetLeft - parseFloat(getComputedStyle(board).paddingLeft || "0");
    }
    const resize = new ResizeObserver(edges);
    resize.observe(board);
    const mutations = new MutationObserver(edges);
    mutations.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    board.addEventListener("wheel", wheel, { passive: false });
    board.addEventListener("scroll", edges, { passive: true });
    edges();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      board.removeEventListener("wheel", wheel);
      board.removeEventListener("scroll", edges);
    };
  }, [enabled]);
  return ref;
}
