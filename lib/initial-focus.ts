const textInputSelector = 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="password"], input[type="url"], input[type="tel"], textarea, [contenteditable="true"]';

export function focusInitialInput(root: HTMLElement) {
  const candidates = [...root.querySelectorAll<HTMLElement>(`[data-initial-focus], ${textInputSelector}`)];
  const available = candidates.filter(element => !element.matches(':disabled, [readonly], [aria-hidden="true"]') && element.getClientRects().length > 0);
  const input = available.find(element => element.hasAttribute("data-initial-focus")) || available[0];
  input?.focus({ preventScroll: true });
  return Boolean(input);
}

/* Input modality: rings show only for keyboard use, including focus that code moves (drawer, dialog close). */
let keyboardInput = false;
if (typeof window !== "undefined") {
  // Set on the first input only, so the server-rendered <html> still matches during hydration.
  const set = (keyboard: boolean) => { keyboardInput = keyboard; document.documentElement.dataset.input = keyboard ? "keyboard" : "pointer"; };
  window.addEventListener("keydown", event => { if (!event.metaKey && !event.ctrlKey && event.key !== "Meta" && event.key !== "Control") set(true); }, true);
  window.addEventListener("pointerdown", () => set(false), true);
}
export const usingKeyboard = () => keyboardInput;

/** Moves focus without scrolling; the focus ring shows only when the person is using the keyboard. */
export function focusQuietly(element: HTMLElement | null | undefined) {
  if (!element) return false;
  element.focus({ preventScroll: true, focusVisible: keyboardInput } as FocusOptions);
  return document.activeElement === element;
}

const tabbableSelector = 'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable="true"]';
/** Elements Tab reaches inside `root`, in document order. */
export function tabbables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(tabbableSelector)].filter(element => {
    if (element.tabIndex < 0 || element.matches(":disabled, [hidden], [inert] *, [inert]") || !element.getClientRects().length) return false;
    if (element.matches('input[type="hidden"]')) return false;
    // Only the checked radio of a group takes a Tab stop.
    const name = element.getAttribute("name");
    if (element.matches('input[type="radio"]:not(:checked)') && name && root.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`)) return false;
    return getComputedStyle(element).visibility !== "hidden";
  });
}

/** Keeps Tab and Shift+Tab inside `root`, wrapping at either end. Returns true when it moved focus. */
export function wrapTab(event: KeyboardEvent, root: HTMLElement) {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return false;
  const items = tabbables(root);
  const first = items[0], last = items.at(-1);
  const active = document.activeElement as HTMLElement | null;
  if (!first || !last) { event.preventDefault(); return true; }
  const outside = !active || active === root || !root.contains(active);
  if (event.shiftKey ? outside || active === first : outside || active === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: false });
    return true;
  }
  return false;
}
