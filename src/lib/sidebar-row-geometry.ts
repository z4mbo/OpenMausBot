import type { SidebarDensity } from "./sidebar-preferences";

/** The leading column every sidebar row shares, so nav icons line up with bot avatars and their labels with bot names. */
export interface SidebarRowLead {
  /** Width of the avatar or icon column, in pixels. */
  size: number;
  /** Left padding and the gap before the label, as Tailwind classes. */
  padding: string;
  gap: string;
}

export function sidebarRowLead(density: SidebarDensity, showThreads: boolean): SidebarRowLead {
  if (density === "icons") return { size: 44, padding: "px-1", gap: "" };
  if (density === "compact") return showThreads ? { size: 26, padding: "pl-6", gap: "gap-1.5" } : { size: 36, padding: "pl-2", gap: "gap-2.5" };
  return showThreads ? { size: 32, padding: "pl-6", gap: "gap-2" } : { size: 44, padding: "pl-2.5", gap: "gap-3" };
}
