"use client";
import { useDeferredValue, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { useQuery } from "convex/react";
import { Check, CheckCircle2, Circle, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { taskKey } from "@/lib/project-issues";
import { useWorkspace } from "./workspace-context";
import { ContentSkeleton } from "./content-skeleton";
import { SheetHeader } from "./sheet-header";
import { shouldFocusSearch, useAnchoredPopover } from "./use-anchored-popover";

export type RelationKind = "blocks" | "blocked" | "parent" | "child";
const KINDS: { value: RelationKind; label: string }[] = [
  { value: "blocks", label: "Blocks" },
  { value: "blocked", label: "Blocked by" },
  { value: "parent", label: "Sub-issue" },
  { value: "child", label: "Parent" },
];

/**
 * The Link issue picker: the relationship, then any issue in the workspace. An anchored popover on desktop, the shared
 * bottom sheet on phones. Rows read like the other issue pickers (state, title, key and the project when it is
 * another one); issues already linked carry a check. `onClose(true)` hands focus back to the trigger.
 */
export function LinkIssuePicker({ sessionToken, anchor, projectId, exclude, linked, kind, onKind, onSelect, onClose }: {
  sessionToken: string; anchor: RefObject<HTMLElement | null>; projectId: Id<"projects">; exclude: Id<"tasks">; linked: string[];
  kind: RelationKind; onKind: (kind: RelationKind) => void; onSelect: (taskId: Id<"tasks">) => void; onClose: (restoreFocus: boolean) => void;
}) {
  const id = useId();
  const workspace = useWorkspace();
  const menu = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), kinds = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const text = useDeferredValue(query);
  const found = useQuery(api.workspaceSearch.issues, { sessionToken, teamId: workspace._id, text });
  // This project's issues first until the search ranks them.
  const rows = found?.filter(row => row._id !== exclude).sort((a, b) => text.trim() ? 0 : Number(b.projectId === projectId) - Number(a.projectId === projectId));
  const projects = useQuery(api.projects.listForUser, { sessionToken, teamId: workspace._id });
  const projectName = new Map<string, string>(projects?.map(project => [project._id, project.name]) ?? []);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useAnchoredPopover(true, anchor, menu, list, { width: 360, maxHeight: 420, onDismiss: restore => closeRef.current(restore) });
  // Search pays off only on a long list and with a keyboard at hand; on phones the keyboard would cover the list.
  const decided = useRef(false);
  useEffect(() => {
    if (rows === undefined || decided.current) return;
    decided.current = true;
    if (shouldFocusSearch(rows.length) && menu.current?.contains(document.activeElement)) search.current?.focus({ preventScroll: true });
  }, [rows]);
  useEffect(() => { document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, id]);

  const choose = (taskId: Id<"tasks">) => { if (linked.includes(taskId)) onClose(true); else onSelect(taskId); };
  const count = rows?.length ?? 0;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const inSearch = event.target === search.current;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(true); }
    else if (event.key === "Tab") {
      // Two stops inside: the relationship and the search field.
      event.preventDefault();
      const stops = [kinds.current?.querySelector<HTMLElement>('[aria-checked="true"]'), search.current].filter(Boolean) as HTMLElement[];
      const index = stops.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? (event.shiftKey ? stops.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      stops[next]?.focus({ preventScroll: true });
    }
    else if (kinds.current?.contains(event.target as Node)) {
      const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key as "ArrowLeft"];
      if (step === undefined) return;
      event.preventDefault();
      const next = KINDS[(KINDS.findIndex(item => item.value === kind) + step + KINDS.length) % KINDS.length];
      onKind(next.value);
      requestAnimationFrame(() => kinds.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true }));
    }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + count) % Math.max(1, count)); }
    else if (!inSearch && (event.key === "Home" || event.key === "End")) { event.preventDefault(); setActive(event.key === "Home" ? 0 : Math.max(0, count - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); const row = rows?.[active]; if (row) choose(row._id); }
    // Typing anywhere in the picker searches.
    else if (!inSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") search.current?.focus({ preventScroll: true });
  };

  return <div ref={menu} popover="manual" role="dialog" aria-label="Link issue" className="issue-select-popover link-issue-popover" onKeyDown={onKeyDown}>
    <SheetHeader caption="Link issue" />
    <div ref={kinds} role="radiogroup" aria-label="Relationship" className="segmented-control link-issue-kinds">
      {KINDS.map(item => <button key={item.value} type="button" role="radio" aria-checked={item.value === kind} tabIndex={item.value === kind ? 0 : -1} onClick={() => onKind(item.value)}>{item.label}</button>)}
    </div>
    <div className="issue-select-search"><Search size={14} /><input ref={search} aria-label="Find issues" placeholder="Search issues..." role="combobox" aria-expanded="true" aria-controls={id} aria-activedescendant={rows?.[active] ? `${id}-${active}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} /></div>
    <div ref={list} tabIndex={-1} role="listbox" id={id} aria-label="Issues" aria-activedescendant={rows?.[active] ? `${id}-${active}` : undefined}>
      {rows === undefined ? <ContentSkeleton rows={3} /> : rows.map((row, index) => {
        const project = row.projectId !== projectId ? projectName.get(row.projectId) : undefined;
        const isLinked = linked.includes(row._id);
        return <button id={`${id}-${index}`} key={row._id} type="button" tabIndex={-1} role="option" aria-selected={isLinked} data-highlighted={active === index} onMouseEnter={() => setActive(index)} onClick={() => choose(row._id)}>
          {row.done ? <CheckCircle2 size={14} className="done" /> : <Circle size={14} />}<span>{row.title}</span><small>{project ? `${project} · ${taskKey(row._id)}` : taskKey(row._id)}</small>{isLinked && <Check size={14} />}
        </button>;
      })}
      {rows?.length === 0 && <p>No matching issues</p>}
    </div>
  </div>;
}
