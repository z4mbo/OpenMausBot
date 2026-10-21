import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { FolderInput, FolderOutput, Search, Send, Type } from "lucide-react";
import { cn } from "@/lib/cn";
import { KIND_ICON } from "./studio-ui";
import { searchPalette, type PaletteEntry } from "./workflow-edit";
import { studioModel } from "../../../shared/studio";

function EntryIcon({ entry }: { entry: PaletteEntry }) {
  const size = 14;
  if (entry.type === "prompt") return <Type size={size} />;
  if (entry.type === "asset") return <FolderInput size={size} />;
  if (entry.type === "output") return entry.params.broadcast ? <Send size={size} /> : <FolderOutput size={size} />;
  const Icon = KIND_ICON[studioModel(String(entry.params.model))?.kind ?? "image"];
  return <Icon size={size} />;
}

/** The searchable list of nodes: type to filter, arrows to move, Enter to add. */
export function WorkflowPalette({ onPick, onClose, className, style }: { onPick(entry: PaletteEntry): void; onClose(): void; className?: string; style?: CSSProperties }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchPalette(query), [query]);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-palette-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.min(Math.max(current + (event.key === "ArrowDown" ? 1 : -1), 0), Math.max(results.length - 1, 0)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = results[active];
      if (entry) onPick(entry);
    }
    event.stopPropagation();
  };

  let lastGroup = "";
  return (
    <div ref={panel} role="dialog" aria-label="Add a node" onKeyDown={onKey} onPointerDown={(event) => event.stopPropagation()} style={style}
      className={cn("ui-panel absolute z-30 flex w-80 max-w-[calc(100vw-32px)] flex-col overflow-hidden motion-safe:animate-pop-in", className)}>
      <label className="flex items-center gap-2 border-b border-hairline/40 px-3">
        <Search size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} placeholder="Search nodes and models" aria-label="Search nodes"
          role="combobox" aria-expanded="true" aria-controls="workflow-palette-list" aria-activedescendant={results[active] ? `palette-${results[active]!.id}` : undefined}
          className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
      </label>
      <div ref={list} id="workflow-palette-list" role="listbox" aria-label="Nodes" className="max-h-[min(52vh,360px)] overflow-y-auto p-1">
        {results.map((entry, index) => {
          const heading = entry.group !== lastGroup ? entry.group : null;
          lastGroup = entry.group;
          return (
            <div key={entry.id}>
              {heading && !query && <p className="px-2 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">{heading}</p>}
              <button type="button" role="option" id={`palette-${entry.id}`} aria-selected={index === active} data-palette-index={index}
                onPointerMove={() => setActive(index)} onClick={() => onPick(entry)}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none", index === active && "bg-raised")}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-inset text-ink-secondary"><EntryIcon entry={entry} /></span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] text-ink">{entry.label}</span>
                  <span className="truncate text-[11.5px] text-ink-tertiary">{entry.hint}</span>
                </span>
              </button>
            </div>
          );
        })}
        {!results.length && <p className="px-2 py-6 text-center text-[12.5px] text-ink-tertiary">Nothing matches “{query}”</p>}
      </div>
    </div>
  );
}
