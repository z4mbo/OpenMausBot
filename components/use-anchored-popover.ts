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
 * under `trigger`, flips above it when there is no room below and stays inside the surrounding dialog while it fits; on phones and
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
      const viewTop = viewport?.offsetTop || 0;
      const viewBottom = viewTop + (viewport?.height || window.innerHeight);
      // Stay inside the dialog the trigger lives in (the issue view, the composer) when there is room; the popover is
      // in the top layer, so in a short dialog it leaves the frame and uses the viewport. Always below or above the
      // trigger, never beside it.
      const frame = button.closest("dialog[open]")?.getBoundingClientRect();
      const bounds = (inFrame: boolean) => ({
        top: Math.max(viewTop, inFrame ? frame?.top ?? viewTop : viewTop) + 8,
        bottom: Math.min(viewBottom, inFrame ? frame?.bottom ?? Infinity : Infinity) - 8,
        left: Math.max(0, inFrame ? frame?.left ?? 0 : 0) + 8,
        right: Math.min(window.innerWidth, inFrame ? frame?.right ?? window.innerWidth : window.innerWidth) - 8,
      });
      const measure = (inFrame: boolean) => {
        const area = bounds(inFrame);
        return { area, width: Math.min(preferredWidth, area.right - area.left, window.innerWidth - 24), below: area.bottom - box.bottom - 5, above: box.top - area.top - 5 };
      };
      const framed = measure(true);
      Object.assign(popover.style, { width: `${framed.width}px`, maxHeight: `${preferredHeight}px` });
      const natural = Math.min(preferredHeight, popover.scrollHeight + 2);
      const { area, width, below, above } = frame && natural > framed.below && natural > framed.above ? measure(false) : framed;
      // Below the trigger, else above it (anchored by its bottom edge so content changes grow away from the trigger),
      // else on the roomier side, scrolling inside.
      const upward = natural > below && (natural <= above || above > below);
      // Left-aligned with the trigger; right-aligned when that would leave the area.
      const left = box.left + width <= area.right ? box.left : box.right - width;
      Object.assign(popover.style, {
        width: `${width}px`,
        maxHeight: `${Math.max(80, Math.min(preferredHeight, upward ? above : below))}px`,
        left: `${Math.max(area.left, Math.min(left, area.right - width))}px`,
        top: upward ? "auto" : `${box.bottom + 5}px`,
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
