export const CANVAS_NODE_TYPES = ["frame", "rect", "ellipse", "line", "arrow", "text", "image", "group", "path"] as const;
export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number];
export type TextAlign = "left" | "center" | "right";
export type CanvasFont = "sans" | "serif" | "mono";
export type StackAlign = "start" | "center" | "end" | "stretch";
export type StackJustify = "start" | "center" | "end" | "between";
export type StackHug = "width" | "height" | "both";
export type Padding = [top: number, right: number, bottom: number, left: number];

/** Auto layout of a frame: its visible children stack in layer order, bottom layer first. */
export interface StackLayout {
  direction: "row" | "column";
  gap: number;
  padding: Padding;
  align: StackAlign;
  justify: StackJustify;
  /** Which of the frame's sides follow its content instead of keeping their size. */
  hug?: StackHug;
}

/**
 * One node of a Canvas scene, stored as one `drawingElements` row. `x` and `y` are relative to the parent's top-left
 * corner; a node without a parent sits on the canvas itself. Rotation turns a leaf around its centre, in degrees.
 * Concurrent writers converge on the higher `version`; equal versions keep the lower `versionNonce`.
 */
export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  version: number;
  versionNonce: number;
  deleted?: boolean;
  parentId: string | null;
  /** Order among siblings: a higher z is drawn above a lower one. */
  z: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  hidden?: boolean;
  locked?: boolean;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  font?: CanvasFont;
  align?: TextAlign;
  lineHeight?: number;
  /** Text grows sideways with its content instead of wrapping at `width`. */
  autoWidth?: boolean;
  /** The text's size is an estimate from a writer that cannot measure fonts; the first editor that renders it measures it. */
  unmeasured?: boolean;
  /** Flat x,y pairs relative to the node's top-left corner, for lines, arrows and paths. */
  points?: number[];
  closed?: boolean;
  fileId?: string;
  imageFit?: "cover" | "contain";
  clip?: boolean;
  layout?: StackLayout;
  /** Inside an auto-layout parent, the node shares the parent's free space along its direction. */
  grow?: boolean;
  link?: string;
}

export const CANVAS_ROW_FORMAT = "canvas";
export const CANVAS_LIMITS = { nodes: 5000, text: 20_000, name: 120, coordinate: 1_000_000, size: 100_000, points: 4000, rowBytes: 64_000 } as const;

export const FRAME_PRESETS = [
  { name: "Desktop", width: 1440, height: 1024 },
  { name: "Laptop", width: 1280, height: 832 },
  { name: "Tablet", width: 834, height: 1194 },
  { name: "Mobile", width: 390, height: 844 },
  { name: "Slide", width: 1920, height: 1080 },
  { name: "Square", width: 1080, height: 1080 },
] as const;

export const FONT_STACKS: Record<CanvasFont, string> = {
  sans: "Inter, ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
  serif: "Georgia, \"Times New Roman\", ui-serif, serif",
  mono: "\"JetBrains Mono\", ui-monospace, \"SF Mono\", Consolas, monospace",
};

const TYPE_NAMES: Record<CanvasNodeType, string> = { frame: "Frame", rect: "Rectangle", ellipse: "Ellipse", line: "Line", arrow: "Arrow", text: "Text", image: "Image", group: "Group", path: "Vector" };
export const typeName = (type: CanvasNodeType) => TYPE_NAMES[type];

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED_COLORS: Record<string, string> = { white: "#FFFFFF", black: "#000000", transparent: "" };

export function canvasColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const named = NAMED_COLORS[trimmed.toLowerCase()];
  if (named !== undefined) return named || null;
  return COLOR.test(trimmed) ? trimmed.toUpperCase() : null;
}

export function randomId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

export const randomNonce = () => Math.floor(Math.random() * 2 ** 31);

const finite = (value: unknown, fallback: number, min: number = -CANVAS_LIMITS.coordinate, max: number = CANVAS_LIMITS.coordinate) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | undefined => (options as readonly unknown[]).includes(value) ? value as T : undefined;
const shortText = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

export function canvasPadding(value: unknown): Padding {
  const clamp = (item: unknown) => finite(item, 0, 0, 10_000);
  if (typeof value === "number") return [clamp(value), clamp(value), clamp(value), clamp(value)];
  if (Array.isArray(value) && value.length === 2) return [clamp(value[0]), clamp(value[1]), clamp(value[0]), clamp(value[1])];
  if (Array.isArray(value) && value.length === 4) return [clamp(value[0]), clamp(value[1]), clamp(value[2]), clamp(value[3])];
  return [0, 0, 0, 0];
}

export function stackLayout(value: unknown): StackLayout | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const hug = oneOf(raw.hug, ["width", "height", "both"] as const);
  return {
    direction: oneOf(raw.direction, ["row", "column"] as const) ?? "column",
    gap: finite(raw.gap, 0, 0, 10_000),
    padding: canvasPadding(raw.padding),
    align: oneOf(raw.align, ["start", "center", "end", "stretch"] as const) ?? "start",
    justify: oneOf(raw.justify, ["start", "center", "end", "between"] as const) ?? "start",
    ...(hug ? { hug } : {}),
  };
}

/** A node read from untrusted JSON, with every field checked and clamped, or null when it is not a Canvas node. */
export function sanitizeNode(raw: unknown): CanvasNode | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const type = oneOf(value.type, CANVAS_NODE_TYPES);
  if (!type || typeof value.id !== "string" || !value.id || value.id.length > 100) return null;
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1 || !Number.isSafeInteger(value.versionNonce)) return null;
  const node: CanvasNode = {
    id: value.id, type, version: value.version as number, versionNonce: value.versionNonce as number,
    parentId: typeof value.parentId === "string" && value.parentId && value.parentId !== value.id ? value.parentId.slice(0, 100) : null,
    z: finite(value.z, 0, -1e12, 1e12),
    name: shortText(value.name, CANVAS_LIMITS.name) || typeName(type),
    x: finite(value.x, 0), y: finite(value.y, 0),
    width: finite(value.width, 0, 0, CANVAS_LIMITS.size), height: finite(value.height, 0, 0, CANVAS_LIMITS.size),
    rotation: type === "frame" || type === "group" ? 0 : finite(value.rotation, 0, -360, 360),
    opacity: finite(value.opacity, 1, 0, 1),
    fill: canvasColor(value.fill), stroke: canvasColor(value.stroke),
    strokeWidth: finite(value.strokeWidth, 0, 0, 1000), radius: finite(value.radius, 0, 0, 10_000),
  };
  if (value.deleted === true) node.deleted = true;
  if (value.hidden === true) node.hidden = true;
  if (value.locked === true) node.locked = true;
  if (value.grow === true) node.grow = true;
  if (typeof value.link === "string" && /^https?:\/\//.test(value.link)) node.link = value.link.slice(0, 2000);
  if (type === "text") {
    node.text = shortText(value.text, CANVAS_LIMITS.text);
    node.fontSize = finite(value.fontSize, 16, 1, 1000);
    node.fontWeight = Math.round(finite(value.fontWeight, 400, 100, 900) / 100) * 100;
    node.font = oneOf(value.font, ["sans", "serif", "mono"] as const) ?? "sans";
    node.align = oneOf(value.align, ["left", "center", "right"] as const) ?? "left";
    node.lineHeight = finite(value.lineHeight, 1.3, 0.5, 4);
    if (value.autoWidth === true) node.autoWidth = true;
    if (value.unmeasured === true) node.unmeasured = true;
  }
  if (type === "line" || type === "arrow" || type === "path") {
    const points = Array.isArray(value.points) ? value.points.slice(0, CANVAS_LIMITS.points * 2) : [];
    node.points = points.length >= 4 && points.length % 2 === 0 && points.every((point) => typeof point === "number" && Number.isFinite(point))
      ? points.map((point) => finite(point, 0)) : [0, 0, node.width, node.height];
    if (type === "path" && value.closed === true) node.closed = true;
  }
  if (type === "image") {
    if (typeof value.fileId === "string" && value.fileId.length <= 100) node.fileId = value.fileId;
    node.imageFit = value.imageFit === "contain" ? "contain" : "cover";
  }
  if (type === "frame") {
    node.clip = value.clip !== false;
    const layout = stackLayout(value.layout);
    if (layout) node.layout = layout;
  }
  return node;
}

export function encodeNode(node: CanvasNode): string {
  return JSON.stringify({ format: CANVAS_ROW_FORMAT, ...node });
}

/** Whether a stored row was written by Canvas rather than by the Excalidraw editor it replaced. */
export const isCanvasRow = (value: unknown): boolean =>
  Boolean(value && typeof value === "object" && (value as { format?: unknown }).format === CANVAS_ROW_FORMAT);

const LEGACY_INK = new Set(["#1e1e1e", "#000", "#000000"]);
const legacyColor = (value: unknown, ink: boolean) => {
  const color = canvasColor(value);
  if (!color) return null;
  return ink && LEGACY_INK.has(color.toLowerCase()) ? "#9CA3AF" : color;
};

/** An element drawn with the Excalidraw editor that Canvas replaced, shown as the closest Canvas node. */
export function fromExcalidraw(raw: Record<string, unknown>, z: number): CanvasNode | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  const version = Number.isSafeInteger(raw.version) ? raw.version as number : 1;
  const versionNonce = Number.isSafeInteger(raw.versionNonce) ? raw.versionNonce as number : 0;
  if (!id) return null;
  const kind = String(raw.type);
  const width = Math.abs(finite(raw.width, 0, -CANVAS_LIMITS.size, CANVAS_LIMITS.size));
  const height = Math.abs(finite(raw.height, 0, -CANVAS_LIMITS.size, CANVAS_LIMITS.size));
  const base = {
    id, version, versionNonce, z, parentId: typeof raw.frameId === "string" ? raw.frameId : null,
    x: finite(raw.x, 0), y: finite(raw.y, 0), width, height,
    rotation: (finite(raw.angle, 0, -10, 10) * 180) / Math.PI, opacity: finite(raw.opacity, 100, 0, 100) / 100,
    stroke: legacyColor(raw.strokeColor, true), fill: legacyColor(raw.backgroundColor, false),
    strokeWidth: finite(raw.strokeWidth, 1, 0, 100), radius: raw.roundness ? Math.min(16, width / 4, height / 4) : 0,
    ...(raw.isDeleted === true ? { deleted: true } : {}), ...(raw.locked === true ? { locked: true } : {}),
  };
  const flat = (points: unknown) => Array.isArray(points) ? points.flatMap((point) => Array.isArray(point) ? [finite(point[0], 0), finite(point[1], 0)] : []) : [];
  const shifted = (points: number[]) => {
    const xs = points.filter((_, index) => index % 2 === 0);
    const ys = points.filter((_, index) => index % 2 === 1);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { points: points.map((value, index) => value - (index % 2 === 0 ? minX : minY)), dx: minX, dy: minY };
  };
  let node: Record<string, unknown>;
  if (kind === "rectangle" || kind === "embeddable" || kind === "iframe") node = { ...base, type: "rect", name: "Rectangle", ...(typeof raw.link === "string" ? { link: raw.link } : {}) };
  else if (kind === "ellipse") node = { ...base, type: "ellipse", name: "Ellipse" };
  else if (kind === "diamond") node = { ...base, type: "path", name: "Diamond", closed: true, points: [width / 2, 0, width, height / 2, width / 2, height, 0, height / 2] };
  else if (kind === "line" || kind === "arrow" || kind === "freedraw") {
    const points = flat(raw.points);
    if (points.length < 4) points.push(...points.slice(0, 2));
    const { points: local, dx, dy } = shifted(points.length >= 4 ? points : [0, 0, width, height]);
    node = { ...base, x: base.x + dx, y: base.y + dy, type: kind === "freedraw" ? "path" : kind, name: kind === "arrow" ? "Arrow" : kind === "line" ? "Line" : "Sketch", points: local, fill: null, strokeWidth: Math.max(1, base.strokeWidth) };
  } else if (kind === "text") {
    node = { ...base, type: "text", name: shortText(raw.text, 40) || "Text", text: shortText(raw.text, CANVAS_LIMITS.text), fill: legacyColor(raw.strokeColor, true) ?? "#9CA3AF", stroke: null, strokeWidth: 0,
      fontSize: finite(raw.fontSize, 20, 1, 1000), align: raw.textAlign, lineHeight: finite(raw.lineHeight, 1.25, 0.5, 4) };
  } else if (kind === "image") node = { ...base, type: "image", name: "Image", fileId: raw.fileId, stroke: null };
  else if (kind === "frame" || kind === "magicframe") node = { ...base, type: "frame", name: shortText(raw.name, CANVAS_LIMITS.name) || "Frame", fill: null, stroke: "#6B7280", strokeWidth: 1, clip: true };
  else return null;
  return sanitizeNode(node);
}

/** Decodes the stored rows of a canvas: Canvas nodes as they are, older Excalidraw elements converted, deleted ones kept as tombstones. */
export function decodeScene(rows: readonly string[]): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  const legacy: Record<string, unknown>[] = [];
  for (const row of rows) {
    let value: unknown;
    try { value = JSON.parse(row); } catch { continue; }
    if (isCanvasRow(value)) { const node = sanitizeNode(value); if (node) nodes.push(node); }
    else if (value && typeof value === "object") legacy.push(value as Record<string, unknown>);
  }
  legacy.sort((a, b) => String(a.index ?? "").localeCompare(String(b.index ?? "")));
  const frames = new Map<string, Record<string, unknown>>();
  for (const element of legacy) if (element.type === "frame" || element.type === "magicframe") frames.set(String(element.id), element);
  legacy.forEach((element, index) => {
    const node = fromExcalidraw(element, index);
    if (!node) return;
    const frame = node.parentId ? frames.get(node.parentId) : undefined;
    if (node.parentId && !frame) node.parentId = null;
    if (frame) { node.x -= finite(frame.x, 0); node.y -= finite(frame.y, 0); }
    nodes.push(node);
  });
  return nodes;
}

export type Scene = ReadonlyMap<string, CanvasNode>;

export const isLive = (node: CanvasNode | null | undefined): node is CanvasNode => Boolean(node && !node.deleted);

/** Children of each parent (null for the canvas), live and in drawing order; a node whose parent is gone sits on the canvas. */
export function childrenIndex(scene: Scene): Map<string | null, CanvasNode[]> {
  const index = new Map<string | null, CanvasNode[]>();
  for (const node of scene.values()) {
    if (node.deleted) continue;
    const parent = node.parentId && isContainer(scene.get(node.parentId)) && !createsCycle(scene, node) ? node.parentId : null;
    const list = index.get(parent);
    if (list) list.push(node); else index.set(parent, [node]);
  }
  for (const list of index.values()) list.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
  return index;
}

export const isContainer = (node: CanvasNode | null | undefined): node is CanvasNode => isLive(node) && (node.type === "frame" || node.type === "group");

function createsCycle(scene: Scene, node: CanvasNode): boolean {
  const seen = new Set([node.id]);
  let parent = node.parentId;
  while (parent) {
    if (seen.has(parent)) return true;
    seen.add(parent);
    parent = scene.get(parent)?.parentId ?? null;
  }
  return false;
}

export function effectiveParent(scene: Scene, node: CanvasNode): string | null {
  return node.parentId && isContainer(scene.get(node.parentId)) && !createsCycle(scene, node) ? node.parentId : null;
}

export function ancestors(scene: Scene, node: CanvasNode): CanvasNode[] {
  const chain: CanvasNode[] = [];
  let parent = effectiveParent(scene, node);
  while (parent) {
    const next = scene.get(parent)!;
    chain.unshift(next);
    parent = effectiveParent(scene, next);
  }
  return chain;
}

export function worldOrigin(scene: Scene, node: CanvasNode): { x: number; y: number } {
  let x = node.x;
  let y = node.y;
  for (const parent of ancestors(scene, node)) { x += parent.x; y += parent.y; }
  return { x, y };
}

export function descendants(scene: Scene, id: string, index = childrenIndex(scene)): CanvasNode[] {
  const out: CanvasNode[] = [];
  const walk = (parent: string) => { for (const child of index.get(parent) ?? []) { out.push(child); walk(child.id); } };
  walk(id);
  return out;
}

export type TextMeasure = (text: string, node: Pick<CanvasNode, "fontSize" | "fontWeight" | "font">) => number;

/** A width estimate for writers without fonts: close to Inter's average advance. */
export const estimateTextWidth: TextMeasure = (text, node) => {
  const size = node.fontSize ?? 16;
  const factor = node.font === "mono" ? 0.6 : (node.fontWeight ?? 400) >= 600 ? 0.58 : 0.54;
  let width = 0;
  for (const char of text) width += char === " " ? size * 0.28 : /[A-Z0-9]/.test(char) ? size * (factor + 0.08) : /[il.,:;'|!]/.test(char) ? size * 0.28 : size * factor;
  return width;
};

export function wrapText(text: string, maxWidth: number | null, node: Pick<CanvasNode, "fontSize" | "fontWeight" | "font">, measure: TextMeasure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (maxWidth === null || !paragraph) { lines.push(paragraph); continue; }
    let line = "";
    for (const word of paragraph.split(/(?<=\s)/)) {
      const candidate = line + word;
      if (line && measure(candidate.trimEnd(), node) > maxWidth + 0.5) { lines.push(line.trimEnd()); line = word; } else line = candidate;
      while (measure(line.trimEnd(), node) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut), node) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export interface TextLayout { lines: string[]; width: number; height: number; lineHeight: number }

export function layoutText(node: CanvasNode, measure: TextMeasure): TextLayout {
  const size = node.fontSize ?? 16;
  const lineHeight = size * (node.lineHeight ?? 1.3);
  const lines = wrapText(node.text ?? "", node.autoWidth ? null : Math.max(1, node.width), node, measure);
  const width = node.autoWidth ? Math.max(1, ...lines.map((line) => measure(line, node))) : node.width;
  return { lines, width: Math.ceil(width), height: Math.ceil(lines.length * lineHeight), lineHeight };
}

/**
 * Runs auto layout from `rootId` down: nested stacks first, so a hugging child has its size before its parent places it.
 * Returns the nodes whose geometry changed, as new objects; `scene` is left untouched.
 */
export function layoutStacks(scene: Scene, rootIds: Iterable<string>, measure: TextMeasure): CanvasNode[] {
  const index = childrenIndex(scene);
  const next = new Map<string, CanvasNode>();
  const read = (id: string) => next.get(id) ?? scene.get(id)!;
  const write = (node: CanvasNode, patch: Partial<CanvasNode>) => {
    const current = read(node.id);
    const changed = Object.entries(patch).some(([key, value]) => Math.abs(Number(current[key as keyof CanvasNode]) - Number(value)) > 0.01);
    if (changed) next.set(node.id, { ...current, ...patch });
  };
  const fitText = (id: string) => {
    const node = read(id);
    if (node.type !== "text") return;
    const size = layoutText(node, measure);
    write(node, { width: size.width, height: size.height });
  };
  const visit = (id: string) => {
    const frame = read(id);
    const children = (index.get(id) ?? []).filter((child) => !child.hidden);
    for (const child of children) if (child.type === "frame" && child.layout) visit(child.id); else fitText(child.id);
    const layout = frame.layout;
    if (frame.type !== "frame" || !layout) return;
    const row = layout.direction === "row";
    const [top, right, bottom, left] = layout.padding;
    const hugMain = layout.hug === "both" || layout.hug === (row ? "width" : "height");
    const hugCross = layout.hug === "both" || layout.hug === (row ? "height" : "width");
    const main = (node: CanvasNode) => (row ? node.width : node.height);
    const cross = (node: CanvasNode) => (row ? node.height : node.width);
    let crossInner = (row ? frame.height - top - bottom : frame.width - left - right);
    if (hugCross) crossInner = Math.max(0, ...children.map((child) => cross(read(child.id))));
    if (layout.align === "stretch") for (const child of children) {
      const current = read(child.id);
      write(current, row ? { height: Math.max(1, crossInner) } : { width: Math.max(1, crossInner) });
      if (!row && current.type === "text") { const text = read(child.id); write(text, { autoWidth: false, height: layoutText({ ...text, autoWidth: false }, measure).height } as Partial<CanvasNode>); }
      if (current.type === "frame" && current.layout) visit(current.id);
    }
    const fixed = children.reduce((sum, child) => sum + (child.grow && !hugMain ? 0 : main(read(child.id))), 0);
    const gaps = layout.gap * Math.max(0, children.length - 1);
    const mainInner = hugMain ? fixed + gaps : (row ? frame.width - left - right : frame.height - top - bottom);
    const growing = hugMain ? [] : children.filter((child) => child.grow);
    if (growing.length) {
      const share = Math.max(1, (mainInner - fixed - gaps) / growing.length);
      for (const child of growing) {
        write(read(child.id), row ? { width: share } : { height: share });
        const grown = read(child.id);
        if (grown.type === "text" && row) write(grown, { autoWidth: false, height: layoutText({ ...grown, autoWidth: false }, measure).height } as Partial<CanvasNode>);
        if (grown.type === "frame" && grown.layout) visit(grown.id);
      }
    }
    const used = children.reduce((sum, child) => sum + main(read(child.id)), 0) + gaps;
    const free = Math.max(0, mainInner - used);
    let cursor = (row ? left : top) + (layout.justify === "center" ? free / 2 : layout.justify === "end" ? free : 0);
    const between = layout.justify === "between" && children.length > 1 ? free / (children.length - 1) : 0;
    for (const child of children) {
      const current = read(child.id);
      const room = crossInner - cross(current);
      const offset = layout.align === "center" ? room / 2 : layout.align === "end" ? room : 0;
      const crossStart = (row ? top : left) + offset;
      write(current, row ? { x: cursor, y: crossStart } : { x: crossStart, y: cursor });
      cursor += main(current) + layout.gap + between;
    }
    const size: Partial<CanvasNode> = {};
    if (hugMain) Object.assign(size, row ? { width: mainInner + left + right } : { height: mainInner + top + bottom });
    if (hugCross) Object.assign(size, row ? { height: crossInner + top + bottom } : { width: crossInner + left + right });
    if (Object.keys(size).length) write(read(id), size);
  };
  for (const id of rootIds) if (isLive(scene.get(id))) visit(id);
  return [...next.values()];
}

/** The outermost auto-layout frame whose arrangement depends on `id`, so a change re-runs layout from there. */
export function layoutRoot(scene: Scene, id: string): string | null {
  const node = scene.get(id);
  if (!node) return null;
  let root: string | null = node.type === "frame" && node.layout ? node.id : null;
  for (const parent of [...ancestors(scene, node)].reverse()) {
    if (parent.type === "frame" && parent.layout) root = parent.id;
    else if (root) break;
  }
  return root;
}

export const nextZ = (siblings: readonly CanvasNode[]) => siblings.reduce((max, node) => Math.max(max, node.z), 0) + 1;
