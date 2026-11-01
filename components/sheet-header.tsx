/**
 * Header of a phone bottom sheet (hidden in desktop popovers): the issue title when the sheet was opened from a board
 * card, where the issue is not otherwise on screen, above the caption naming what is picked.
 */
export function SheetHeader({ title, caption }: { title?: string; caption?: string }) {
  return <>
    {title && <div className="picker-sheet-title" aria-hidden="true">{title}</div>}
    {caption && <div className="picker-sheet-caption" aria-hidden="true">{caption}</div>}
  </>;
}
