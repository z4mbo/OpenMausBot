import { brandFont } from "./brand-fonts.ts";
import { brandPalette, contrastRatio, relativeLuminance, type BrandKit, type BrandPalette } from "./brand-kit.ts";
import { childrenIndex, descendants, effectiveParent, isLive, type CanvasNode, type Scene } from "./canvas-scene.ts";

export type TextRole = "heading" | "body";

/** Large or bold text reads as a heading; everything else as body copy. */
export const textRole = (node: Pick<CanvasNode, "fontSize" | "fontWeight">): TextRole =>
  (node.fontSize ?? 16) >= 24 || ((node.fontWeight ?? 400) >= 600 && (node.fontSize ?? 16) >= 20) ? "heading" : "body";

/** The patch that sets a text node in the kit's face for its role. */
export function brandTextStyle(kit: Pick<BrandKit, "fonts">, role: TextRole): Pick<CanvasNode, "family" | "font"> {
  const id = kit.fonts[role];
  return { family: id, font: brandFont(id)?.fallback ?? "sans" };
}

/** The kit's colours as Canvas swatches, background and text first. */
export function brandSwatches(kit: Pick<BrandKit, "colors">): { label: string; color: string }[] {
  const palette = brandPalette(kit);
  const seen = new Set<string>();
  return [
    { label: "Primary", color: palette.primary }, { label: "Secondary", color: palette.secondary },
    { label: "Background", color: palette.background }, { label: "Text", color: palette.text },
    ...palette.neutrals.map((color) => ({ label: "Neutral", color })),
  ].filter((swatch) => !seen.has(swatch.color) && seen.add(swatch.color));
}

function saturation(hex: string): { saturation: number; lightness: number } {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  return { lightness, saturation: chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1)) };
}

const solid = (color: string | null | undefined): string | null => (color && /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7).toUpperCase() : null);

function isAccent(color: string): boolean {
  const { saturation: s, lightness: l } = saturation(color);
  return s > 0.25 && l > 0.12 && l < 0.9;
}

function nearestNeutral(color: string, neutrals: readonly string[]): string {
  const target = relativeLuminance(color);
  return [...neutrals].sort((a, b) => Math.abs(relativeLuminance(a) - target) - Math.abs(relativeLuminance(b) - target))[0]!;
}

function legibleOn(surface: string, palette: BrandPalette): string {
  if (surface === palette.primary) return palette.onPrimary;
  if (surface === palette.secondary) return palette.onSecondary;
  return [palette.text, palette.background, ...palette.neutrals].sort((a, b) => contrastRatio(b, surface) - contrastRatio(a, surface))[0]!;
}

const areaOf = (node: CanvasNode) => Math.max(1, node.width) * Math.max(1, node.height);

/**
 * The frame `frameId` and everything in it restyled with the kit: accent fills by area become primary then secondary,
 * neutral fills the nearest kit neutral, text the kit's heading or body face in the most legible colour for what it sits on.
 * Returns only the nodes that change, as new objects.
 */
export function applyBrandToFrame(scene: Scene, frameId: string, kit: Pick<BrandKit, "colors" | "fonts">): CanvasNode[] {
  const frame = scene.get(frameId);
  if (!isLive(frame) || frame.type !== "frame") return [];
  const palette = brandPalette(kit);
  const index = childrenIndex(scene);
  const nodes = [frame, ...descendants(scene, frame.id, index)];

  const accentArea = new Map<string, number>();
  for (const node of nodes) {
    if (node.type === "text") continue;
    for (const color of [solid(node.fill), solid(node.stroke)]) if (color && isAccent(color)) accentArea.set(color, (accentArea.get(color) ?? 0) + areaOf(node));
  }
  const ranked = [...accentArea.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  const accents = new Map(ranked.map((color, at) => [color, at === 1 ? palette.secondary : palette.primary]));
  const recolor = (color: string | null, fallback: string | null): string | null => {
    const hex = solid(color);
    if (!hex) return fallback;
    return accents.get(hex) ?? (isAccent(hex) ? palette.primary : nearestNeutral(hex, palette.neutrals));
  };

  const next = new Map<string, CanvasNode>();
  const read = (id: string) => next.get(id) ?? scene.get(id)!;
  for (const node of nodes) {
    if (node.type === "text" || node.locked) continue;
    const patch: Partial<CanvasNode> = {};
    if (node.id === frame.id) patch.fill = node.fill ? recolor(node.fill, null) : palette.background;
    else if (node.fill) patch.fill = recolor(node.fill, null);
    if (node.stroke) patch.stroke = recolor(node.stroke, null);
    if (node.leadForm) patch.leadForm = { ...node.leadForm, accent: palette.primary };
    next.set(node.id, { ...node, ...patch });
  }

  const surfaceOf = (node: CanvasNode): string => {
    let child = node;
    for (;;) {
      const parentId = effectiveParent(scene, child);
      const siblings = index.get(parentId) ?? [];
      const cx = child.x + child.width / 2;
      const cy = child.y + child.height / 2;
      const beneath = siblings.filter((sibling) => sibling.z < child.z && sibling.type !== "text" && !sibling.hidden && read(sibling.id).fill
        && cx >= sibling.x && cx <= sibling.x + sibling.width && cy >= sibling.y && cy <= sibling.y + sibling.height);
      const top = beneath.sort((a, b) => b.z - a.z)[0];
      if (top) return solid(read(top.id).fill) ?? palette.background;
      if (!parentId) return palette.background;
      const parent = read(parentId);
      if (solid(parent.fill)) return solid(parent.fill)!;
      if (parentId === frame.id) return palette.background;
      child = parent;
    }
  };

  for (const node of nodes) {
    if (node.type !== "text" || node.locked) continue;
    const surface = surfaceOf(node);
    const original = solid(node.fill);
    const accent = original && isAccent(original) && contrastRatio(palette.primary, surface) >= 3 ? palette.primary : null;
    next.set(node.id, { ...node, ...brandTextStyle(kit, textRole(node)), fill: accent ?? legibleOn(surface, palette) });
  }

  return [...next.values()].filter((node) => {
    const before = scene.get(node.id)!;
    return before.fill !== node.fill || before.stroke !== node.stroke || before.family !== node.family || before.font !== node.font
      || JSON.stringify(before.leadForm) !== JSON.stringify(node.leadForm);
  });
}
