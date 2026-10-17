/** Layout coordinates exclude in-flight FLIP transforms on sidebar rows. */
export function selectionBox(active: HTMLElement, container: HTMLElement) {
  const point = (node: HTMLElement) => {
    let x = 0, y = 0;
    for (let current: HTMLElement | null = node; current; current = current.offsetParent as HTMLElement | null) { x += current.offsetLeft; y += current.offsetTop; }
    return { x, y };
  };
  const row = point(active), base = point(container);
  let x = row.x - base.x, y = row.y - base.y;
  for (let parent = active.parentElement; parent && parent !== container; parent = parent.parentElement) { x -= parent.scrollLeft; y -= parent.scrollTop; }
  return { x, y, width: active.offsetWidth, height: active.offsetHeight };
}

export function canAnimateTaskExit(parent: HTMLElement) {
  // A removed whole view has a connected outer parent too. Only animate a card
  // removed directly from its still-visible list, never a previous view's cards.
  return parent.isConnected && parent.matches(".task-list, .work-issue-list, .archive-list") && parent.getClientRects().length > 0;
}
