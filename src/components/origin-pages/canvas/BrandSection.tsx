import { useEffect, useMemo } from "react";
import { SwatchBook } from "lucide-react";
import { brandFont } from "../../../../shared/brand-fonts";
import type { BrandKit } from "../../../../shared/brand-kit";
import { applyBrandToFrame, brandSwatches, brandTextStyle, type TextRole } from "../../../../shared/canvas-brand";
import { isLive, layoutText, type CanvasNode } from "../../../../shared/canvas-scene";
import { useBrandFonts } from "@/lib/origin-brand";
import { cn } from "@/lib/cn";
import { forgetTextWidths, measureText } from "./geometry";
import { Section, iconToggle } from "./controls";
import type { CanvasScene } from "./use-canvas-scene";

/** Loads the kit's faces and every brand face the scene uses, then re-measures the text set in a face that arrived late. */
export function useCanvasBrandFonts(canvas: CanvasScene, kit: BrandKit | null | undefined, readOnly: boolean) {
  const { scene, revision } = canvas;
  const families = useMemo(() => {
    const used = new Set<string>(kit ? [kit.fonts.heading, kit.fonts.body] : []);
    for (const node of scene.values()) if (node.family && isLive(node)) used.add(node.family);
    return [...used];
  }, [scene, revision, kit]);
  const ready = useBrandFonts(families);
  useEffect(() => {
    if (!ready) return;
    forgetTextWidths();
    if (readOnly) return;
    const loaded = new Set(ready.split(","));
    const stale = [...canvas.scene.values()].filter((node) => isLive(node) && node.type === "text" && node.family && loaded.has(node.family) && !node.locked).filter((node) => {
      const size = layoutText(node, measureText);
      return Math.abs(size.height - node.height) > 0.5 || (node.autoWidth && Math.abs(size.width - node.width) > 0.5);
    });
    if (stale.length) canvas.commit(stale.map((node) => ({ ...node, unmeasured: true })), { history: false });
  }, [ready]);
}

export function BrandSection({ canvas, nodes, kit, disabled }: { canvas: CanvasScene; nodes: readonly CanvasNode[]; kit: BrandKit; disabled: boolean }) {
  const editable = nodes.filter((node) => !node.locked);
  const texts = editable.filter((node) => node.type === "text");
  const frame = nodes.length === 1 && nodes[0]!.type === "frame" ? nodes[0]! : null;
  const strokeOnly = editable.length > 0 && editable.every((node) => node.type === "line" || node.type === "arrow");
  const role = (wanted: TextRole) => texts.length > 0 && texts.every((node) => node.family === kit.fonts[wanted]);
  const setRole = (wanted: TextRole) => canvas.commit(texts.map((node) => ({ ...node, ...brandTextStyle(kit, wanted), ...(wanted === "heading" ? { fontWeight: Math.max(node.fontWeight ?? 400, 600) } : {}) })));
  const paint = (color: string) => canvas.commit(editable.map((node) => (strokeOnly ? { ...node, stroke: color, strokeWidth: node.strokeWidth || 1 } : { ...node, fill: color })));
  const applied = frame ? applyBrandToFrame(canvas.scene, frame.id, kit) : [];
  return (
    <Section title="Brand" action={frame && (
      <button type="button" disabled={disabled || !applied.length} onClick={() => canvas.commit(applied)} title={applied.length ? "Restyle this frame with the brand kit's colours and fonts" : "This frame already uses the brand kit"}
        className={cn(iconToggle, "h-6 max-w-none flex-none gap-1 px-2 text-[11.5px]")}>
        <SwatchBook size={12} />Apply brand
      </button>
    )}>
      {texts.length > 0 && (
        <div role="group" aria-label="Brand text style" className="flex gap-0.5 rounded-md bg-inset p-0.5">
          {(["heading", "body"] as const).map((wanted) => (
            <button key={wanted} type="button" aria-pressed={role(wanted)} disabled={disabled} onClick={() => setRole(wanted)}
              title={`${wanted === "heading" ? "Heading" : "Body"} · ${brandFont(kit.fonts[wanted])?.family ?? ""}`}
              className={cn(iconToggle, "h-6 text-[11.5px]", role(wanted) && "bg-raised text-ink")}>{wanted === "heading" ? "Heading" : "Body"}</button>
          ))}
        </div>
      )}
      {editable.length > 0 && (
        <div role="group" aria-label="Brand colours" className="flex flex-wrap gap-1.5">
          {brandSwatches(kit).map((swatch) => (
            <button key={swatch.color} type="button" disabled={disabled} onClick={() => paint(swatch.color)} title={`${swatch.label} ${swatch.color}`} aria-label={`${strokeOnly ? "Stroke" : texts.length === editable.length ? "Text colour" : "Fill"} ${swatch.label.toLowerCase()} ${swatch.color}`}
              className="size-6 rounded-md border border-hairline/60 outline-none transition-transform duration-(--motion-fast) hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40 motion-reduce:hover:scale-100"
              style={{ background: swatch.color }} />
          ))}
        </div>
      )}
    </Section>
  );
}
