import { Minus, Plus, Scan, Square } from "lucide-react";
import type { CanvasNode, CornerRadii, Gradient, ImageFit } from "../../../../shared/canvas-scene";
import { gradientSwatch } from "../../../../shared/canvas-paint";
import type { BrandKit } from "../../../../shared/brand-kit";
import { cn } from "@/lib/cn";
import { ColorField, NumberField, Section, Toggles, iconToggle } from "./controls";
import { StyleChip } from "./InspectorExtras";

type Update = (patch: Partial<CanvasNode> | ((node: CanvasNode) => Partial<CanvasNode>)) => void;
type Paint = "solid" | "linear" | "radial";

const same = <T,>(values: readonly T[]): T | undefined => (values.every((value) => value === values[0]) ? values[0] : undefined);
const add = cn(iconToggle, "max-w-7 flex-none");

/** A two-stop gradient from a solid colour: the colour fading to a lighter, transparent copy of itself. */
export function gradientFrom(color: string | null, kind: Gradient["kind"], angle = 90): Gradient {
  const base = (color ?? "#7C7CF8").slice(0, 7);
  return { kind, angle, stops: [{ at: 0, color: base }, { at: 1, color: `${base}00` }] };
}

/** Fill (or text colour): solid with its colour style, or a linear or radial gradient with editable stops. */
export function FillSection({ nodes, brand, readOnly, disabled, update, preview, text }: {
  nodes: readonly CanvasNode[]; brand?: BrandKit | null; readOnly: boolean; disabled: boolean; update: Update; preview(patch: Partial<CanvasNode>): void; text: boolean;
}) {
  const fill = same(nodes.map((node) => node.fill));
  const fillStyle = same(nodes.map((node) => node.fillStyle));
  const gradient = nodes.length === 1 ? nodes[0]!.gradient : same(nodes.map((node) => node.gradient));
  const kind: Paint | undefined = gradient ? gradient.kind : nodes.some((node) => node.gradient) ? undefined : "solid";
  const empty = fill === null && !gradient;
  const setKind = (next: Paint) => update((node) => (next === "solid"
    ? { gradient: undefined, fill: node.fill ?? node.gradient?.stops[0]?.color.slice(0, 7) ?? "#D9D9D9" }
    : { gradient: node.gradient ? { ...node.gradient, kind: next } : gradientFrom(node.fill, next), fillStyle: undefined }));
  const setGradient = (next: Gradient) => update({ gradient: next, fillStyle: undefined });
  return (
    <Section title={text ? "Colour" : "Fill"} action={!readOnly && empty && (
      <button type="button" className={add} aria-label="Add fill" onClick={() => update({ fill: text ? "#111111" : "#D9D9D9" })}><Plus size={13} /></button>
    )}>
      {!empty && !readOnly && (
        <Toggles<Paint> label="Fill type" value={kind} disabled={disabled} onChange={setKind}
          options={[{ value: "solid", label: "Solid", title: "Solid colour" }, { value: "linear", label: "Linear", title: "Linear gradient" }, { value: "radial", label: "Radial", title: "Radial gradient" }]} />
      )}
      {gradient ? <GradientEditor gradient={gradient} disabled={disabled} onChange={setGradient} onRemove={text ? undefined : () => update({ gradient: undefined, fill: null })} />
        : fillStyle ? <StyleChip id={fillStyle} kit={brand} disabled={disabled} onDetach={() => update({ fillStyle: undefined })} />
        : fill !== null && (
          <ColorField label="Fill" value={fill} disabled={disabled} onPreview={(value) => preview({ fill: value })} onCommit={(value) => update({ fill: value })}
            onRemove={text ? undefined : () => update({ fill: null })} />
        )}
    </Section>
  );
}

function GradientEditor({ gradient, disabled, onChange, onRemove }: { gradient: Gradient; disabled: boolean; onChange(gradient: Gradient): void; onRemove?: () => void }) {
  const stops = gradient.stops;
  const setStop = (at: number, patch: Partial<Gradient["stops"][number]>) => onChange({ ...gradient, stops: stops.map((stop, index) => (index === at ? { ...stop, ...patch } : stop)).sort((a, b) => a.at - b.at) });
  const addStop = () => {
    const widest = stops.slice(1).reduce((best, stop, index) => (stop.at - stops[index]!.at > stops[best + 1]!.at - stops[best]!.at ? index : best), 0);
    const a = stops[widest]!;
    const b = stops[widest + 1] ?? a;
    onChange({ ...gradient, stops: [...stops, { at: (a.at + b.at) / 2, color: a.color }].sort((x, y) => x.at - y.at) });
  };
  return (
    <>
      <div className="flex items-center gap-1">
        <div aria-hidden="true" className="h-5 flex-1 rounded-[4px] border border-hairline/60" style={{ background: gradientSwatch(gradient) }} />
        {gradient.kind === "linear" && <div className="w-[76px]"><NumberField label="∠" name="Gradient angle" value={gradient.angle} min={-360} max={360} disabled={disabled} suffix="°" onCommit={(angle) => onChange({ ...gradient, angle })} /></div>}
        {onRemove && <button type="button" className={add} aria-label="Remove fill" disabled={disabled} onClick={onRemove}><Minus size={13} /></button>}
      </div>
      {stops.map((stop, at) => (
        <div key={at} className="grid grid-cols-[64px_1fr_28px] items-center gap-1" data-gradient-stop={at}>
          <NumberField label="" name={`Stop ${at + 1} position`} value={Math.round(stop.at * 100)} min={0} max={100} disabled={disabled} suffix="%" onCommit={(value) => setStop(at, { at: value / 100 })} />
          <ColorField label={`Stop ${at + 1}`} value={stop.color} disabled={disabled} onPreview={() => {}} onCommit={(color) => setStop(at, { color })} />
          <button type="button" className={add} aria-label={`Remove stop ${at + 1}`} disabled={disabled || stops.length <= 2} onClick={() => onChange({ ...gradient, stops: stops.filter((_, index) => index !== at) })}><Minus size={12} /></button>
        </div>
      ))}
      {stops.length < 8 && <button type="button" className={cn(iconToggle, "h-6 max-w-none flex-none gap-1 self-start px-2 text-[11.5px]")} disabled={disabled} onClick={addStop}><Plus size={12} />Stop</button>}
    </>
  );
}

const CORNERS = ["Top left", "Top right", "Bottom right", "Bottom left"] as const;
const CORNER_GLYPHS = ["⌜", "⌝", "⌟", "⌞"] as const;

/** Corner radius: one value, or each corner on its own. */
export function CornerFields({ nodes, disabled, update }: { nodes: readonly CanvasNode[]; disabled: boolean; update: Update }) {
  const single = nodes.length === 1 ? nodes[0]! : null;
  const radii = single?.radii;
  const expanded = Boolean(radii);
  const toggle = () => update((node) => (node.radii ? { radii: undefined, radius: node.radii[0] } : { radii: [node.radius, node.radius, node.radius, node.radius] as CornerRadii }));
  return (
    <>
      <div className="flex items-center gap-1">
        <div className="flex-1">
          {expanded ? <p className="px-1 text-[12px] text-ink-secondary">Corners</p>
            : <NumberField label="R" value={same(nodes.map((node) => node.radius))} min={0} disabled={disabled} onCommit={(radius) => update({ radius, radii: undefined })} />}
        </div>
        {single && (
          <button type="button" className={cn(add, expanded && "bg-raised text-ink")} aria-pressed={expanded} aria-label="Independent corners" title="Independent corners" disabled={disabled} onClick={toggle}>
            {expanded ? <Square size={13} /> : <Scan size={13} />}
          </button>
        )}
      </div>
      {radii && (
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Corner radii">
          {CORNERS.map((corner, at) => (
            <NumberField key={corner} label={CORNER_GLYPHS[at]} name={`${corner} radius`} value={Math.round(radii[at] * 100) / 100} min={0} disabled={disabled}
              onCommit={(value) => update((node) => ({ radii: (node.radii ?? [node.radius, node.radius, node.radius, node.radius]).map((item, index) => (index === at ? value : item)) as CornerRadii }))} />
          ))}
        </div>
      )}
    </>
  );
}

const FITS: readonly { value: ImageFit; label: string; title: string }[] = [
  { value: "cover", label: "Fill", title: "Fill the box" }, { value: "contain", label: "Fit", title: "Fit inside the box" },
  { value: "stretch", label: "Stretch", title: "Stretch to the box" }, { value: "crop", label: "Crop", title: "Crop: zoom and move the image" },
  { value: "tile", label: "Tile", title: "Repeat the image" },
];

/** How images sit in their box, with the crop's zoom and position or the tile size. */
export function ImageSection({ nodes, disabled, update }: { nodes: readonly CanvasNode[]; disabled: boolean; update: Update }) {
  const fit = same(nodes.map((node) => node.imageFit ?? "cover"));
  const single = nodes.length === 1 ? nodes[0]! : null;
  const crop = single?.crop;
  const setCrop = (patch: Partial<NonNullable<CanvasNode["crop"]>>) => update((node) => {
    const current = node.crop ?? { scale: node.imageFit === "tile" ? 0.25 : 1, x: 0, y: 0 };
    const next = { ...current, ...patch };
    if (node.imageFit === "crop") Object.assign(next, { x: Math.min(0, Math.max(1 - next.scale, next.x)), y: Math.min(0, Math.max(1 - next.scale, next.y)) });
    return { crop: next };
  });
  return (
    <Section title="Image">
      <Toggles label="Image fit" value={fit} disabled={disabled} options={FITS}
        onChange={(imageFit) => update({ imageFit, crop: imageFit === "crop" ? { scale: 1.25, x: -0.125, y: -0.125 } : imageFit === "tile" ? { scale: 0.25, x: 0, y: 0 } : undefined })} />
      {single && fit === "crop" && crop && (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <NumberField label="⤢" name="Crop zoom" value={Math.round(crop.scale * 100)} min={100} max={1000} step={5} suffix="%" disabled={disabled} onCommit={(value) => setCrop({ scale: value / 100, x: crop.x - (value / 100 - crop.scale) / 2, y: crop.y - (value / 100 - crop.scale) / 2 })} />
            <NumberField label="X" name="Crop X" value={Math.round(-crop.x * 100)} min={0} max={Math.round((crop.scale - 1) * 100)} suffix="%" disabled={disabled} onCommit={(value) => setCrop({ x: -value / 100 })} />
            <NumberField label="Y" name="Crop Y" value={Math.round(-crop.y * 100)} min={0} max={Math.round((crop.scale - 1) * 100)} suffix="%" disabled={disabled} onCommit={(value) => setCrop({ y: -value / 100 })} />
          </div>
          <p className="text-[11.5px] text-ink-tertiary">Press Enter on the canvas, then drag the image to move it.</p>
        </>
      )}
      {single && fit === "tile" && crop && (
        <NumberField label="⊞" name="Tile size" value={Math.round(crop.scale * 100)} min={5} max={100} step={5} suffix="%" disabled={disabled} onCommit={(value) => setCrop({ scale: value / 100 })} />
      )}
    </Section>
  );
}
