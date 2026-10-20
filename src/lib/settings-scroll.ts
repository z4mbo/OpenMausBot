import type { AppSettingsSection } from "@/state/store";

export function revealSettingsBlock(
  scroller: { scrollTop: number; querySelector: (selector: string) => { scrollIntoView?: (options: ScrollIntoViewOptions) => void } | null },
  section: AppSettingsSection,
  indexInPage: number,
): void {
  if (indexInPage <= 0) {
    scroller.scrollTop = 0;
    return;
  }
  scroller.querySelector(`[data-settings-block="${section}"]`)?.scrollIntoView?.({ block: "start" });
}
