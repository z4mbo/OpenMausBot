export const SIDEBAR_DEFAULT_WIDTH = 244;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_COLLAPSE_WIDTH = 180;

export function sidebarDragResult(startWidth: number, delta: number) {
  const proposed = startWidth + delta;
  return { width: Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, proposed)), collapsed: proposed < SIDEBAR_COLLAPSE_WIDTH };
}

export function parseSidebarLayout(value: string | null) {
  try {
    const data = JSON.parse(value || "null");
    if (data && typeof data.width === "number" && Number.isFinite(data.width) && typeof data.collapsed === "boolean") {
      return { width: sidebarDragResult(data.width, 0).width, collapsed: data.collapsed };
    }
  } catch { /* Ignore unavailable or outdated preferences. */ }
  return { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false };
}
