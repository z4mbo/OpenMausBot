"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useAnchoredPopover } from "./use-anchored-popover";

type Option = { value: string; label: string; icon?: ReactNode };

export function IssueSelect({ label, value, options, onChange, disabled, icon }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean; icon?: ReactNode }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const selected = options.find(option => option.value === value);
  const matches = options.filter(option => option.label.toLowerCase().includes(query.toLowerCase()));
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const choose = (option: Option) => { onChange(option.value); close(); };
  useAnchoredPopover(open, trigger, menu, search);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, id, open]);
  return <div className="issue-select" ref={root} onKeyDown={event => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setActive(index => event.key === "Home" ? 0 : event.key === "End" ? Math.max(0, matches.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length));
    } else if (event.key === "Enter") { event.preventDefault(); if (matches[active]) choose(matches[active]); }
    else if (event.key === "Tab") close();
  }}>
    <button ref={trigger} type="button" className="issue-select-trigger" aria-label={selected ? `${label}: ${selected.label}` : label} title={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled || !options.length} onClick={() => { setOpen(!open); setQuery(""); setActive(Math.max(0, options.findIndex(option => option.value === value))); }} onKeyDown={event => {
      if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setQuery(""); setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true); }
    }}>{selected?.icon || icon}<span>{selected?.label || label}</span><ChevronDown size={12} /></button>
    {open && <div ref={menu} popover="manual" className="issue-select-popover">
      <div className="issue-select-search"><Search size={15} /><input ref={search} aria-label={`Search ${label.toLowerCase()}`} role="combobox" aria-expanded="true" aria-controls={id} aria-activedescendant={matches[active] ? `${id}-${active}` : undefined} placeholder={`Change ${label.toLowerCase()}...`} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} /></div>
      <div role="listbox" id={id} aria-label={label}>{matches.map((option, index) => <button id={`${id}-${index}`} key={option.value} type="button" tabIndex={-1} role="option" aria-selected={option.value === value} data-highlighted={active === index} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>{option.icon || icon}<span>{option.label}</span>{value === option.value && <Check size={15} />}</button>)}{!matches.length && <p>No results</p>}</div>
    </div>}
  </div>;
}
