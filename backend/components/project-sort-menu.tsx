"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ListFilter } from "lucide-react";
import { projectSortOptions, type ProjectSort } from "@/lib/project-sort";

export function ProjectSortMenu({ value, onChange }: { value: ProjectSort; onChange: (value: ProjectSort) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus();
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="project-sort" ref={ref} onKeyDown={e => {
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const items = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"));
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      items[e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="icon-create" title="Sort projects" aria-label="Sort projects" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><ListFilter size={14} /></button>
    {open && <div className="project-sort-menu" role="menu" aria-label="Project order"><span>Sort projects</span>{projectSortOptions.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={value === option.value} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}>{option.label}<Check size={14} style={{ visibility: value === option.value ? "visible" : "hidden" }} /></button>)}</div>}
  </div>;
}
