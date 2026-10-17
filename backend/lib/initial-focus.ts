const textInputSelector = 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="password"], input[type="url"], input[type="tel"], textarea, [contenteditable="true"]';

export function focusInitialInput(root: HTMLElement) {
  const candidates = [...root.querySelectorAll<HTMLElement>(`[data-initial-focus], ${textInputSelector}`)];
  const available = candidates.filter(element => !element.matches(':disabled, [readonly], [aria-hidden="true"]') && element.getClientRects().length > 0);
  const input = available.find(element => element.hasAttribute("data-initial-focus")) || available[0];
  input?.focus({ preventScroll: true });
  return Boolean(input);
}
