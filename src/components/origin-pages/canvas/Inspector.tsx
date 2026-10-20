import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignLeft, AlignRight,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowDown, ArrowRight, Minus, Plus,
} from "lucide-react";
import { FRAME_PRESETS, effectiveParent, typeName, type CanvasFont, type CanvasNode, type StackLayout, type TextAlign } from "../../../../shared/canvas-scene";
import { newNode } from "../../../../shared/canvas-ops";
import { cn } from "@/lib/cn";
import { Select } from "../../Select";
import type { SelectionApi } from "./CanvasEditor";
import { unionBox, worldBounds, worldBox } from "./geometry";
import type { CanvasScene } from "./use-canvas-scene";

const field = "h-7 w-full min-w-0 rounded-md border border-transparent bg-inset px-1.5 text-[12px] tabular-nums text-ink outline-none transition-colors hover:border-hairline/60 focus:border-accent/70 disabled:opacity-50";
const iconToggle = "inline-flex h-7 min-w-7 flex-1 items-center justify-center rounded-md text-ink-secondary outline-none transition-colors duration-100 hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40";

function Section({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="border-b border-hairline/40 px-3 py-2.5">
      <div className="mb-1.5 flex h-6 items-center justify-between">
        <h3 className="text-[11.5px] font-medium text-ink-secondary">{title}</h3>
        {action}
      </div>
      {children && <div className="flex flex-col gap-1.5">{children}</div>}
    </section>
  );
}

const same = <T,>(values: readonly T[]): T | undefined => (values.every((value) => value === values[0]) ? values[0] : undefined);
const tidy = (value: number) => String(Math.round(value * 100) / 100);

export function NumberField({ label, value, onCommit, min, max, step = 1, disabled, suffix }: {
  label: ReactNode; value: number | undefined; onCommit(value: number): void; min?: number; max?: number; step?: number; disabled?: boolean; suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : tidy(value));
  const clamp = (next: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
  const commit = (text: string) => {
    setDraft(null);
    const parsed = Number(text.replace(",", ".").replace(/[^\d.+-]/g, ""));
    if (text.trim() && Number.isFinite(parsed) && parsed !== value) onCommit(clamp(parsed));
  };
  const scrub = useRef<{ x: number; start: number } | null>(null);
  return (
    <label className="flex min-w-0 items-center gap-1 rounded-md">
      <span className={cn("w-4 shrink-0 select-none text-center text-[11px] text-ink-tertiary", !disabled && value !== undefined && "cursor-ew-resize")}
        onPointerDown={(event) => { if (disabled || value === undefined) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); scrub.current = { x: event.clientX, start: value }; }}
        onPointerMove={(event) => { if (!scrub.current) return; const next = clamp(Math.round(scrub.current.start + (event.clientX - scrub.current.x) * step)); setDraft(tidy(next)); }}
        onPointerUp={() => { if (!scrub.current) return; scrub.current = null; if (draft !== null) commit(draft); }}>
        {label}
      </span>
      <input className={field} value={shown} placeholder={value === undefined ? "Mixed" : undefined} disabled={disabled} inputMode="decimal" aria-label={typeof label === "string" ? label : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") { setDraft(null); event.currentTarget.blur(); }
          if ((event.key === "ArrowUp" || event.key === "ArrowDown") && value !== undefined) {
            event.preventDefault();
            onCommit(clamp(value + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1)));
          }
        }} />
      {suffix && <span className="shrink-0 text-[11px] text-ink-tertiary">{suffix}</span>}
    </label>
  );
}

function ColorField({ label, value, onPreview, onCommit, onRemove, disabled }: { label: string; value: string | null | undefined; onPreview(value: string): void; onCommit(value: string): void; onRemove?: () => void; disabled?: boolean }) {
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => {
    const input = picker.current;
    if (!input) return;
    const change = () => commitRef.current(input.value.toUpperCase());
    input.addEventListener("change", change);
    return () => input.removeEventListener("change", change);
  }, []);
  const hex = value ? value.slice(0, 7) : "#000000";
  return (
    <div className="flex items-center gap-1.5">
      <span className="relative size-7 shrink-0 overflow-hidden rounded-md border border-hairline/60" style={{ background: value ?? "transparent" }}>
        <input ref={picker} type="color" aria-label={`${label} colour`} value={hex.length === 7 ? hex : "#000000"} disabled={disabled}
          onInput={(event) => onPreview(event.currentTarget.value.toUpperCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </span>
      <input className={field} aria-label={`${label} hex`} value={draft ?? (value ?? "")} placeholder="Mixed" disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => { setDraft(null); const next = event.target.value.trim(); if (/^#?[0-9a-f]{3,8}$/i.test(next)) onCommit((next.startsWith("#") ? next : `#${next}`).toUpperCase()); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      {onRemove && <button type="button" className={cn(iconToggle, "max-w-7")} aria-label={`Remove ${label.toLowerCase()}`} disabled={disabled} onClick={onRemove}><Minus size={13} /></button>}
    </div>
  );
}

function Toggles<T extends string>({ value, options, onChange, label, disabled }: { value: T | undefined; options: readonly { value: T; label: ReactNode; title: string }[]; onChange(value: T): void; label: string; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-md bg-inset p-0.5">
      {options.map((option) => (
        <button key={option.value} type="button" title={option.title} aria-label={option.title} aria-pressed={option.value === value} disabled={disabled} onClick={() => onChange(option.value)}
          className={cn(iconToggle, "h-6 text-[11.5px]", option.value === value && "bg-raised text-ink")}>{option.label}</button>
      ))}
    </div>
  );
}

type Align = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hspace" | "vspace";

function aligned(canvas: CanvasScene, nodes: readonly CanvasNode[], how: Align): CanvasNode[] {
  const { scene } = canvas;
  const parent = nodes.length === 1 ? effectiveParent(scene, nodes[0]) : null;
  const target = nodes.length === 1 ? (parent ? worldBox(scene, scene.get(parent)!) : null) : unionBox(nodes.map((node) => worldBounds(scene, node)));
  if (!target) return [];
  if (how === "hspace" || how === "vspace") {
    const horizontal = how === "hspace";
    const sorted = [...nodes].sort((a, b) => (horizontal ? worldBounds(scene, a).x - worldBounds(scene, b).x : worldBounds(scene, a).y - worldBounds(scene, b).y));
    const sizes = sorted.reduce((sum, node) => sum + (horizontal ? worldBounds(scene, node).width : worldBounds(scene, node).height), 0);
    const gap = ((horizontal ? target.width : target.height) - sizes) / Math.max(1, sorted.length - 1);
    let cursor = horizontal ? target.x : target.y;
    return sorted.map((node) => {
      const box = worldBounds(scene, node);
      const shift = cursor - (horizontal ? box.x : box.y);
      cursor += (horizontal ? box.width : box.height) + gap;
      return horizontal ? { ...node, x: Math.round(node.x + shift) } : { ...node, y: Math.round(node.y + shift) };
    });
  }
  return nodes.map((node) => {
    const box = worldBounds(scene, node);
    const dx = how === "left" ? target.x - box.x : how === "hcenter" ? target.x + target.width / 2 - (box.x + box.width / 2) : how === "right" ? target.x + target.width - (box.x + box.width) : 0;
    const dy = how === "top" ? target.y - box.y : how === "vcenter" ? target.y + target.height / 2 - (box.y + box.height / 2) : how === "bottom" ? target.y + target.height - (box.y + box.height) : 0;
    return { ...node, x: Math.round(node.x + dx), y: Math.round(node.y + dy) };
  });
}

const ALIGN_BUTTONS: { how: Align; title: string; icon: ReactNode }[] = [
  { how: "left", title: "Align left", icon: <AlignStartVertical size={14} /> },
  { how: "hcenter", title: "Align horizontal centres", icon: <AlignCenterVertical size={14} /> },
  { how: "right", title: "Align right", icon: <AlignEndVertical size={14} /> },
  { how: "top", title: "Align top", icon: <AlignStartHorizontal size={14} /> },
  { how: "vcenter", title: "Align vertical centres", icon: <AlignCenterHorizontal size={14} /> },
  { how: "bottom", title: "Align bottom", icon: <AlignEndHorizontal size={14} /> },
];

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900] as const;
const WEIGHT_NAMES: Record<number, string> = { 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" };
const DEFAULT_LAYOUT: StackLayout = { direction: "column", gap: 16, padding: [16, 16, 16, 16], align: "start", justify: "start" };

export function Inspector({ canvas, selection, readOnly, exportSection }: { canvas: CanvasScene; selection: SelectionApi; readOnly: boolean; exportSection: ReactNode }) {
  const { scene, index } = canvas;
  const nodes = selection.nodes;
  const update = (patch: Partial<CanvasNode> | ((node: CanvasNode) => Partial<CanvasNode>)) =>
    canvas.commit(nodes.filter((node) => !node.locked).map((node) => ({ ...node, ...(typeof patch === "function" ? patch(node) : patch) })));
  const preview = (patch: Partial<CanvasNode>) => canvas.preview(nodes.filter((node) => !node.locked).map((node) => ({ ...node, ...patch })));
  const disabled = readOnly || nodes.every((node) => node.locked);

  if (!nodes.length) {
    const addFrame = (preset: (typeof FRAME_PRESETS)[number]) => {
      const roots = index.get(null) ?? [];
      const right = roots.length ? Math.max(...roots.map((node) => node.x + node.width)) + 100 : 0;
      const top = roots.length ? Math.min(...roots.map((node) => node.y)) : 0;
      const frame = newNode("frame", null, roots.length ? Math.max(...roots.map((node) => node.z)) + 1 : 1, { name: preset.name, x: Math.round(right), y: Math.round(top), width: preset.width, height: preset.height });
      canvas.commit([frame]);
      selection.select([frame.id]);
      selection.zoomTo([frame.id]);
    };
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!readOnly && (
          <Section title="New frame">
            <div className="grid grid-cols-2 gap-1">
              {FRAME_PRESETS.map((preset) => (
                <button key={preset.name} type="button" onClick={() => addFrame(preset)}
                  className="flex flex-col items-start rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60">
                  <span className="text-[12px] text-ink">{preset.name}</span>
                  <span className="text-[11px] tabular-nums text-ink-tertiary">{preset.width} × {preset.height}</span>
                </button>
              ))}
            </div>
          </Section>
        )}
        {exportSection}
      </div>
    );
  }

  const single = nodes.length === 1 ? nodes[0] : null;
  const kinds = new Set(nodes.map((node) => node.type));
  const parent = single ? effectiveParent(scene, single) : null;
  const parentLayout = parent ? scene.get(parent)?.layout : undefined;
  const texts = nodes.filter((node) => node.type === "text");
  const strokeOnly = nodes.every((node) => node.type === "line" || node.type === "arrow");
  const radiusable = nodes.every((node) => node.type === "rect" || node.type === "frame" || node.type === "image");
  const rotatable = nodes.every((node) => node.type !== "frame" && node.type !== "group");
  const fill = same(nodes.map((node) => node.fill));
  const stroke = same(nodes.map((node) => node.stroke));
  const position = single ? { x: single.x, y: single.y } : undefined;
  const layout = single?.type === "frame" ? single.layout : undefined;
  const setLayout = (patch: Partial<StackLayout>) => update((node) => ({ layout: { ...(node.layout ?? DEFAULT_LAYOUT), ...patch } }));
  const hug = (axis: "width" | "height") => layout?.hug === axis || layout?.hug === "both";
  const toggleHug = (axis: "width" | "height") => {
    const width = axis === "width" ? !hug("width") : hug("width");
    const height = axis === "height" ? !hug("height") : hug("height");
    setLayout({ hug: width && height ? "both" : width ? "width" : height ? "height" : undefined });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex h-10 items-center gap-2 border-b border-hairline/40 px-3">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{single ? single.name : `${nodes.length} layers`}</span>
        <span className="shrink-0 text-[11px] text-ink-tertiary">{single ? typeName(single.type) : kinds.size === 1 ? typeName(nodes[0].type) : "Mixed"}</span>
      </div>
      {(nodes.length > 1 || parent) && !readOnly && (
        <Section title="Align">
          <div className="flex gap-0.5">
            {ALIGN_BUTTONS.map((button) => (
              <button key={button.how} type="button" className={iconToggle} title={button.title} aria-label={button.title} disabled={disabled} onClick={() => canvas.commit(aligned(canvas, nodes, button.how))}>{button.icon}</button>
            ))}
          </div>
          {nodes.length > 2 && (
            <div className="flex gap-0.5">
              <button type="button" className={iconToggle} title="Distribute horizontally" aria-label="Distribute horizontally" disabled={disabled} onClick={() => canvas.commit(aligned(canvas, nodes, "hspace"))}><AlignHorizontalDistributeCenter size={14} /></button>
              <button type="button" className={iconToggle} title="Distribute vertically" aria-label="Distribute vertically" disabled={disabled} onClick={() => canvas.commit(aligned(canvas, nodes, "vspace"))}><AlignVerticalDistributeCenter size={14} /></button>
            </div>
          )}
        </Section>
      )}
      {single?.type === "frame" && (
        <Section title="Frame">
          <Select size="sm" aria-label="Frame size" disabled={disabled} value={FRAME_PRESETS.find((preset) => preset.width === single.width && preset.height === single.height)?.name ?? ""}
            onChange={(event) => { const preset = FRAME_PRESETS.find((item) => item.name === event.target.value); if (preset) update({ width: preset.width, height: preset.height }); }}>
            <option value="">Custom</option>
            {FRAME_PRESETS.map((preset) => <option key={preset.name} value={preset.name}>{preset.name} {preset.width}×{preset.height}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={single.clip !== false} disabled={disabled} onChange={(event) => update({ clip: event.target.checked })} />Clip content
          </label>
        </Section>
      )}
      <Section title="Layout">
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="X" value={position?.x} disabled={disabled || !single || Boolean(parentLayout)} onCommit={(x) => update({ x })} />
          <NumberField label="Y" value={position?.y} disabled={disabled || !single || Boolean(parentLayout)} onCommit={(y) => update({ y })} />
          <NumberField label="W" value={same(nodes.map((node) => node.width))} min={1} disabled={disabled} onCommit={(width) => update((node) => ({ width, ...(node.type === "text" ? { autoWidth: false } : {}), ...(node.points ? { points: node.points.map((value, at) => (at % 2 === 0 ? value * (width / Math.max(1, node.width)) : value)) } : {}) }))} />
          <NumberField label="H" value={same(nodes.map((node) => node.height))} min={0} disabled={disabled || texts.length > 0} onCommit={(height) => update((node) => ({ height, ...(node.points ? { points: node.points.map((value, at) => (at % 2 === 1 ? value * (height / Math.max(1, node.height)) : value)) } : {}) }))} />
          {rotatable && <NumberField label="°" value={same(nodes.map((node) => node.rotation))} min={-180} max={180} disabled={disabled} onCommit={(rotation) => update({ rotation })} />}
          {radiusable && <NumberField label="R" value={same(nodes.map((node) => node.radius))} min={0} disabled={disabled} onCommit={(radius) => update({ radius })} />}
        </div>
        {parentLayout && single && (
          <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={Boolean(single.grow)} disabled={disabled} onChange={(event) => update({ grow: event.target.checked || undefined })} />Fill the free space
          </label>
        )}
      </Section>
      {single?.type === "frame" && (
        <Section title="Auto layout" action={!readOnly && (
          <button type="button" className={cn(iconToggle, "max-w-7 flex-none")} aria-label={layout ? "Remove auto layout" : "Add auto layout"} title={layout ? "Remove auto layout" : "Add auto layout (Shift+A)"}
            onClick={() => update(() => (layout ? { layout: undefined } : { layout: DEFAULT_LAYOUT }))}>{layout ? <Minus size={13} /> : <Plus size={13} />}</button>
        )}>
          {layout && (
            <>
              <Toggles label="Direction" value={layout.direction} disabled={disabled} onChange={(direction) => setLayout({ direction })}
                options={[{ value: "column", label: <ArrowDown size={13} />, title: "Vertical" }, { value: "row", label: <ArrowRight size={13} />, title: "Horizontal" }]} />
              <div className="grid grid-cols-3 gap-1.5">
                <NumberField label="⇵" value={layout.gap} min={0} disabled={disabled} onCommit={(gap) => setLayout({ gap })} />
                <NumberField label="↕" value={layout.padding[0]} min={0} disabled={disabled} onCommit={(value) => setLayout({ padding: [value, layout.padding[1], value, layout.padding[3]] })} />
                <NumberField label="↔" value={layout.padding[1]} min={0} disabled={disabled} onCommit={(value) => setLayout({ padding: [layout.padding[0], value, layout.padding[2], value] })} />
              </div>
              <Toggles label="Align" value={layout.align} disabled={disabled} onChange={(align) => setLayout({ align })}
                options={[{ value: "start", label: "Start", title: "Align to start" }, { value: "center", label: "Centre", title: "Align to centre" }, { value: "end", label: "End", title: "Align to end" }, { value: "stretch", label: "Fill", title: "Stretch across" }]} />
              <Toggles label="Distribute" value={layout.justify} disabled={disabled} onChange={(justify) => setLayout({ justify })}
                options={[{ value: "start", label: "Pack", title: "Pack at the start" }, { value: "center", label: "Centre", title: "Pack in the centre" }, { value: "end", label: "End", title: "Pack at the end" }, { value: "between", label: "Spread", title: "Space between" }]} />
              <div className="flex gap-1">
                <button type="button" aria-pressed={hug("width")} disabled={disabled} onClick={() => toggleHug("width")} className={cn(iconToggle, "text-[11.5px]", hug("width") && "bg-raised text-ink")}>Hug width</button>
                <button type="button" aria-pressed={hug("height")} disabled={disabled} onClick={() => toggleHug("height")} className={cn(iconToggle, "text-[11.5px]", hug("height") && "bg-raised text-ink")}>Hug height</button>
              </div>
            </>
          )}
        </Section>
      )}
      {texts.length > 0 && texts.length === nodes.length && (
        <Section title="Text">
          <div className="grid grid-cols-2 gap-1.5">
            <Select size="sm" aria-label="Font" disabled={disabled} value={same(texts.map((node) => node.font)) ?? ""} onChange={(event) => update({ font: event.target.value as CanvasFont })}>
              {same(texts.map((node) => node.font)) === undefined && <option value="">Mixed</option>}
              <option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option>
            </Select>
            <Select size="sm" aria-label="Weight" disabled={disabled} value={String(same(texts.map((node) => node.fontWeight)) ?? "")} onChange={(event) => update({ fontWeight: Number(event.target.value) })}>
              {same(texts.map((node) => node.fontWeight)) === undefined && <option value="">Mixed</option>}
              {WEIGHTS.map((weight) => <option key={weight} value={weight}>{WEIGHT_NAMES[weight]}</option>)}
            </Select>
            <NumberField label="Aa" value={same(texts.map((node) => node.fontSize))} min={1} max={1000} disabled={disabled} onCommit={(fontSize) => update({ fontSize })} />
            <NumberField label="↨" value={same(texts.map((node) => node.lineHeight))} min={0.5} max={4} step={0.05} disabled={disabled} onCommit={(lineHeight) => update({ lineHeight })} />
          </div>
          <Toggles<TextAlign> label="Text align" value={same(texts.map((node) => node.align))} disabled={disabled} onChange={(align) => update({ align })}
            options={[{ value: "left", label: <AlignLeft size={13} />, title: "Align text left" }, { value: "center", label: <AlignCenter size={13} />, title: "Centre text" }, { value: "right", label: <AlignRight size={13} />, title: "Align text right" }]} />
          <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={texts.every((node) => node.autoWidth)} disabled={disabled} onChange={(event) => update({ autoWidth: event.target.checked })} />Width follows the text
          </label>
        </Section>
      )}
      {!strokeOnly && (
        <Section title={texts.length === nodes.length ? "Colour" : "Fill"} action={!readOnly && fill === null && (
          <button type="button" className={cn(iconToggle, "max-w-7 flex-none")} aria-label="Add fill" onClick={() => update({ fill: texts.length ? "#111111" : "#D9D9D9" })}><Plus size={13} /></button>
        )}>
          {fill !== null && (
            <ColorField label="Fill" value={fill} disabled={disabled} onPreview={(value) => preview({ fill: value })} onCommit={(value) => update({ fill: value })}
              onRemove={texts.length === nodes.length ? undefined : () => update({ fill: null })} />
          )}
        </Section>
      )}
      {texts.length < nodes.length && (
        <Section title="Stroke" action={!readOnly && stroke === null && (
          <button type="button" className={cn(iconToggle, "max-w-7 flex-none")} aria-label="Add stroke" onClick={() => update((node) => ({ stroke: "#111111", strokeWidth: node.strokeWidth || 1 }))}><Plus size={13} /></button>
        )}>
          {stroke !== null && (
            <>
              <ColorField label="Stroke" value={stroke} disabled={disabled} onPreview={(value) => preview({ stroke: value })} onCommit={(value) => update({ stroke: value })}
                onRemove={strokeOnly ? undefined : () => update({ stroke: null })} />
              <NumberField label="≡" value={same(nodes.map((node) => node.strokeWidth))} min={0} max={1000} disabled={disabled} onCommit={(strokeWidth) => update({ strokeWidth })} />
            </>
          )}
        </Section>
      )}
      <Section title="Opacity">
        <NumberField label="%" value={(() => { const value = same(nodes.map((node) => node.opacity)); return value === undefined ? undefined : Math.round(value * 100); })()} min={0} max={100} disabled={disabled}
          onCommit={(value) => update({ opacity: value / 100 })} />
      </Section>
      {nodes.every((node) => node.type === "image") && (
        <Section title="Image">
          <Toggles label="Image fit" value={same(nodes.map((node) => node.imageFit))} disabled={disabled} onChange={(imageFit) => update({ imageFit })}
            options={[{ value: "cover", label: "Fill", title: "Fill the box" }, { value: "contain", label: "Fit", title: "Fit inside the box" }]} />
        </Section>
      )}
      {exportSection}
    </div>
  );
}
