import { Component, Crosshair, Minus, Plus, SquaresExclude, SquaresIntersect, SquaresSubtract, SquaresUnite, Unlink, Waypoints, X } from "lucide-react";
import { componentSets, instanceOf, masterTree, pickVariant, resetOverrides, swapVariant, syncInstance, variantProps } from "../../../../shared/canvas-components";
import { GRID_KINDS, childrenIndex, decodeScene, descendants, effectiveParent, type CanvasNode, type ComponentInfo, type Constraints, type LayoutGrid, type Shadow } from "../../../../shared/canvas-scene";
import { colorStyles } from "../../../../shared/canvas-styles";
import type { BrandKit } from "../../../../shared/brand-kit";
import { useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { Select } from "../../Select";
import type { SelectionApi } from "./CanvasEditor";
import { ColorField, NumberField, Section, field, iconToggle } from "./controls";
import { canBoolean, canFlatten } from "./booleans";
import type { CanvasScene } from "./use-canvas-scene";

type Update = (patch: Partial<CanvasNode> | ((node: CanvasNode) => Partial<CanvasNode>)) => void;
const small = cn(iconToggle, "h-6 max-w-none flex-none gap-1 px-2 text-[11.5px]");

export function BooleanSection({ canvas, selection, disabled }: { canvas: CanvasScene; selection: SelectionApi; disabled: boolean }) {
  const many = canBoolean(canvas.scene, selection.ids);
  if (!many && !canFlatten(canvas.scene, selection.ids)) return null;
  const items = [
    { command: "union", title: "Union (Ctrl+Alt+U)", icon: <SquaresUnite size={14} /> },
    { command: "subtract", title: "Subtract (Ctrl+Alt+S)", icon: <SquaresSubtract size={14} /> },
    { command: "intersect", title: "Intersect (Ctrl+Alt+I)", icon: <SquaresIntersect size={14} /> },
    { command: "exclude", title: "Exclude (Ctrl+Alt+X)", icon: <SquaresExclude size={14} /> },
  ] as const;
  return (
    <Section title="Combine">
      <div className="flex gap-0.5">
        {many && items.map((item) => (
          <button key={item.command} type="button" className={iconToggle} title={item.title} aria-label={item.title.replace(/ \(.*/, "")} disabled={disabled} onClick={() => selection.run(item.command)}>{item.icon}</button>
        ))}
        <button type="button" className={iconToggle} title="Flatten to a vector (Ctrl+E)" aria-label="Flatten" disabled={disabled} onClick={() => selection.run("flatten")}><Waypoints size={14} /></button>
      </div>
    </Section>
  );
}

function PropsEditor({ info, onChange, disabled }: { info: ComponentInfo; onChange(info: ComponentInfo): void; disabled: boolean }) {
  const props = Object.entries(info.props ?? {});
  const write = (entries: [string, string][]) => onChange({ ...info, props: Object.fromEntries(entries.filter(([key]) => key.trim())) });
  return (
    <div className="flex flex-col gap-1">
      <input className={field} aria-label="Variant set" placeholder="Variant set, like Button" defaultValue={info.set ?? ""} disabled={disabled} key={`set-${info.set}`}
        onBlur={(event) => { const set = event.target.value.trim(); if (set !== (info.set ?? "")) onChange({ ...info, set: set || undefined }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      {info.set && props.map(([key, value], at) => (
        <div key={`${key}-${at}`} className="flex gap-1">
          <input className={field} aria-label="Property" defaultValue={key} disabled={disabled} onBlur={(event) => write(props.map((entry, index) => (index === at ? [event.target.value.trim(), entry[1]] : entry)))} />
          <input className={field} aria-label={`${key} value`} defaultValue={value} disabled={disabled} onBlur={(event) => write(props.map((entry, index) => (index === at ? [entry[0], event.target.value.trim()] : entry)))} />
          <button type="button" className={cn(iconToggle, "max-w-7")} aria-label={`Remove ${key}`} disabled={disabled} onClick={() => write(props.filter((_, index) => index !== at))}><Minus size={12} /></button>
        </div>
      ))}
      {info.set && props.length < 8 && (
        <button type="button" className={cn(small, "self-start")} disabled={disabled} onClick={() => write([...props, [props.length ? `Property ${props.length + 1}` : "Variant", "Default"]])}><Plus size={12} />Property</button>
      )}
    </div>
  );
}

/** Component, variant and instance controls for one selected node. */
export function ComponentSection({ canvas, selection, node, disabled, teamId }: { canvas: CanvasScene; selection: SelectionApi; node: CanvasNode; disabled: boolean; teamId: string }) {
  const { scene } = canvas;
  const root = instanceOf(scene, node);
  const library = root?.library;
  const remoteRows = useCloudQuery<string[]>("draw:scene", library ? { teamId, canvasId: library } : "skip");
  if (node.component) {
    return (
      <Section title="Component" action={<span className="flex items-center gap-1 text-[11px] text-accent-text"><Component size={12} />Main</span>}>
        <PropsEditor info={node.component} disabled={disabled} onChange={(component) => canvas.commit([{ ...node, component }])} />
        <input className={field} aria-label="Component description" placeholder="Description" defaultValue={node.component.description ?? ""} disabled={disabled} key={`d-${node.id}`}
          onBlur={(event) => { const description = event.target.value.trim(); if (description !== (node.component?.description ?? "")) canvas.commit([{ ...node, component: { ...node.component, description: description || undefined } }]); }} />
        <p className="text-[11.5px] text-ink-tertiary">{[...scene.values()].filter((item) => !item.deleted && item.instanceOf === node.id).length} instances on this canvas</p>
      </Section>
    );
  }
  if (!root) {
    if (node.type !== "frame" || disabled) return null;
    return <Section title="Component" action={<button type="button" className={small} onClick={() => selection.run("component")} title="Create component (Ctrl+Alt+K)"><Component size={12} />Create</button>} />;
  }
  const index = childrenIndex(scene);
  const master = scene.get(root.instanceOf!);
  const set = master?.component?.set ? componentSets(scene).find((item) => item.set === master.component!.set) : undefined;
  const props = set ? variantProps(set.components) : new Map<string, string[]>();
  const overrides = [root, ...descendants(scene, root.id, index)].filter((item) => item.overrides?.length);
  const remote = remoteRows ? new Map(decodeScene(remoteRows).map((item) => [item.id, item])) : null;
  const updateFromLibrary = () => {
    if (!remote) return;
    const tree = masterTree(remote, childrenIndex(remote), root.instanceOf!);
    if (!tree.length) return;
    const changed: CanvasNode[] = [];
    syncInstance(scene, index, root.id, tree, (item) => changed.push(item));
    canvas.commit(changed);
  };
  return (
    <Section title="Instance" action={<span className="max-w-32 truncate text-[11px] text-ink-tertiary">{master?.name ?? (library ? "Library" : "Missing component")}</span>}>
      {master && [...props.entries()].map(([key, values]) => (
        <label key={key} className="grid grid-cols-[72px_1fr] items-center gap-1.5 text-[12px] text-ink-secondary">
          <span className="truncate">{key}</span>
          <Select size="sm" aria-label={key} disabled={disabled} value={master.component?.props?.[key] ?? ""} onChange={(event) => {
            const next = pickVariant(set!.components, master, key, event.target.value);
            if (next && next.id !== master.id) canvas.commit(swapVariant(scene, index, root.id, masterTree(scene, index, master.id), masterTree(scene, index, next.id)));
          }}>
            {values.map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </label>
      ))}
      <div className="flex flex-wrap gap-1">
        {master && <button type="button" className={small} onClick={() => { selection.select([master.id]); selection.zoomTo([master.id]); }}><Crosshair size={12} />Component</button>}
        {library && <button type="button" className={small} disabled={disabled || !remote} onClick={updateFromLibrary}>Update</button>}
        {overrides.length > 0 && <button type="button" className={small} disabled={disabled} onClick={() => canvas.commit(resetOverrides(overrides))}><X size={12} />Reset</button>}
        <button type="button" className={small} disabled={disabled} onClick={() => selection.run("detach")} title="Detach instance (Ctrl+Alt+B)"><Unlink size={12} />Detach</button>
      </div>
    </Section>
  );
}

const H_OPTIONS: [Constraints["h"], string][] = [["left", "Left"], ["right", "Right"], ["stretch", "Left and right"], ["center", "Centre"], ["scale", "Scale"]];
const V_OPTIONS: [Constraints["v"], string][] = [["top", "Top"], ["bottom", "Bottom"], ["stretch", "Top and bottom"], ["center", "Centre"], ["scale", "Scale"]];

export function ConstraintsSection({ nodes, disabled, update }: { nodes: readonly CanvasNode[]; disabled: boolean; update: Update }) {
  const h = nodes.every((node) => (node.constraints?.h ?? "left") === (nodes[0]!.constraints?.h ?? "left")) ? nodes[0]!.constraints?.h ?? "left" : "";
  const v = nodes.every((node) => (node.constraints?.v ?? "top") === (nodes[0]!.constraints?.v ?? "top")) ? nodes[0]!.constraints?.v ?? "top" : "";
  const set = (patch: Partial<Constraints>) => update((node) => {
    const next = { h: node.constraints?.h ?? "left", v: node.constraints?.v ?? "top", ...patch };
    return { constraints: next.h === "left" && next.v === "top" ? undefined : next };
  });
  return (
    <Section title="Constraints">
      <div className="grid grid-cols-2 gap-1.5">
        <Select size="sm" aria-label="Horizontal constraint" disabled={disabled} value={h} onChange={(event) => set({ h: event.target.value as Constraints["h"] })}>
          {!h && <option value="">Mixed</option>}
          {H_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select size="sm" aria-label="Vertical constraint" disabled={disabled} value={v} onChange={(event) => set({ v: event.target.value as Constraints["v"] })}>
          {!v && <option value="">Mixed</option>}
          {V_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </div>
    </Section>
  );
}

/** Wrapping, absolute position and size limits around auto layout. */
export function LayoutExtras({ canvas, node, disabled, update }: { canvas: CanvasScene; node: CanvasNode; disabled: boolean; update: Update }) {
  const parent = canvas.scene.get(effectiveParent(canvas.scene, node) ?? "");
  const inStack = Boolean(parent?.layout);
  const check = "accent-[var(--color-accent)]";
  return (
    <>
      {node.layout?.direction === "row" && (
        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-2 text-[12px] text-ink-secondary">
            <input type="checkbox" className={check} checked={Boolean(node.layout.wrap)} disabled={disabled} onChange={(event) => update({ layout: { ...node.layout!, wrap: event.target.checked || undefined, crossGap: event.target.checked ? node.layout!.gap : undefined } })} />Wrap
          </label>
          {node.layout.wrap && <div className="w-24"><NumberField label="↧" value={node.layout.crossGap ?? node.layout.gap} min={0} disabled={disabled} onCommit={(crossGap) => update({ layout: { ...node.layout!, crossGap } })} /></div>}
        </div>
      )}
      {inStack && (
        <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
          <input type="checkbox" className={check} checked={Boolean(node.absolute)} disabled={disabled} onChange={(event) => update({ absolute: event.target.checked || undefined })} />Absolute position
        </label>
      )}
      {(inStack || node.layout) && (
        <div className="grid grid-cols-2 gap-1.5">
          {(["minW", "maxW", "minH", "maxH"] as const).map((key) => (
            <NumberField key={key} label={<span className="text-[9.5px]">{key.slice(0, 3)}{key.endsWith("W") ? "W" : "H"}</span>} value={node[key]} min={0} disabled={disabled}
              onCommit={(value) => update({ [key]: value > 0 ? value : undefined })} />
          ))}
        </div>
      )}
    </>
  );
}

const SHADOW: Shadow = { x: 0, y: 4, blur: 16, spread: 0, color: "#0000001F" };

export function EffectsSection({ nodes, disabled, update, preview }: { nodes: readonly CanvasNode[]; disabled: boolean; update: Update; preview(patch: Partial<CanvasNode>): void }) {
  const single = nodes.length === 1 ? nodes[0]! : null;
  const shadow = single?.shadow;
  const blur = single?.blur;
  return (
    <Section title="Effects" action={!disabled && single && (!shadow || !blur) && (
      <div className="flex gap-1">
        {!shadow && <button type="button" className={small} onClick={() => update({ shadow: SHADOW })}><Plus size={12} />Shadow</button>}
        {!blur && <button type="button" className={small} onClick={() => update({ blur: 4 })}><Plus size={12} />Blur</button>}
      </div>
    )}>
      {shadow && (
        <div className="flex flex-col gap-1.5" role="group" aria-label="Drop shadow">
          <div className="flex items-center justify-between text-[12px] text-ink-secondary">Drop shadow<button type="button" className={cn(iconToggle, "max-w-7 flex-none")} aria-label="Remove shadow" disabled={disabled} onClick={() => update({ shadow: undefined })}><Minus size={12} /></button></div>
          <div className="grid grid-cols-4 gap-1">
            <NumberField label="X" value={shadow.x} disabled={disabled} onCommit={(x) => update({ shadow: { ...shadow, x } })} />
            <NumberField label="Y" value={shadow.y} disabled={disabled} onCommit={(y) => update({ shadow: { ...shadow, y } })} />
            <NumberField label="B" value={shadow.blur} min={0} disabled={disabled} onCommit={(value) => update({ shadow: { ...shadow, blur: value } })} />
            <NumberField label="S" value={shadow.spread} disabled={disabled} onCommit={(spread) => update({ shadow: { ...shadow, spread } })} />
          </div>
          <ColorField label="Shadow" value={shadow.color} disabled={disabled} onPreview={(color) => preview({ shadow: { ...shadow, color: color + shadow.color.slice(7) } })} onCommit={(color) => update({ shadow: { ...shadow, color: color.length === 7 ? color + shadow.color.slice(7) : color } })} />
        </div>
      )}
      {blur !== undefined && (
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-[12px] text-ink-secondary">Layer blur</span>
          <div className="w-20"><NumberField label="r" value={blur} min={0} max={250} disabled={disabled} onCommit={(value) => update({ blur: value || undefined })} /></div>
          <button type="button" className={cn(iconToggle, "max-w-7 flex-none")} aria-label="Remove blur" disabled={disabled} onClick={() => update({ blur: undefined })}><Minus size={12} /></button>
        </div>
      )}
    </Section>
  );
}

export function GridsSection({ node, disabled, update }: { node: CanvasNode; disabled: boolean; update: Update }) {
  const grids = node.grids ?? [];
  const write = (next: LayoutGrid[]) => update({ grids: next.length ? next : undefined });
  return (
    <Section title="Layout grid" action={!disabled && grids.length < 4 && (
      <button type="button" className={cn(iconToggle, "max-w-7 flex-none")} aria-label="Add layout grid" onClick={() => write([...grids, { kind: "columns", count: 12, gutter: 20, margin: 40, size: 8, color: "#FF4D4D1A" }])}><Plus size={13} /></button>
    )}>
      {grids.map((grid, at) => {
        const set = (patch: Partial<LayoutGrid>) => write(grids.map((item, index) => (index === at ? { ...item, ...patch } : item)));
        return (
          <div key={at} className="flex flex-col gap-1 rounded-md bg-inset/50 p-1">
            <div className="flex gap-1">
              <Select size="sm" aria-label="Grid kind" disabled={disabled} value={grid.kind} onChange={(event) => set({ kind: event.target.value as LayoutGrid["kind"] })}>
                {GRID_KINDS.map((kind) => <option key={kind} value={kind}>{kind === "grid" ? "Grid" : kind === "columns" ? "Columns" : "Rows"}</option>)}
              </Select>
              <button type="button" className={cn(iconToggle, "max-w-7 flex-none")} aria-label="Remove layout grid" disabled={disabled} onClick={() => write(grids.filter((_, index) => index !== at))}><Minus size={12} /></button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {grid.kind === "grid"
                ? <NumberField label="▦" value={grid.size} min={1} disabled={disabled} onCommit={(size) => set({ size })} />
                : <>
                  <NumberField label="#" value={grid.count} min={1} max={100} disabled={disabled} onCommit={(count) => set({ count: Math.round(count) })} />
                  <NumberField label="G" value={grid.gutter} min={0} disabled={disabled} onCommit={(gutter) => set({ gutter })} />
                  <NumberField label="M" value={grid.margin} min={0} disabled={disabled} onCommit={(margin) => set({ margin })} />
                </>}
            </div>
          </div>
        );
      })}
    </Section>
  );
}

/** The colour style a fill or stroke follows, with a way to unbind it. */
export function StyleChip({ id, kit, onDetach, disabled }: { id: string; kit: BrandKit | null | undefined; onDetach(): void; disabled: boolean }) {
  const style = colorStyles(kit).find((item) => item.id === id);
  if (!style) return null;
  return (
    <div className="flex h-7 items-center gap-1.5 rounded-md bg-inset pl-1.5 pr-0.5 text-[12px] text-ink">
      <span className="size-4 shrink-0 rounded border border-hairline/60" style={{ background: style.color }} />
      <span className="min-w-0 flex-1 truncate">{style.name}</span>
      <button type="button" className={cn(iconToggle, "h-6 max-w-6 flex-none")} aria-label={`Detach ${style.name} style`} title="Detach style" disabled={disabled} onClick={onDetach}><Unlink size={12} /></button>
    </div>
  );
}
