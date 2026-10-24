import { useLayoutEffect, useState, type RefObject } from "react";

const GAP = 16;
const FLOOR = 160;

export function spaceAbove(cardTop: number, ceiling: number, cap: number): number {
  return Math.max(FLOOR, Math.min(cap, Math.floor(cardTop - ceiling - GAP)));
}

export function useSpaceAbove(open: boolean, anchor: RefObject<HTMLElement | null>, cap: number): number {
  const [space, setSpace] = useState(cap);
  useLayoutEffect(() => {
    const element = anchor.current;
    if (!open || !element) return;
    const card = element.closest<HTMLElement>("[data-composer-card]") ?? element;
    const header = element.closest<HTMLElement>("[data-glass-frame]")?.querySelector<HTMLElement>(':scope > [data-glass-bar="top"]') ?? null;
    const update = () => setSpace(spaceAbove(card.getBoundingClientRect().top, header?.getBoundingClientRect().bottom ?? 0, cap));
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(card);
    if (header) observer?.observe(header);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open, anchor, cap]);
  return space;
}
