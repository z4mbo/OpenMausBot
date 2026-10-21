import { brandFont } from "./brand-fonts.ts";
import { brandPalette, type BrandKit } from "./brand-kit.ts";
import { isLive, type CanvasNode, type Scene } from "./canvas-scene.ts";

/** A text style: the brand kit's heading or body face at a fixed size, weight and line height. */
export interface TextStyle { id: string; name: string; role: "heading" | "body"; fontSize: number; fontWeight: number; lineHeight: number }

export const TEXT_STYLES: readonly TextStyle[] = [
  { id: "display", name: "Display", role: "heading", fontSize: 64, fontWeight: 700, lineHeight: 1.05 },
  { id: "h1", name: "Heading 1", role: "heading", fontSize: 44, fontWeight: 700, lineHeight: 1.1 },
  { id: "h2", name: "Heading 2", role: "heading", fontSize: 32, fontWeight: 600, lineHeight: 1.15 },
  { id: "h3", name: "Heading 3", role: "heading", fontSize: 22, fontWeight: 600, lineHeight: 1.25 },
  { id: "body-lg", name: "Body large", role: "body", fontSize: 18, fontWeight: 400, lineHeight: 1.5 },
  { id: "body", name: "Body", role: "body", fontSize: 16, fontWeight: 400, lineHeight: 1.5 },
  { id: "small", name: "Small", role: "body", fontSize: 14, fontWeight: 400, lineHeight: 1.45 },
  { id: "caption", name: "Caption", role: "body", fontSize: 12, fontWeight: 500, lineHeight: 1.35 },
];

export const textStyle = (id: string | undefined) => TEXT_STYLES.find((style) => style.id === id);

/** A colour style: a named brand kit colour. */
export interface ColorStyle { id: string; name: string; color: string }

const FALLBACK = { primary: "#6366F1", secondary: "#14B8A6", neutrals: ["#FFFFFF", "#F4F4F5", "#71717A", "#111111"] };

/** The colour styles of a kit (or a neutral default set without one): primary, secondary, background, text and each neutral. */
export function colorStyles(kit: Pick<BrandKit, "colors"> | null | undefined): ColorStyle[] {
  const palette = brandPalette(kit ?? { colors: FALLBACK });
  return [
    { id: "primary", name: "Primary", color: palette.primary },
    { id: "on-primary", name: "On primary", color: palette.onPrimary },
    { id: "secondary", name: "Secondary", color: palette.secondary },
    { id: "background", name: "Background", color: palette.background },
    { id: "text", name: "Text", color: palette.text },
    ...palette.neutrals.map((color, at) => ({ id: `neutral-${at + 1}`, name: `Neutral ${at + 1}`, color })),
  ];
}

/** The patch that puts a text node in a text style, in the kit's face for the style's role when there is a kit. */
export function textStylePatch(style: TextStyle, kit: Pick<BrandKit, "fonts"> | null | undefined): Partial<CanvasNode> {
  const family = kit?.fonts[style.role];
  return {
    textStyle: style.id, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight,
    ...(family ? { family, font: brandFont(family)?.fallback ?? "sans" } : {}),
  };
}

/** Every node bound to a style whose properties drifted from it (after the kit changed), as new objects. */
export function restyle(scene: Scene, kit: Pick<BrandKit, "colors" | "fonts"> | null | undefined): CanvasNode[] {
  const colors = new Map(colorStyles(kit).map((style) => [style.id, style.color]));
  const out: CanvasNode[] = [];
  for (const node of scene.values()) {
    if (!isLive(node) || node.locked || (!node.fillStyle && !node.strokeStyle && !node.textStyle)) continue;
    const patch: Partial<CanvasNode> = {};
    const fill = node.fillStyle ? colors.get(node.fillStyle) : undefined;
    if (fill && fill !== node.fill) patch.fill = fill;
    const stroke = node.strokeStyle ? colors.get(node.strokeStyle) : undefined;
    if (stroke && stroke !== node.stroke) patch.stroke = stroke;
    const style = node.type === "text" ? textStyle(node.textStyle) : undefined;
    if (style) {
      const wanted = textStylePatch(style, kit);
      for (const key of ["fontSize", "fontWeight", "lineHeight", "family", "font"] as const) if (wanted[key] !== undefined && wanted[key] !== node[key]) Object.assign(patch, { [key]: wanted[key] });
    }
    if (Object.keys(patch).length) out.push({ ...node, ...patch, ...(style && (patch.fontSize || patch.family) ? { unmeasured: true } : {}) });
  }
  return out;
}

/** Drops style bindings the person broke by setting a property by hand. */
export function unbindEdited(node: CanvasNode, previous: CanvasNode | undefined): CanvasNode {
  if (!previous) return node;
  let next = node;
  if (node.fillStyle && node.fillStyle === previous.fillStyle && node.fill !== previous.fill) { const { fillStyle: _fill, ...rest } = next; next = rest; }
  if (node.strokeStyle && node.strokeStyle === previous.strokeStyle && node.stroke !== previous.stroke) { const { strokeStyle: _stroke, ...rest } = next; next = rest; }
  if (node.textStyle && node.textStyle === previous.textStyle && (node.fontSize !== previous.fontSize || node.fontWeight !== previous.fontWeight || node.lineHeight !== previous.lineHeight)) {
    const { textStyle: _text, ...rest } = next;
    next = rest;
  }
  return next;
}
