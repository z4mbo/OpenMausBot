import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpDown, Check, ChevronRight, ChevronsUpDown, Plus, UserPlus } from "lucide-react";
import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import {
  movedOrder, setProjectOrder, setProjectSort, setProjectsCollapsed, sortProjects, switchWorkspace, useWorkspaces, type ProjectSort,
} from "@/lib/origin-workspaces";

const SORTS: { id: ProjectSort; label: string }[] = [
  { id: "custom", label: "Custom order" },
  { id: "recent", label: "Recently updated" },
  { id: "name", label: "Name A to Z" },
];

export function lastUpdate(bot: Bot): number {
  return Math.max(0, ...(bot.tasks ?? []).map((task) => task.updatedAt ?? task.createdAt ?? 0));
}

function Menu({ label, icon, children, className }: { label: string; icon: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return (
    <div ref={root} className={cn("relative", className)}>
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}
        className="flex size-6 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink">{icon}</button>
      {open && <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-hairline/60 bg-menu p-1.5 shadow-2xl shadow-black/60"
        onClick={() => setOpen(false)}>
        {children}
      </div>}
    </div>
  );
}

const menuItem = "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-raised";

export function WorkspaceSwitcher({ heads, activeId, onNewWorkspace }: { heads: readonly Bot[]; activeId?: string; onNewWorkspace(): void }) {
  return (
    <Menu label="Switch workspace" icon={<ChevronsUpDown size={14} />} className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2">
      <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">Workspaces</div>
      {heads.map((head) => (
        <button key={head.id} type="button" role="menuitemradio" aria-checked={head.id === activeId} onClick={() => switchWorkspace(head.id)} className={menuItem}>
          <span className="min-w-0 flex-1 truncate">{head.name}</span>{head.id === activeId && <Check size={13} className="text-accent" />}
        </button>
      ))}
      <div className="my-1 h-px bg-hairline/50" />
      <button type="button" role="menuitem" onClick={onNewWorkspace} className={menuItem}><Plus size={13} />New workspace</button>
      <button type="button" role="menuitem" disabled title="Coming soon" className={cn(menuItem, "cursor-not-allowed opacity-50")}><UserPlus size={13} />Invite members</button>
    </Menu>
  );
}

export function SidebarProjects({ projects, row, onNewProject }: { projects: readonly Bot[]; row(bot: Bot): ReactNode; onNewProject(): void }) {
  const workspaces = useWorkspaces();
  const ordered = sortProjects(projects.map((bot) => ({ id: bot.id, name: bot.name, updatedAt: lastUpdate(bot), bot })), workspaces);
  const dragging = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; place: "before" | "after" } | null>(null);
  const open = !workspaces.collapsed;
  const place = (event: React.DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" as const : "after" as const;
  };
  return (
    <div data-sidebar-projects className="flex flex-col gap-0.5 pt-2">
      <div className="flex items-center gap-1 px-2 pb-1">
        <button type="button" aria-expanded={open} onClick={() => setProjectsCollapsed(open)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded text-[12px] font-medium text-ink-secondary hover:text-ink">
          <ChevronRight size={12} className={cn("shrink-0 transition-transform", open && "rotate-90")} aria-hidden="true" />Projects
        </button>
        <Menu label="Sort projects" icon={<ArrowUpDown size={13} />}>
          {SORTS.map((sort) => (
            <button key={sort.id} type="button" role="menuitemradio" aria-checked={workspaces.sort === sort.id} onClick={() => setProjectSort(sort.id)} className={menuItem}>
              <span className="flex-1">{sort.label}</span>{workspaces.sort === sort.id && <Check size={13} className="text-accent" />}
            </button>
          ))}
        </Menu>
        <button type="button" aria-label="New project" title="New project" onClick={onNewProject}
          className="flex size-6 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink"><Plus size={14} /></button>
      </div>
      {open && ordered.map(({ id, bot }) => (
        <div key={id} data-sidebar-project-row={id} draggable={workspaces.sort === "custom"}
          onDragStart={(event) => { dragging.current = id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-origin-project", id); }}
          onDragOver={(event) => { if (!dragging.current || dragging.current === id) return; event.preventDefault(); setDrop({ id, place: place(event) }); }}
          onDragLeave={() => setDrop(null)}
          onDrop={(event) => {
            event.preventDefault();
            const from = dragging.current;
            if (from && from !== id) setProjectOrder(movedOrder(ordered.map((item) => item.id), from, id, place(event)));
            dragging.current = null; setDrop(null);
          }}
          onDragEnd={() => { dragging.current = null; setDrop(null); }}
          className={cn(drop?.id === id && (drop.place === "before" ? "shadow-[0_-2px_var(--color-accent)]" : "shadow-[0_2px_var(--color-accent)]"))}>
          {row(bot)}
        </div>
      ))}
    </div>
  );
}
