/**
 * A press outside an open menu or popover only closes it: the click that finishes that same press is swallowed, so a
 * tap never also activates whatever sits underneath. Call from the menu's outside `pointerdown` handler.
 */
export function swallowPressClick() {
  if (typeof window === "undefined") return;
  const block = (event: MouseEvent) => { remove(); event.preventDefault(); event.stopPropagation(); };
  // A later press starts a fresh interaction; the click of this one may never come (scroll, drag), so give up then.
  const next = () => window.setTimeout(remove, 0);
  const remove = () => {
    window.clearTimeout(timer);
    window.removeEventListener("click", block, { capture: true });
    window.removeEventListener("pointerdown", next, { capture: true });
    window.removeEventListener("pointercancel", remove, { capture: true });
  };
  const timer = window.setTimeout(remove, 1500);
  window.addEventListener("click", block, { capture: true });
  window.addEventListener("pointercancel", remove, { capture: true });
  // Registered after the current pointerdown has finished dispatching.
  window.setTimeout(() => window.addEventListener("pointerdown", next, { capture: true }), 0);
}
