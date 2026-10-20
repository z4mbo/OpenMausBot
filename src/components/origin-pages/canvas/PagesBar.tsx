import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CanvasPage } from "./use-paged-canvas";

const row = "group flex h-7 items-center gap-1 rounded-md pl-2 pr-1 text-[12.5px] outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60";

/** The canvas's pages: pick one, add one, rename one with a double-click, delete one with everything on it. */
export function PagesBar({ pages, current, readOnly, counts, onSelect, onChange, onDelete }: {
  pages: readonly CanvasPage[]; current: string; readOnly: boolean; counts: ReadonlyMap<string, number>;
  onSelect(id: string): void; onChange(pages: CanvasPage[]): void; onDelete(id: string): void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const add = () => {
    let at = pages.length + 1;
    while (pages.some((page) => page.id === `page-${at}`)) at++;
    const page = { id: `page-${at}`, name: `Page ${at}` };
    onChange([...pages, page]);
    onSelect(page.id);
  };
  return (
    <section aria-label="Pages" className="shrink-0 border-b border-hairline/40 px-1.5 pb-1.5">
      <div className="flex h-9 items-center justify-between pl-1.5">
        <span className="text-[11.5px] font-semibold text-ink">Pages</span>
        {!readOnly && pages.length < 50 && (
          <button type="button" aria-label="Add page" title="Add page" onClick={add}
            className="inline-flex size-6 items-center justify-center rounded text-ink-tertiary outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"><Plus size={13} /></button>
        )}
      </div>
      <ul className="flex max-h-40 flex-col overflow-y-auto">
        {pages.map((page) => (
          <li key={page.id}>
            {renaming === page.id ? (
              <input autoFocus defaultValue={page.name} aria-label="Page name" maxLength={60}
                className="h-7 w-full rounded-md border border-accent/70 bg-inset px-2 text-[12.5px] text-ink outline-none"
                onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== page.name) onChange(pages.map((item) => (item.id === page.id ? { ...item, name } : item))); setRenaming(null); }}
                onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(null); }} />
            ) : confirming === page.id ? (
              <div className="flex h-7 items-center gap-1 rounded-md bg-danger/10 pl-2 pr-1 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-ink">Delete {page.name}?</span>
                <button type="button" className="rounded px-1.5 py-0.5 text-danger outline-none hover:bg-danger/15 focus-visible:ring-2 focus-visible:ring-danger/60" onClick={() => { setConfirming(null); onDelete(page.id); }}>Delete</button>
                <button type="button" aria-label="Keep page" className="inline-flex size-6 items-center justify-center rounded text-ink-tertiary outline-none hover:text-ink" onClick={() => setConfirming(null)}><X size={12} /></button>
              </div>
            ) : (
              <div className={cn(row, "pl-0", page.id === current ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink")}>
                <button type="button" aria-current={page.id === current ? "page" : undefined} onClick={() => onSelect(page.id)} onDoubleClick={() => { if (!readOnly) setRenaming(page.id); }}
                  onKeyDown={(event) => { if (event.key === "F2" && !readOnly) setRenaming(page.id); }}
                  className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60">
                  <span className="min-w-0 flex-1 truncate">{page.name}</span>
                  <span aria-hidden="true" className="shrink-0 text-[11px] tabular-nums text-ink-tertiary">{counts.get(page.id) ?? 0}</span>
                </button>
                {!readOnly && pages.length > 1 && (
                  <button type="button" aria-label={`Delete ${page.name}`} onClick={() => setConfirming(page.id)}
                    className="inline-flex size-5 items-center justify-center rounded text-ink-tertiary opacity-0 outline-none hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100"><X size={11} /></button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
