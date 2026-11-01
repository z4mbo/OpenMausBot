"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { shouldFocusSearch, useAnchoredPopover } from "./use-anchored-popover";

type Option = { value: string; label: string; icon?: ReactNode; detail?: string };

/** Lists longer than this get a search field. */
const SEARCH_THRESHOLD = 7;

export function IssueSelect({ label, value, options, onChange, disabled, icon, placeholder }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean; icon?: ReactNode; placeholder?: string }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const searchable = options.length > SEARCH_THRESHOLD;
  const [focusSearch, setFocusSearch] = useState(false);
  const selected = options.find(option => option.value === value);
  const matches = options.filter(option => option.label.toLowerCase().includes(query.toLowerCase()));
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const choose = (option: Option) => { if (option.value !== value) onChange(option.value); close(); };
  const show = () => { setQuery(""); setActive(Math.max(0, options.findIndex(option => option.value === value))); setFocusSearch(searchable && shouldFocusSearch(options.length)); setOpen(true); };
  useAnchoredPopover(open, trigger, menu, focusSearch ? search : list, { width: 240 });
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
    } else if (event.key === "Enter" || (event.key === " " && event.target !== search.current)) { event.preventDefault(); if (matches[active]) choose(matches[active]); }
    else if (event.key === "Tab") close();
  }}>
    <button ref={trigger} type="button" className="issue-select-trigger" data-empty={!selected || undefined} aria-label={selected ? `${label}: ${selected.label}` : label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled || !options.length} onClick={() => { if (open) close(false); else show(); }} onKeyDown={event => {
      if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); show(); }
    }}>{selected?.icon || icon}<span>{selected?.label || placeholder || label}</span><ChevronDown size={12} /></button>
    {open && <div ref={menu} popover="manual" className="issue-select-popover">
      {searchable && <div className="issue-select-search"><Search size={14} /><input ref={search} aria-label={`Search ${label.toLowerCase()}`} role="combobox" aria-expanded="true" aria-controls={id} aria-activedescendant={matches[active] ? `${id}-${active}` : undefined} placeholder="Search..." value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} /></div>}
      <div ref={list} tabIndex={-1} role="listbox" id={id} aria-label={label} aria-activedescendant={matches[active] ? `${id}-${active}` : undefined}>{matches.map((option, index) => <button id={`${id}-${index}`} key={option.value} type="button" tabIndex={-1} role="option" aria-selected={option.value === value} data-highlighted={active === index} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>{option.icon || icon}<span>{option.label}</span>{option.detail && <small>{option.detail}</small>}{value === option.value && <Check size={14} />}</button>)}{!matches.length && <p>No results</p>}</div>
    </div>}
  </div>;
}
