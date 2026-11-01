"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search, Users, UserRound } from "lucide-react";
import { UserAvatar, memberName, type AvatarIdentity } from "./user-avatar";
import { useAnchoredPopover } from "./use-anchored-popover";

type Person = AvatarIdentity & { email: string };

export function MemberPicker({ members, value, onChange, label, disabled, allLabel, currentEmail, required }: {
  members: Person[]; value: string; onChange: (value: string) => void; label: string;
  disabled?: boolean; allLabel?: string; currentEmail?: string; required?: boolean;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const selected = members.find(member => member.email === value);
  const selectedLabel = selected ? memberName(selected) : value ? value.split("@")[0] : allLabel || label;
  const people = members.filter(member => `${memberName(member)} ${member.name || ""} ${member.email}`.toLowerCase().includes(query.toLowerCase()));
  const options = [...(allLabel && !query ? [{ value: "", label: allLabel, person: undefined as Person | undefined }] : []), ...people.map(person => ({ value: person.email, label: memberName(person), person }))];
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  useAnchoredPopover(open, trigger, menu, search);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, id, open]);
  return <div className="member-picker" ref={root} onKeyDown={event => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    else if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % Math.max(1, options.length)); }
    else if (event.key === "Enter") { event.preventDefault(); const option = options[active]; if (option) { onChange(option.value); close(); } }
    else if (event.key === "Tab") close();
  }}>
    <button ref={trigger} type="button" className="member-picker-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => { setOpen(!open); setQuery(""); setActive(0); }}>
      <span className="sr-only">{label}: </span>
      {selected ? <UserAvatar user={selected} size="small" /> : allLabel && !value ? <Users size={15} /> : <UserRound size={15} />}
      <span>{selectedLabel}</span><ChevronDown size={13} />
    </button>
    {required && <input className="member-picker-validation" aria-hidden="true" tabIndex={-1} required disabled={disabled} value={value} onChange={() => {}} onInvalid={event => { event.preventDefault(); trigger.current?.focus(); setOpen(true); }} />}
    {open && <div ref={menu} popover="manual" className="member-picker-popover">
      <div className="member-picker-search"><Search size={14} /><input ref={search} aria-label={`Search ${label.toLowerCase()}`} placeholder="Search members..." role="combobox" aria-expanded="true" aria-controls={id} aria-activedescendant={options[active] ? `${id}-${active}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} /></div>
      <div role="listbox" id={id} aria-label={label}>{options.map((option, index) => <button id={`${id}-${index}`} key={option.value} type="button" tabIndex={-1} role="option" aria-selected={value === option.value} data-highlighted={active === index} onMouseEnter={() => setActive(index)} onClick={() => { onChange(option.value); close(); }}>
        {option.person ? <UserAvatar user={option.person} size="small" /> : <Users size={18} />}<span>{option.label}</span>{option.value === currentEmail && <small>You</small>}{value === option.value && <Check size={14} />}
      </button>)}{!options.length && <p>No members found</p>}</div>
    </div>}
  </div>;
}
