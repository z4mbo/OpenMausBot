import type { CanvasNode, CornerRadii, Gradient } from "./canvas-scene.ts";

const round = (value: number) => Math.round(value * 100) / 100;

/** The node's corner radii clamped to its size, or null when every corner is square. */
export function cornerRadii(node: Pick<CanvasNode, "width" | "height" | "radius" | "radii">): CornerRadii | null {
  const limit = Math.max(0, Math.min(node.width, node.height) / 2);
  const raw = node.radii ?? [node.radius, node.radius, node.radius, node.radius];
  const radii = raw.map((value) => Math.max(0, Math.min(value, limit))) as CornerRadii;
  return radii.some((value) => value > 0) ? radii : null;
}

/** Whether the corners differ, so the shape needs a path rather than a rounded rect. */
export const unevenCorners = (radii: CornerRadii | null) => Boolean(radii && radii.some((value) => value !== radii[0]));

/** A rectangle with per-corner radii as SVG path data, from 0, 0. */
export function roundedRectPath(width: number, height: number, radii: CornerRadii): string {
  const [tl, tr, br, bl] = radii.map(round);
  const w = round(width);
  const h = round(height);
  const arc = (r: number, x: number, y: number) => (r ? `A${r} ${r} 0 0 1 ${x} ${y}` : "");
  return `M${tl} 0H${round(w - tr)}${arc(tr, w, tr)}V${round(h - br)}${arc(br, round(w - br), h)}H${bl}${arc(bl, 0, round(h - bl))}V${tl}${arc(tl, tl, 0)}Z`;
}

/** The CSS border-radius of per-corner radii, each length written by `length`. */
export const cssRadii = (radii: CornerRadii, length: (value: number) => string) => radii.map(length).join(" ");

/**
 * The ends of a linear gradient in the node's own coordinates, matching CSS `linear-gradient`: the line runs through the
 * centre at `angle` and is long enough that the corners take the first and last stops.
 */
export function gradientLine(gradient: Gradient, width: number, height: number) {
  const angle = (gradient.angle * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  return { x1: round(width / 2 - dx * half), y1: round(height / 2 - dy * half), x2: round(width / 2 + dx * half), y2: round(height / 2 + dy * half) };
}

const stopColor = (color: string) => ({ color: color.slice(0, 7), opacity: color.length === 9 ? round(parseInt(color.slice(7), 16) / 255) : 1 });

/** The stops as SVG `<stop>` attributes. */
export const gradientStops = (gradient: Gradient) => gradient.stops.map((stop) => ({ offset: round(stop.at), ...stopColor(stop.color) }));

/** A standalone SVG gradient definition with this id, for a node `width` by `height`. */
export function gradientSvg(id: string, gradient: Gradient, width: number, height: number): string {
  const stops = gradientStops(gradient).map((stop) => `<stop offset="${stop.offset}" stop-color="${stop.color}"${stop.opacity < 1 ? ` stop-opacity="${stop.opacity}"` : ""}/>`).join("");
  if (gradient.kind === "radial") return `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient>`;
  const line = gradientLine(gradient, width, height);
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}">${stops}</linearGradient>`;
}

/** The gradient as a CSS background-image. */
export function gradientCss(gradient: Gradient): string {
  const stops = gradient.stops.map((stop) => `${stop.color} ${round(stop.at * 100)}%`).join(", ");
  return gradient.kind === "radial" ? `radial-gradient(closest-side, ${stops})` : `linear-gradient(${round(gradient.angle + 90)}deg, ${stops})`;
}

/** The stops left to right as a CSS background, for a swatch. */
export const gradientSwatch = (gradient: Gradient) => `linear-gradient(90deg, ${gradient.stops.map((stop) => `${stop.color} ${round(stop.at * 100)}%`).join(", ")})`;

export type ImagePlacement =
  | { kind: "fit"; preserve: "xMidYMid slice" | "xMidYMid meet" | "none" }
  | { kind: "crop"; x: number; y: number; width: number; height: number }
  | { kind: "tile"; width: number; height: number };

/** Where an image node draws its picture, in its own coordinates. */
export function imagePlacement(node: Pick<CanvasNode, "width" | "height" | "imageFit" | "crop">): ImagePlacement {
  if (node.imageFit === "crop") {
    const crop = node.crop ?? { scale: 1, x: 0, y: 0 };
    return { kind: "crop", x: round(crop.x * node.width), y: round(crop.y * node.height), width: round(crop.scale * node.width), height: round(crop.scale * node.height) };
  }
  if (node.imageFit === "tile") {
    const scale = node.crop?.scale ?? 0.25;
    return { kind: "tile", width: round(Math.max(1, scale * node.width)), height: round(Math.max(1, scale * node.height)) };
  }
  return { kind: "fit", preserve: node.imageFit === "contain" ? "xMidYMid meet" : node.imageFit === "stretch" ? "none" : "xMidYMid slice" };
}

/** The image of a node as SVG markup inside its box, `defs` collecting any pattern it needs. */
export function imageSvg(node: Pick<CanvasNode, "id" | "width" | "height" | "imageFit" | "crop">, href: string, prefix: string, defs: string[]): string {
  const place = imagePlacement(node);
  if (place.kind === "fit") return `<image href="${href}" width="${round(node.width)}" height="${round(node.height)}" preserveAspectRatio="${place.preserve}"/>`;
  if (place.kind === "crop") return `<image href="${href}" x="${place.x}" y="${place.y}" width="${place.width}" height="${place.height}" preserveAspectRatio="xMidYMid slice"/>`;
  const id = `${prefix}tile-${node.id}`;
  defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${place.width}" height="${place.height}"><image href="${href}" width="${place.width}" height="${place.height}" preserveAspectRatio="xMidYMid slice"/></pattern>`);
  return `<rect width="${round(node.width)}" height="${round(node.height)}" fill="url(#${id})"/>`;
}
