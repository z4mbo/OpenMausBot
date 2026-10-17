type KeyEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "isComposing" | "defaultPrevented" | "repeat">;
type Context = { editing: boolean; overlayOpen: boolean };

export function workspaceShortcut(event: KeyEvent, context: Context & { canCreate: boolean }) {
  if (event.defaultPrevented || event.isComposing || event.repeat || context.overlayOpen) return null;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "k") return "search";
  if (event.metaKey || event.ctrlKey || event.altKey || context.editing) return null;
  if (key === "f" || key === "/") return "search";
  if (key === "c" && context.canCreate) return "create-issue";
  return null;
}

export function shouldFocusChatComposer(event: KeyEvent, context: Context & { canWrite: boolean; controlHasFocus: boolean }) {
  if (!context.canWrite || context.editing || context.overlayOpen || event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key === " " && context.controlHasFocus) return false;
  return Array.from(event.key).length === 1 || event.key === "Dead";
}

export function isEditingTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], .excalidraw'));
}

export function hasOpenKeyboardOverlay() {
  return [...document.querySelectorAll<HTMLElement>('dialog[open], [aria-modal="true"], [popover]:popover-open, [role="menu"], [role="listbox"], .origin-dropdown, .profile-menu, .board-filter-popover')]
    .some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
}
