import { useState, type DragEvent, type ReactNode } from "react";
import { ChevronRight, Circle, Eye, EyeOff, Frame, Group, Image as ImageIcon, Lock, LockOpen, Minus, MoveUpRight, Spline, Square, Type } from "lucide-react";
import { effectiveParent, nextZ, type CanvasNode, type CanvasNodeType } from "../../../../shared/canvas-scene";
import { cn } from "@/lib/cn";
import { reparent, zAt } from "./actions";
import type { SelectionApi } from "./CanvasEditor";
import type { CanvasScene } from "./use-canvas-scene";

const ICONS: Record<CanvasNodeType, ReactNode> = {
  frame: <Frame size={13} />, rect: <Square size={13} />, ellipse: <Circle size={13} />, line: <Minus size={13} className="-rotate-45" />,
  arrow: <MoveUpRight size={13} />, text: <Type size={13} />, image: <ImageIcon size={13} />, group: <Group size={13} />, path: <Spline size={13} />,
};

type Drop = { id: string; zone: "above" | "below" | "inside" };

export function LayersPanel({ canvas, selection, readOnly, header }: { canvas: CanvasScene; selection: SelectionApi; readOnly: boolean; header?: ReactNode }) {
  const { scene, index } = canvas;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const roots = index.get(null) ?? [];

  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const click = (node: CanvasNode, additive: boolean) => {
    if (additive) selection.select(selection.ids.includes(node.id) ? selection.ids.filter((id) => id !== node.id) : [...selection.ids, node.id]);
    else selection.select([node.id]);
  };

  const zoneOf = (event: DragEvent, node: CanvasNode): Drop["zone"] => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const at = (event.clientY - rect.top) / rect.height;
    const container = node.type === "frame" || node.type === "group";
    if (container && at > 0.25 && at < 0.75) return "inside";
    return at < 0.5 ? "above" : "below";
  };

  const isInside = (id: string, ancestor: string) => {
    let current: string | null = id;
    while (current) {
      if (current === ancestor) return true;
      const node = scene.get(current);
      current = node ? effectiveParent(scene, node) : null;
    }
    return false;
  };

  const finishDrop = () => {
    const moving = dragging ? scene.get(dragging) : undefined;
    const target = drop ? scene.get(drop.id) : undefined;
    setDragging(null);
    setDrop(null);
    if (!moving || !target || readOnly || moving.id === target.id || isInside(target.id, moving.id)) return;
    if (drop!.zone === "inside") {
      canvas.commit([reparent(scene, moving, target.id, nextZ(index.get(target.id) ?? []))]);
      return;
    }
    const parent = effectiveParent(scene, target);
    const siblings = (index.get(parent) ?? []).filter((item) => item.id !== moving.id);
    const at = siblings.findIndex((item) => item.id === target.id);
    const z = zAt(siblings, drop!.zone === "above" ? at + 1 : at);
    canvas.commit([parent === effectiveParent(scene, moving) ? { ...moving, z } : reparent(scene, moving, parent, z)]);
  };

  const row = (node: CanvasNode, depth: number): ReactNode => {
    const children = index.get(node.id) ?? [];
    const open = !collapsed.has(node.id);
    const chosen = selection.ids.includes(node.id);
    const marker = drop?.id === node.id ? drop.zone : null;
    return (
      <li key={node.id} role="treeitem" aria-selected={chosen} aria-expanded={children.length ? open : undefined}>
        <div draggable={!readOnly && renaming !== node.id}
          onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", node.id); setDragging(node.id); }}
          onDragOver={(event) => { if (!dragging || dragging === node.id) return; event.preventDefault(); setDrop({ id: node.id, zone: zoneOf(event, node) }); }}
          onDragLeave={() => setDrop((current) => (current?.id === node.id ? null : current))}
          onDrop={(event) => { event.preventDefault(); finishDrop(); }}
          onDragEnd={() => { setDragging(null); setDrop(null); }}
          onClick={(event) => click(node, event.shiftKey || event.metaKey || event.ctrlKey)}
          onDoubleClick={() => { if (!readOnly) setRenaming(node.id); }}
          className={cn("group relative flex h-7 cursor-default items-center gap-1 rounded-md pr-1 text-[12.5px] transition-colors duration-100",
            chosen ? "bg-accent/15 text-ink" : "text-ink-secondary hover:bg-raised/70 hover:text-ink",
            node.hidden && "opacity-50", marker === "inside" && "ring-1 ring-inset ring-accent")}
          style={{ paddingLeft: 6 + depth * 14 }}>
          {marker === "above" && <span aria-hidden="true" className="absolute inset-x-1 -top-px h-0.5 rounded bg-accent" />}
          {marker === "below" && <span aria-hidden="true" className="absolute inset-x-1 -bottom-px h-0.5 rounded bg-accent" />}
          {children.length ? (
            <button type="button" aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`} onClick={(event) => { event.stopPropagation(); toggle(node.id); }}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded text-ink-tertiary hover:text-ink">
              <ChevronRight size={12} className={cn("transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
            </button>
          ) : <span className="size-4 shrink-0" />}
          <span className={cn("shrink-0", chosen ? "text-accent-text" : "text-ink-tertiary")}>{ICONS[node.type]}</span>
          {renaming === node.id ? (
            <input autoFocus defaultValue={node.name} aria-label="Layer name" maxLength={120}
              className="h-6 min-w-0 flex-1 rounded border border-accent/70 bg-inset px-1 text-[12.5px] text-ink outline-none"
              onClick={(event) => event.stopPropagation()}
              onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== node.name) canvas.commit([{ ...node, name }]); setRenaming(null); }}
              onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(null); }} />
          ) : <span className="min-w-0 flex-1 truncate">{node.name}</span>}
          {!readOnly && renaming !== node.id && (
            <span className={cn("flex shrink-0 items-center", !node.locked && !node.hidden && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}>
              <button type="button" aria-label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`} onClick={(event) => { event.stopPropagation(); canvas.commit([{ ...node, locked: !node.locked }]); }}
                className="inline-flex size-6 items-center justify-center rounded text-ink-tertiary hover:text-ink">
                {node.locked ? <Lock size={12} /> : <LockOpen size={12} />}
              </button>
              <button type="button" aria-label={node.hidden ? `Show ${node.name}` : `Hide ${node.name}`} onClick={(event) => { event.stopPropagation(); canvas.commit([{ ...node, hidden: !node.hidden }]); }}
                className="inline-flex size-6 items-center justify-center rounded text-ink-tertiary hover:text-ink">
                {node.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </span>
          )}
        </div>
        {children.length > 0 && open && <ul role="group">{[...children].reverse().map((child) => row(child, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="flex h-9 shrink-0 items-center px-3 text-[11.5px] font-medium uppercase tracking-wide text-ink-tertiary">Layers</div>
      {roots.length ? (
        <ul role="tree" aria-label="Layers" aria-multiselectable="true" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
          {[...roots].reverse().map((node) => row(node, 0))}
        </ul>
      ) : <p className="px-3 text-[12.5px] text-ink-tertiary">No layers yet</p>}
    </div>
  );
}
