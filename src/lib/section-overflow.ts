export interface SectionStripMeasure {
  /** Width of each tab, in strip order. */
  tabs: readonly number[];
  /** Width of the More trigger when it shows only its own label. */
  more: number;
  /** What the More trigger adds beside a hidden current tab's own width (its chevron). */
  moreChevron: number;
  gap: number;
  available: number;
  /** Index of the current tab, or -1 when no tab is current. */
  current: number;
}

/** How many leading tabs fit beside a More trigger that holds the rest. */
export function sectionsThatFit({ tabs, more, moreChevron, gap, available, current }: SectionStripMeasure): number {
  const row = (count: number) => tabs.slice(0, count).reduce((sum, width) => sum + width, 0) + gap * Math.max(0, count - 1);
  if (row(tabs.length) <= available) return tabs.length;
  for (let count = tabs.length - 1; count > 0; count--) {
    const trigger = current >= count ? tabs[current]! + moreChevron : more;
    if (row(count) + gap + trigger <= available) return count;
  }
  return 0;
}
