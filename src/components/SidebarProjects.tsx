import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Archive, ArrowUpDown, Check, ChevronRight, ChevronsUpDown, GripVertical, Pin, Plus, Trash2, UserPlus, X } from "lucide-react";
import { RuntimeHelp, WorkspaceMembersPanel } from "./origin-members";
import { useCloudLinks } from "@/lib/origin-cloud-links";
import { useWorkspaceAccess } from "@/lib/origin-members";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import type { Bot } from "@/state/store";
import { UnreadBadge } from "./UnreadBadge";
import { cn } from "@/lib/cn";
import { useOriginProjectOrder } from "@/lib/origin-project-order";
import { useCardDrag, type DropTarget } from "./origin-pages/use-card-drag";
import { useFlip } from "./origin-pages/issue-order";
import { DropGap } from "./origin-pages/DropGap";
import {
  movedOrder, orderedGroups, setGroupOrder, setProjectSort, setProjectsCollapsed, sortProjects, switchWorkspace, toggleGroup, useWorkspaces, type ProjectSort,
} from "@/lib/origin-workspaces";
import { createPortal } from "react-dom";
import { STANDALONE_SECTION, isWorkspaceSection } from "../../shared/origin-workspaces";
import { NewBotDialog } from "./lazy-screens";
import { CenteredDialog } from "./CenteredDialog";
import { iconButton } from "./origin-pages/ui";

const SORTS: { id: ProjectSort; label: string }[] = [
  { id: "custom", label: "Custom order" },
  { id: "recent", label: "Recently updated" },
  { id: "name", label: "Name A to Z" },
];

export function lastUpdate(bot: Bot): number {
  return Math.max(0, ...(bot.tasks ?? []).map((task) => task.updatedAt ?? task.createdAt ?? 0));
}

function Menu({ label, icon, children, className, floating = false }: { label: string; icon: ReactNode; children: ReactNode; className?: string; floating?: boolean }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = useCallback(() => { setOpen(false); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, dismiss]);
  const toggle = () => {
    if (floating && !open && root.current) {
      const rect = root.current.getBoundingClientRect();
      setAt({ left: Math.min(rect.right + 8, window.innerWidth - 216), top: Math.max(8, Math.min(rect.top, window.innerHeight - 220)) });
    }
    setOpen((value) => !value);
  };
  const items = <div ref={panel} role="menu" onClick={dismiss}
    className={cn("z-50 w-52 rounded-xl border border-hairline/60 bg-menu p-1.5 shadow-2xl shadow-black/60", floating ? "fixed" : "absolute right-0 top-full mt-1")}
    style={floating && at ? { left: at.left, top: at.top } : undefined}>{children}</div>;
  return (
    <div ref={root} className={cn("relative", className)}>
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="flex size-6 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink">{icon}</button>
      {open && (floating ? createPortal(items, document.body) : items)}
    </div>
  );
}

const menuItem = "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-raised";

export function WorkspaceSwitcher({ heads, activeId, onNewWorkspace, compact = false }: { heads: readonly Bot[]; activeId?: string; onNewWorkspace(): void; compact?: boolean }) {
  const [panel, setPanel] = useState<"members" | "delete" | null>(null);
  const cloudLinks = useCloudLinks();
  const activeHead = heads.find((head) => head.id === activeId);
  const activeTeamId = (activeId && cloudLinks.workspaces[activeId]) || null;
  const access = useWorkspaceAccess(activeTeamId);
  const canDelete = Boolean(activeHead) && (!activeTeamId || access?.role === "owner" || access?.role === "admin");
  return (
    <>
    <Menu label="Switch workspace" icon={<ChevronsUpDown size={compact ? 12 : 14} />} floating={compact}
      className={compact ? "absolute -bottom-1 right-1 z-10 rounded-full bg-panel" : "absolute right-1.5 top-1/2 z-10 -translate-y-1/2"}>
      <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">Workspaces</div>
      {heads.map((head) => (
        <button key={head.id} type="button" role="menuitemradio" aria-checked={head.id === activeId} onClick={() => switchWorkspace(head.id)} className={menuItem}>
          <span className="min-w-0 flex-1 truncate">{head.name}</span>{head.id === activeId && <Check size={13} className="text-accent" />}
        </button>
      ))}
      <div className="my-1 h-px bg-hairline/50" />
      <button type="button" role="menuitem" onClick={onNewWorkspace} className={menuItem}><Plus size={13} />New workspace</button>
      <button type="button" role="menuitem" onClick={() => setPanel("members")} className={menuItem}><UserPlus size={13} />Members & invites…</button>
      {canDelete && <button type="button" role="menuitem" onClick={() => setPanel("delete")} className={cn(menuItem, "text-danger hover:text-danger")}><Trash2 size={13} />Delete workspace…</button>}
    </Menu>
    {panel === "members" && <MembersDialog cloudTeamId={activeTeamId} onClose={() => setPanel(null)} />}
    {panel === "delete" && activeHead && <DeleteWorkspaceDialog head={activeHead} cloudTeamId={activeTeamId}
      nextHeadId={heads.find((head) => head.id !== activeHead.id)?.id} onClose={() => setPanel(null)} />}
    </>
  );
}

type ProjectLane = "pinned" | "live" | "archived";

/** Where a project row dropped at height y lands: before the first other row of its own section whose middle is below y. */
export function projectDropTarget(root: HTMLElement, id: string, _x: number, y: number): DropTarget | null {
  const lane = [...root.querySelectorAll<HTMLElement>("[data-project-lane]")]
    .find((element) => [...element.querySelectorAll<HTMLElement>("[data-sidebar-project-row]")].some((row) => row.dataset.sidebarProjectRow === id));
  if (!lane) return null;
  const before = [...lane.querySelectorAll<HTMLElement>("[data-sidebar-project-row]")]
    .filter((row) => row.dataset.sidebarProjectRow !== id)
    .find((row) => { const rect = row.getBoundingClientRect(); return rect.height > 0 && rect.top + rect.height / 2 > y; });
  return { columnId: lane.dataset.projectLane!, ...(before ? { beforeTaskId: before.dataset.sidebarProjectRow } : {}) };
}

/** The row `id` is moved next to so it lands before `beforeId` (or last), or null when it would not move. */
export function reorderAnchor(ids: readonly string[], id: string, beforeId?: string): string | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const rest = ids.filter((other) => other !== id);
  const at = beforeId ? rest.indexOf(beforeId) : rest.length;
  if (at < 0 || at === from) return null;
  return at > from ? rest[at - 1]! : rest[at]!;
}

export function SidebarProjects({ projects, row, onNewProject, archived, selectedId, cloudTeamId = null }: {
  projects: readonly Bot[];
  row(bot: Bot): ReactNode;
  /** Absent when the signed-in person may not create projects here. */
  onNewProject?: () => void;
  /** Projects that are inactive in Origin: listed under a folded "Archived" group. */
  archived?: (bot: Bot) => boolean;
  selectedId?: string | null;
  cloudTeamId?: string | null;
}) {
  const workspaces = useWorkspaces();
  const links = useCloudLinks();
  const order = useOriginProjectOrder(projects.map(bot => ({ id: bot.id, name: bot.name, updatedAt: lastUpdate(bot), bot })), links.projects, workspaces, cloudTeamId);
  const { ordered } = order;
  const open = !workspaces.collapsed;
  const shelved = archived ? ordered.filter(({ bot }) => archived(bot)) : [];
  const pinned = ordered.filter((item) => item.bot.pinned && !shelved.includes(item));
  const live = ordered.filter((item) => !item.bot.pinned && !shelved.includes(item));
  const lanes: Record<ProjectLane, typeof ordered> = { pinned, live, archived: shelved };
  const holdsSelection = shelved.some(({ id }) => id === selectedId);
  const [shelfOpen, setShelfOpen] = useState(holdsSelection);
  useEffect(() => { if (holdsSelection) setShelfOpen(true); }, [holdsSelection]);
  const listRef = useRef<HTMLDivElement>(null);
  const seed = useRef<(id: string, from: DOMRect) => void>(() => {});
  const drag = useCardDrag({
    enabled: workspaces.sort === "custom" && !order.saving, root: listRef, targetAt: projectDropTarget, ignore: "input, textarea, select, [contenteditable=true]",
    onDrop: (id, target, from) => {
      const to = reorderAnchor((lanes[target.columnId as ProjectLane] ?? []).map((item) => item.id), id, target.beforeTaskId);
      if (!to) return;
      seed.current(id, from);
      void order.move(id, to);
    },
  });
  const lifted = drag.drag;
  const target = drag.target;
  seed.current = useFlip(listRef, `${ordered.map((item) => item.id).join()}:${target?.columnId ?? ""}:${target?.beforeTaskId ?? ""}`);
  const ghost = lifted && ordered.find((item) => item.id === lifted.taskId);
  const laneRows = (lane: ProjectLane) => <>
    {lanes[lane].map(({ id, bot }) => projectRow(id, bot, lane))}
    {lifted && target?.columnId === lane && !target.beforeTaskId && <DropGap height={lifted.height} />}
  </>;
  return (
    <div ref={listRef} data-sidebar-projects onClickCapture={(event) => { if (drag.justDropped()) { event.preventDefault(); event.stopPropagation(); } }}
      className="flex flex-col gap-0.5 pt-2">
      {pinned.length > 0 && (
        <div data-sidebar-pinned-projects data-project-lane="pinned" className="mb-2 flex flex-col gap-0.5">
          <div className="flex h-6 items-center gap-1.5 px-2 pb-1 text-[12px] font-medium text-ink-secondary">
            <Pin size={11} className="shrink-0" aria-hidden="true" />Pinned
          </div>
          {laneRows("pinned")}
        </div>
      )}
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
        {onNewProject && <button type="button" aria-label="New project" title="New project" onClick={onNewProject}
          className="flex size-6 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink"><Plus size={14} /></button>}
      </div>
      {open && <div data-project-lane="live" className="flex flex-col gap-0.5">{laneRows("live")}</div>}
      {open && shelved.length > 0 && (
        <div data-sidebar-archived-projects className="mt-1 flex flex-col gap-0.5">
          <button type="button" aria-expanded={shelfOpen} onClick={() => setShelfOpen((value) => !value)}
            className="group/shelf flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-tertiary transition-colors hover:bg-raised/50 hover:text-ink-secondary">
            <ChevronRight size={12} className={cn("shrink-0 transition-transform duration-(--motion-slow)", shelfOpen && "rotate-90")} aria-hidden="true" />
            <Archive size={12} className="shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left">Archived</span>
            <span className="rounded-full bg-raised/70 px-1.5 text-[10.5px] tabular-nums leading-4 text-ink-tertiary">{shelved.length}</span>
          </button>
          {shelfOpen && <div data-project-lane="archived" className="flex origin-top animate-pop-in flex-col gap-0.5 opacity-75 transition-opacity hover:opacity-100 focus-within:opacity-100">
            {laneRows("archived")}
          </div>}
        </div>
      )}
      {order.error && <p role="alert" className="break-words px-2 py-1 text-[12px] text-danger">{order.error}</p>}
      {order.saving && <span role="status" className="sr-only">Saving workspace project order…</span>}
      {ghost && lifted && createPortal(
        <div ref={drag.ghost} aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[60]"
          style={{ width: lifted.width, transform: `translate3d(${lifted.x}px, ${lifted.y}px, 0)` }}>
          <div className="rotate-[1.5deg] scale-[1.03] rounded-xl bg-raised shadow-2xl shadow-black/40 motion-safe:animate-[pop-in_var(--motion-base)_var(--ease-out)]">{row(ghost.bot)}</div>
        </div>,
        document.body,
      )}
    </div>
  );

  function projectRow(id: string, bot: Bot, lane: ProjectLane) {
    const locked = order.disabledFor(id);
    return (
      <div key={id} className={cn("flex flex-col gap-0.5", lifted?.taskId === id && "hidden")}>
        {lifted && target?.columnId === lane && target.beforeTaskId === id && <DropGap height={lifted.height} />}
        <div data-sidebar-project-row={id} data-flip-id={id} onPointerDown={(event) => { if (!locked) drag.press(event, id); }}
          className="group/project relative min-w-0 rounded-xl">
          {row(bot)}
          <button type="button" disabled={locked} aria-label={`Reorder ${bot.name}`} title="Use the Up and Down arrow keys to reorder"
            onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); order.moveBy(id, event.key === "ArrowUp" ? -1 : 1); } }}
            className="pointer-events-none absolute left-0.5 top-1/2 z-10 flex h-6 w-3.5 -translate-y-1/2 select-none items-center justify-center rounded text-ink-tertiary opacity-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <GripVertical size={12} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }
}

export function splitPinnedProjects(pinned: readonly Bot[], projectsListed: boolean): { pinnedProjectChiefs: Bot[]; topPins: Bot[] } {
  const pinnedProjectChiefs = projectsListed ? pinned.filter((bot) => bot.chiefOfStaff && bot.section && !isWorkspaceSection(bot.section)) : [];
  return { pinnedProjectChiefs, topPins: pinned.filter((bot) => !pinnedProjectChiefs.includes(bot)) };
}

/** The collapsed sidebar's projects: pinned first, then the rest in the chosen order, without archived ones. */
export function SidebarProjectIcons({ projects, agents = [], row, agentRow = row, archived }: {
  projects: readonly Bot[]; agents?: readonly Bot[]; row(bot: Bot): ReactNode; agentRow?(bot: Bot): ReactNode; archived?: (bot: Bot) => boolean;
}) {
  const workspaces = useWorkspaces();
  const shown = sortProjects(projects.filter((bot) => !archived?.(bot)).map((bot) => ({ id: bot.id, name: bot.name, updatedAt: lastUpdate(bot), bot })), workspaces);
  const pinned = shown.filter((item) => item.bot.pinned);
  const rest = shown.filter((item) => !item.bot.pinned);
  return (
    <>
      {shown.length > 0 && <div data-sidebar-project-icons role="list" aria-label="Projects" className="flex flex-col items-center gap-1">
        <span aria-hidden="true" className="mb-1 h-px w-8 bg-hairline/60" />
        {pinned.map(({ id, bot }) => <div key={id} role="listitem" className="w-full">{row(bot)}</div>)}
        {pinned.length > 0 && rest.length > 0 && <span aria-hidden="true" className="my-0.5 h-px w-4 bg-hairline/60" />}
        {rest.map(({ id, bot }) => <div key={id} role="listitem" className="w-full">{row(bot)}</div>)}
      </div>}
      {agents.length > 0 && <div role="list" aria-label="Agents" className="flex flex-col items-center gap-1 pt-1">
        <span aria-hidden="true" className="my-1 h-px w-8 bg-hairline/60" />
        {agents.map((bot) => <div key={bot.id} role="listitem" className="w-full">{agentRow(bot)}</div>)}
      </div>}
    </>
  );
}

/** The right side of a project row: who is in the project, then unread replies. */
export function ProjectRowTrailing({ viewers, unread }: { viewers: ReactNode; unread: number }) {
  return (
    <div data-project-row-trailing className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
      {viewers}
      {unread > 0 && <UnreadBadge count={unread} />}
    </div>
  );
}

export interface SidebarGroup { id: string; name: string; rows: ReactNode; empty?: ReactNode; onAdd?: () => void; addLabel?: string; onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void }

/** Agents and each template team: groups that fold open and closed and can be dragged into any order. */
export function SidebarGroups({ groups }: { groups: readonly SidebarGroup[] }) {
  const view = useWorkspaces();
  const ordered = orderedGroups(groups, view);
  const folded = new Set(view.collapsedGroups ?? []);
  const dragging = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; place: "before" | "after" } | null>(null);
  const place = (event: React.DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" as const : "after" as const;
  };
  return <>
    {ordered.map((group) => {
      const open = !folded.has(group.id);
      return (
        <div key={group.id} data-sidebar-group={group.id} className="flex flex-col gap-0.5 pt-3">
          <div draggable onContextMenu={group.onContextMenu}
            onDragStart={(event) => { dragging.current = group.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-origin-group", group.id); }}
            onDragOver={(event) => { if (!dragging.current || dragging.current === group.id) return; event.preventDefault(); setDrop({ id: group.id, place: place(event) }); }}
            onDragLeave={() => setDrop(null)}
            onDrop={(event) => {
              event.preventDefault();
              const from = dragging.current;
              if (from && from !== group.id) setGroupOrder(movedOrder(ordered.map((item) => item.id), from, group.id, place(event)));
              dragging.current = null; setDrop(null);
            }}
            onDragEnd={() => { dragging.current = null; setDrop(null); }}
            className={cn("flex cursor-grab items-center gap-1 rounded px-2 pb-1 active:cursor-grabbing",
              drop?.id === group.id && (drop.place === "before" ? "shadow-[0_-2px_var(--color-accent)]" : "shadow-[0_2px_var(--color-accent)]"))}>
            <button type="button" aria-expanded={open} onClick={() => toggleGroup(group.id)}
              className="flex min-w-0 flex-1 items-center gap-1 rounded text-[12px] font-medium text-ink-secondary hover:text-ink">
              <ChevronRight size={12} className={cn("shrink-0 transition-transform", open && "rotate-90")} aria-hidden="true" />
              <span className="truncate">{group.name}</span>
            </button>
            {group.onAdd && <button type="button" aria-label={group.addLabel} title={group.addLabel} onClick={group.onAdd}
              className="flex size-6 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink"><Plus size={14} /></button>}
          </div>
          {open && group.rows}
          {open && group.empty}
        </div>
      );
    })}
  </>;
}

/** Creates a standalone agent, from scratch or from a template, outside every project. */
export function NewAgentDialog({ onClose }: { onClose(): void }) {
  return createPortal(<NewBotDialog section={STANDALONE_SECTION} onClose={onClose} />, document.body);
}

function MembersDialog({ cloudTeamId, onClose }: { cloudTeamId: string | null; onClose(): void }) {
  const titleId = useId();
  return createPortal(
    <CenteredDialog label="Members & invites" labelledBy={titleId} onClose={onClose} className="flex h-[min(720px,92dvh)] flex-col overflow-hidden sm:max-w-[760px]">{(dismiss) => <>
        <div className="flex shrink-0 items-center justify-between border-b border-hairline/40 px-5 py-3.5">
          <h2 id={titleId} className="text-[16px] font-semibold text-ink">Members & invites</h2>
          <button type="button" aria-label="Close" onClick={dismiss} className={iconButton}><X size={16} /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <WorkspaceMembersPanel cloudTeamId={cloudTeamId} />
          <div className="px-5 pb-5"><RuntimeHelp className="mt-4" /></div>
        </div>
      </>}</CenteredDialog>,
    document.body,
  );
}
