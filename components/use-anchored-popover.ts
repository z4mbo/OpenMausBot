"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Search only pays off on long lists, and focusing it on a phone raises the keyboard over the list. */
export function shouldFocusSearch(optionCount: number) {
  return optionCount > 7 && typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
}

/** Shows `menu` in the top layer next to `trigger` and focuses `focus` (a search field or the list itself). */
export function useAnchoredPopover(open: boolean, trigger: RefObject<HTMLElement | null>, menu: RefObject<HTMLDivElement | null>, focus: RefObject<HTMLElement | null>, options?: { width?: number; maxHeight?: number }) {
  const preferredWidth = options?.width ?? 280;
  const preferredHeight = options?.maxHeight ?? 330;
  useLayoutEffect(() => {
    const button = trigger.current, popover = menu.current;
    if (!open || !button || !popover) return;
    // The top layer keeps pickers outside the scrolling dialog's clipping area.
    const position = () => {
      const box = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop || 0;
      const bottom = top + (viewport?.height || window.innerHeight);
      const width = Math.min(preferredWidth, window.innerWidth - 24);
      const below = bottom - box.bottom - 12;
      const above = box.top - top - 12;
      const upward = below < 220 && above > below;
      const height = Math.min(preferredHeight, Math.max(80, upward ? above : below));
      Object.assign(popover.style, {
        width: `${width}px`, maxHeight: `${height}px`,
        left: `${Math.max(12, Math.min(box.left, window.innerWidth - width - 12))}px`,
        top: upward ? "auto" : `${box.bottom + 5}px`,
        bottom: upward ? `${window.innerHeight - box.top + 5}px` : "auto",
      });
    };
    position();
    popover.showPopover();
    focus.current?.focus({ preventScroll: true });
    const onScroll = (event: Event) => { if (!popover.contains(event.target as Node)) position(); };
    window.addEventListener("resize", position);
    document.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      if (popover.matches(":popover-open")) popover.hidePopover();
    };
  }, [open, trigger, menu, focus, preferredWidth, preferredHeight]);
}
