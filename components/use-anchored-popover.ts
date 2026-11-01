"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** Phones and touch screens get bottom sheets instead of anchored popovers (pickers, menus, the date picker). */
export const SHEET_MEDIA = "(max-width: 760px), (pointer: coarse)";
export function isSheetLayout() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(SHEET_MEDIA).matches;
}
/** Class names of the shared bottom sheet (`app/styles/pickers.css`); the board's card menu uses them too. */
export const SHEET_CLASS = "picker-sheet";

/** Search only pays off on long lists, and focusing it on a phone raises the keyboard over the list. */
export function shouldFocusSearch(optionCount: number) {
  return optionCount > 7 && typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
}

type Options = {
  width?: number;
  maxHeight?: number;
  /**
   * Called when a press lands outside the popover and its trigger (`restoreFocus` false: focus goes where the press
   * went), or on a phone when the scrim around the sheet is tapped (`restoreFocus` true: nothing else took focus). The
   * scrim swallows that tap, so nothing underneath is activated.
   */
  onDismiss?: (restoreFocus: boolean) => void;
};

/**
 * Shows `menu` in the top layer and focuses `focus` (a search field or the list itself). On desktop the popover sits
 * next to `trigger`, flips above it when there is no room below and stays inside the surrounding dialog; on phones and
 * touch screens it is a bottom sheet above the on-screen keyboard.
 */
export function useAnchoredPopover(open: boolean, trigger: RefObject<HTMLElement | null>, menu: RefObject<HTMLDivElement | null>, focus: RefObject<HTMLElement | null>, options?: Options) {
  const preferredWidth = options?.width ?? 280;
  const preferredHeight = options?.maxHeight ?? 330;
  const dismiss = useRef(options?.onDismiss);
  useEffect(() => { dismiss.current = options?.onDismiss; });
  useLayoutEffect(() => {
    const button = trigger.current, popover = menu.current;
    if (!open || !button || !popover) return;
    const sheet = isSheetLayout();
    popover.classList.toggle(SHEET_CLASS, sheet);
    const viewport = window.visualViewport;
    const position = () => {
      if (sheet) {
        // Keep the sheet above the on-screen keyboard (the layout viewport does not shrink for it on every browser).
        const covered = viewport ? Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height) : 0;
        Object.assign(popover.style, {
          bottom: covered ? `calc(var(--space-2) + ${covered}px)` : "",
          maxHeight: covered ? `calc(100dvh - ${covered}px - 56px)` : "",
        });
        return;
      }
      const box = button.getBoundingClientRect();
      // Stay inside the dialog the trigger lives in (the issue view, the composer), else inside the viewport.
      const frame = button.closest("dialog[open]")?.getBoundingClientRect();
      const viewTop = viewport?.offsetTop || 0;
      const top = Math.max(viewTop, frame?.top ?? viewTop) + 8;
      const bottom = Math.min(viewTop + (viewport?.height || window.innerHeight), frame?.bottom ?? Infinity) - 8;
      const minLeft = Math.max(0, frame?.left ?? 0) + 8;
      const maxRight = Math.min(window.innerWidth, frame?.right ?? window.innerWidth) - 8;
      const width = Math.min(preferredWidth, maxRight - minLeft, window.innerWidth - 24);
      Object.assign(popover.style, { width: `${width}px`, maxHeight: `${preferredHeight}px` });
      const natural = Math.min(preferredHeight, popover.scrollHeight + 2);
      const below = bottom - box.bottom - 5;
      const above = box.top - top - 5;
      // Left-aligned with the trigger; right-aligned when that would leave the frame.
      const left = box.left + width <= maxRight ? box.left : box.right - width;
      // Below the trigger, else above it (anchored by its bottom edge so content changes grow away from the trigger),
      // else beside it (a short dialog such as the composer), slid up until it fits the frame; it scrolls only when the
      // frame itself is smaller.
      const upward = natural > below && natural <= above;
      const fitsVertically = natural <= below || upward;
      const side = fitsVertically ? null : box.right + 5 + width <= maxRight ? box.right + 5 : box.left - 5 - width >= minLeft ? box.left - 5 - width : null;
      const y = natural <= below ? box.bottom + 5 : upward ? 0 : Math.max(top, Math.min(side === null ? box.bottom + 5 : box.bottom - natural, bottom - natural));
      Object.assign(popover.style, {
        maxHeight: `${Math.max(80, Math.min(preferredHeight, upward ? above : bottom - y))}px`,
        left: `${side ?? Math.max(minLeft, Math.min(left, maxRight - width))}px`,
        top: upward ? "auto" : `${y}px`,
        bottom: upward ? `${window.innerHeight - box.top + 5}px` : "auto",
      });
    };
    // The sheet's scrim is its own top-layer element (a popover's ::backdrop does not catch presses), shown first so the
    // sheet sits above it. It stays until its click has fired, so the tap that closes the sheet activates nothing else.
    let scrim: HTMLDivElement | null = null;
    if (sheet) {
      scrim = document.createElement("div");
      scrim.className = "picker-sheet-scrim";
      scrim.popover = "manual";
      scrim.setAttribute("aria-hidden", "true");
      scrim.addEventListener("pointerdown", event => event.preventDefault());
      scrim.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); dismiss.current?.(true); });
      popover.before(scrim);
      scrim.showPopover();
    }
    popover.showPopover();
    position();
    focus.current?.focus({ preventScroll: true });
    const onScroll = (event: Event) => { if (!popover.contains(event.target as Node)) position(); };
    // Desktop: a press elsewhere closes the popover and still reaches what was pressed.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sheet && !popover.contains(target) && !button.contains(target)) dismiss.current?.(false);
    };
    window.addEventListener("resize", position);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onPointerDown);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onPointerDown);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      if (popover.matches(":popover-open")) popover.hidePopover();
      scrim?.remove();
    };
  }, [open, trigger, menu, focus, preferredWidth, preferredHeight]);
}
