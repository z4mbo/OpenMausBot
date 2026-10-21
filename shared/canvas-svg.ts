import { FONT_STACKS, childrenIndex, descendants, effectiveParent, estimateTextWidth, fontStack, layoutText, worldOrigin, type CanvasNode, type Scene, type TextMeasure } from "./canvas-scene.ts";
import { LEAD_FIELD_LABELS, LEAD_FORM_METRICS, arrowHead, escapeHtml, leadFormColors, pathData } from "./canvas-page.ts";
import { cornerRadii, gradientSvg, imageSvg, roundedRectPath, unevenCorners } from "./canvas-paint.ts";
import { booleanGroupPath } from "./canvas-boolean-group.ts";

type Index = ReadonlyMap<string | null, readonly CanvasNode[]>;

export interface SvgDocument { svg: string; width: number; height: number; x: number; y: number }

const round = (value: number) => Math.round(value * 100) / 100;
const attr = (name: string, value: string | number | null | undefined) => (value === undefined || value === null || value === "" ? "" : ` ${name}="${typeof value === "number" ? round(value) : escapeHtml(value)}"`);

interface Context { index: Index; images: ReadonlyMap<string, string>; measure: TextMeasure; defs: string[]; prefix: string }

function rotatedBox(node: CanvasNode) {
  if (!node.rotation) return { x: 0, y: 0, width: node.width, height: node.height };
  const angle = (node.rotation * Math.PI) / 180;
  const cx = node.width / 2;
  const cy = node.height / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [[0, 0], [node.width, 0], [node.width, node.height], [0, node.height]] as const) {
    xs.push(cx + (px - cx) * Math.cos(angle) - (py - cy) * Math.sin(angle));
    ys.push(cy + (px - cx) * Math.sin(angle) + (py - cy) * Math.cos(angle));
  }
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function effects(node: CanvasNode, context: Context): string {
  if (!node.shadow && !node.blur) return "";
  const id = `${context.prefix}fx-${node.id}`;
  const parts: string[] = [];
  if (node.shadow) {
    const { x, y, blur, color } = node.shadow;
    parts.push(`<feDropShadow dx="${round(x)}" dy="${round(y)}" stdDeviation="${round(blur / 2)}" flood-color="${color.slice(0, 7)}" flood-opacity="${color.length === 9 ? round(parseInt(color.slice(7), 16) / 255) : 1}"/>`);
  }
  if (node.blur) parts.push(`<feGaussianBlur stdDeviation="${round(node.blur / 2)}"/>`);
  context.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.join("")}</filter>`);
  return ` filter="url(#${id})"`;
}

/** The node's fill attribute value: a gradient defined in `defs`, its colour, or `fallback`. */
function paint(node: CanvasNode, context: Context, fallback: string): string {
  if (!node.gradient) return node.fill ?? fallback;
  const id = `${context.prefix}grad-${node.id}`;
  context.defs.push(gradientSvg(id, node.gradient, node.width, node.height));
  return `url(#${id})`;
}

/** The node's box with its corners, as a rect or a path when the corners differ. */
function box(node: CanvasNode, rest: string): string {
  const radii = cornerRadii(node);
  if (radii && unevenCorners(radii)) return `<path d="${roundedRectPath(node.width, node.height, radii)}"${rest}/>`;
  return `<rect width="${round(node.width)}" height="${round(node.height)}"${radii ? attr("rx", radii[0]) : ""}${rest}/>`;
}

function text(node: CanvasNode, context: Context): string {
  const layout = layoutText(node, context.measure);
  const size = node.fontSize ?? 16;
  const anchor = node.align === "center" ? "middle" : node.align === "right" ? "end" : "start";
  const x = node.align === "center" ? node.width / 2 : node.align === "right" ? node.width : 0;
  const lines = layout.lines.map((line, index) => `<tspan x="${round(x)}" y="${round(index * layout.lineHeight + layout.lineHeight / 2 + size * 0.35)}">${escapeHtml(line || " ")}</tspan>`).join("");
  return `<text${attr("fill", paint(node, context, "none"))}${attr("font-size", size)}${attr("font-weight", node.fontWeight)}${attr("font-family", fontStack(node))}${attr("text-anchor", anchor)} xml:space="preserve">${lines}</text>`;
}

function leadForm(node: CanvasNode, surface: string): string {
  const form = node.leadForm!;
  const colors = leadFormColors(form, node.fill ?? surface);
  let y = 0;
  let out = "";
  for (const field of form.fields) {
    const height = field === "message" ? LEAD_FORM_METRICS.message : LEAD_FORM_METRICS.field;
    out += `<rect y="${y}" width="${round(node.width)}" height="${height}" rx="${LEAD_FORM_METRICS.radius}" fill="${colors.field}" stroke="${colors.border}"/>`
      + `<text x="14" y="${y + 27}" font-size="16" font-family="${escapeHtml(FONT_STACKS.sans)}" fill="${colors.placeholder}">${LEAD_FIELD_LABELS[field]}</text>`;
    y += height + LEAD_FORM_METRICS.gap;
  }
  return `${out}<rect y="${y}" width="${round(node.width)}" height="${LEAD_FORM_METRICS.button}" rx="${LEAD_FORM_METRICS.radius}" fill="${colors.button}"/>`
    + `<text x="${round(node.width / 2)}" y="${y + 27}" text-anchor="middle" font-size="16" font-weight="600" font-family="${escapeHtml(FONT_STACKS.sans)}" fill="${colors.buttonText}">${escapeHtml(form.button)}</text>`;
}

function shape(node: CanvasNode, context: Context, surface: string): string {
  const stroke = node.stroke && node.strokeWidth > 0 ? `${attr("stroke", node.stroke)}${attr("stroke-width", node.strokeWidth)}` : "";
  switch (node.type) {
    case "rect": case "frame":
      return `${box(node, `${attr("fill", paint(node, context, "none"))}${stroke}`)}${node.leadForm ? leadForm(node, surface) : ""}`;
    case "ellipse":
      return `<ellipse cx="${round(node.width / 2)}" cy="${round(node.height / 2)}" rx="${round(node.width / 2)}" ry="${round(node.height / 2)}"${attr("fill", paint(node, context, "none"))}${stroke}/>`;
    case "group":
      return node.boolean ? `<path d="${booleanGroupPath(node, context.index)}" fill-rule="evenodd" stroke-linejoin="round"${attr("fill", paint(node, context, "none"))}${stroke}/>` : "";
    case "text":
      return text(node, context);
    case "line": case "arrow": case "path": {
      const points = node.points ?? [0, 0, node.width, node.height];
      const width = Math.max(node.strokeWidth, 0.5);
      const fill = node.type === "path" && node.closed && (node.fill || node.gradient) ? paint(node, context, "none") : "none";
      const head = node.type === "arrow" && points.length >= 4 ? `<path d="${arrowHead(points, Math.max(8, width * 3.5))}"${attr("fill", node.stroke ?? "none")}${attr("stroke", node.stroke ?? "none")} stroke-width="${round(width)}" stroke-linejoin="round"/>` : "";
      return `<path d="${pathData(points, node.closed, node.curves, node.breaks)}" fill="${fill}" fill-rule="evenodd"${attr("stroke", node.stroke ?? "none")} stroke-width="${round(width)}" stroke-linecap="round" stroke-linejoin="round"/>${head}`;
    }
    case "image": {
      const url = node.fileId ? context.images.get(node.fileId) : undefined;
      const clip = `${context.prefix}img-${node.id}`;
      const clipped = Boolean(cornerRadii(node)) || node.imageFit === "crop";
      if (clipped) context.defs.push(`<clipPath id="${clip}">${box(node, "")}</clipPath>`);
      const inner = url ? imageSvg(node, escapeHtml(url), context.prefix, context.defs) : `<rect width="${round(node.width)}" height="${round(node.height)}" fill="${node.fill ?? "#E5E7EB"}"/>`;
      return `<g${clipped ? ` clip-path="url(#${clip})"` : ""}>${inner}</g>${stroke ? box(node, ` fill="none"${stroke}`) : ""}`;
    }
    default:
      return "";
  }
}

function render(node: CanvasNode, context: Context, surface: string): string {
  if (node.hidden || node.deleted) return "";
  const children = node.leadForm ? [] : context.index.get(node.id) ?? [];
  const transform = `translate(${round(node.x)} ${round(node.y)})${node.rotation ? ` rotate(${round(node.rotation)} ${round(node.width / 2)} ${round(node.height / 2)})` : ""}`;
  let inner = shape(node, context, surface);
  if (children.length && !node.boolean) {
    const clipId = node.type === "frame" && node.clip ? `${context.prefix}clip-${node.id}` : null;
    if (clipId) context.defs.push(`<clipPath id="${clipId}">${box(node, "")}</clipPath>`);
    inner += `<g${clipId ? ` clip-path="url(#${clipId})"` : ""}>${children.map((child) => render(child, context, node.fill ?? surface)).join("")}</g>`;
  }
  return `<g transform="${transform}"${node.opacity < 1 ? attr("opacity", node.opacity) : ""}${effects(node, context)}>${inner}</g>`;
}

/**
 * The given nodes (or every top-level node of `pageRoots`) as one standalone SVG document cropped to their bounds.
 * `images` maps file ids to URLs the consumer can load (data URLs for a self-contained file); `background` paints behind everything.
 */
export function sceneSvg(scene: Scene, ids: readonly string[], options: { images?: ReadonlyMap<string, string>; measure?: TextMeasure; background?: string; padding?: number; roots?: readonly CanvasNode[] } = {}): SvgDocument | null {
  const index = childrenIndex(scene);
  const chosen = new Set(ids);
  const roots = (ids.length ? ids.map((id) => scene.get(id)).filter((node): node is CanvasNode => Boolean(node && !node.deleted))
    .filter((node) => { let parent = effectiveParent(scene, node); while (parent) { if (chosen.has(parent)) return false; parent = effectiveParent(scene, scene.get(parent)!); } return true; })
    : [...(options.roots ?? index.get(null) ?? [])]).filter((node) => !node.hidden);
  if (!roots.length) return null;
  const boxes = roots.map((node) => { const origin = worldOrigin(scene, node); const box = rotatedBox(node); return { x: origin.x + box.x, y: origin.y + box.y, right: origin.x + box.x + box.width, bottom: origin.y + box.y + box.height }; });
  const pad = options.padding ?? 0;
  const x = Math.min(...boxes.map((box) => box.x)) - pad;
  const y = Math.min(...boxes.map((box) => box.y)) - pad;
  const width = Math.ceil(Math.max(...boxes.map((box) => box.right)) + pad - x);
  const height = Math.ceil(Math.max(...boxes.map((box) => box.bottom)) + pad - y);
  if (width < 1 || height < 1) return null;
  const context: Context = { index, images: options.images ?? new Map(), measure: options.measure ?? estimateTextWidth, defs: [], prefix: "e-" };
  const body = roots.map((node) => {
    const parent = effectiveParent(scene, node);
    const origin = parent ? worldOrigin(scene, scene.get(parent)!) : { x: 0, y: 0 };
    return `<g transform="translate(${round(origin.x - x)} ${round(origin.y - y)})">${render(node, context, "#FFFFFF")}</g>`;
  }).join("");
  const background = options.background ? `<rect width="${width}" height="${height}" fill="${escapeHtml(options.background)}"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `${context.defs.length ? `<defs>${context.defs.join("")}</defs>` : ""}${background}${body}</svg>`;
  return { svg, width, height, x, y };
}

/** Every image file id used by the nodes and their descendants. */
export function imageIds(scene: Scene, ids: readonly string[]): string[] {
  const index = childrenIndex(scene);
  const found = new Set<string>();
  const roots = ids.length ? ids : (index.get(null) ?? []).map((node) => node.id);
  for (const id of roots) for (const node of [scene.get(id), ...descendants(scene, id, index)]) if (node?.type === "image" && node.fileId) found.add(node.fileId);
  return [...found];
}
