import { brandFontStack, isBrandFont, type BrandFontId } from "./brand-fonts.ts";

export const CANVAS_NODE_TYPES = ["frame", "rect", "ellipse", "line", "arrow", "text", "image", "group", "path"] as const;
export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number];
export type TextAlign = "left" | "center" | "right";
export type CanvasFont = "sans" | "serif" | "mono";
export type StackAlign = "start" | "center" | "end" | "stretch";
export type StackJustify = "start" | "center" | "end" | "between";
export type StackHug = "width" | "height" | "both";
export type Padding = [top: number, right: number, bottom: number, left: number];
export const LEAD_FIELDS = ["name", "email", "phone", "message"] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

/** A frame that a published page shows as a form in place of its layers; each submission becomes a Pipeline lead. */
export interface LeadForm {
  /** At least one of email and phone, so every lead can be contacted. */
  fields: LeadField[];
  button: string;
  /** The button's colour; dark text or light text follows from it. */
  accent: string | null;
}

/** Auto layout of a frame: its visible children stack in layer order, bottom layer first. */
export interface StackLayout {
  direction: "row" | "column";
  gap: number;
  padding: Padding;
  align: StackAlign;
  justify: StackJustify;
  /** Which of the frame's sides follow its content instead of keeping their size. */
  hug?: StackHug;
  /** Rows only: children that do not fit start a new line, `crossGap` apart. */
  wrap?: boolean;
  crossGap?: number;
}

export type HorizontalConstraint = "left" | "right" | "center" | "scale" | "stretch";
export type VerticalConstraint = "top" | "bottom" | "center" | "scale" | "stretch";
/** How a child of a frame without auto layout follows the frame when it is resized; left and top when absent. */
export interface Constraints { h: HorizontalConstraint; v: VerticalConstraint }

/** A frame other frames instantiate. Components sharing `set` are variants of one another, told apart by `props`. */
export interface ComponentInfo {
  set?: string;
  props?: Record<string, string>;
  description?: string;
}

/** A subtle drop shadow; the editor offers it but never adds one by default. */
export interface Shadow { x: number; y: number; blur: number; spread: number; color: string }

export const GRID_KINDS = ["columns", "rows", "grid"] as const;
/** An editor-only guide grid drawn over a frame: columns or rows with gutters and margins, or a square grid of `size`. */
export interface LayoutGrid {
  kind: (typeof GRID_KINDS)[number];
  count: number;
  gutter: number;
  margin: number;
  size: number;
  color: string;
}

export const BOOLEAN_OPS = ["union", "subtract", "intersect", "exclude"] as const;
export type BooleanOperation = (typeof BOOLEAN_OPS)[number];

/** A gradient paint, drawn in place of the solid fill while it is set. */
export interface Gradient {
  kind: "linear" | "radial";
  /** Linear only: the direction in degrees, 0 left to right and 90 top to bottom. */
  angle: number;
  /** Two to eight stops, `at` from 0 to 1 in increasing order. */
  stops: { at: number; color: string }[];
}

/** Per-corner radii: top left, top right, bottom right, bottom left. */
export type CornerRadii = [topLeft: number, topRight: number, bottomRight: number, bottomLeft: number];

export const IMAGE_FITS = ["cover", "contain", "stretch", "crop", "tile"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];
/**
 * Crop: the image covers a box `scale` times the node's size whose top-left corner sits at `x`, `y` (fractions of the
 * node's width and height, from 1 - scale to 0). Tile: each tile is `scale` of the node's size, from 0.05 to 1.
 */
export interface ImageCrop { scale: number; x: number; y: number }

export const TRANSITIONS = ["instant", "dissolve", "slide"] as const;
/** Clicking the node in Present mode shows frame `to`. */
export interface PrototypeLink { to: string; transition: (typeof TRANSITIONS)[number] }

/** Node properties an instance copies from its component; an instance node keeps the keys listed in its `overrides`. */
export const SYNCED_KEYS = [
  "name", "x", "y", "width", "height", "rotation", "opacity", "hidden", "fill", "stroke", "strokeWidth", "radius", "text", "fontSize", "fontWeight",
  "font", "family", "align", "lineHeight", "autoWidth", "points", "curves", "breaks", "closed", "fileId", "imageFit", "clip", "layout", "grow",
  "link", "constraints", "absolute", "minW", "maxW", "minH", "maxH", "fillStyle", "strokeStyle", "textStyle", "shadow", "blur",
  "radii", "gradient", "crop", "boolean",
] as const;
export type SyncedKey = (typeof SYNCED_KEYS)[number];

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
  /** A brand kit typeface drawn ahead of `font`, which stays its fallback. */
  family?: BrandFontId;
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
  imageFit?: ImageFit;
  crop?: ImageCrop;
  clip?: boolean;
  layout?: StackLayout;
  /** Inside an auto-layout parent, the node shares the parent's free space along its direction. */
  grow?: boolean;
  /** Where the node leads on a published page: an http(s) or mailto address. */
  link?: string;
  leadForm?: LeadForm;
  /** Paths: per anchor [inDx, inDy, outDx, outDy] cubic handle offsets from the anchor; 0, 0 is a sharp corner. */
  curves?: number[];
  /** Paths: anchor indices where another subpath starts; subpaths fill with the even-odd rule. */
  breaks?: number[];
  component?: ComponentInfo;
  /** On an instance's root: the component it shows. */
  instanceOf?: string;
  /** On an instance's root: the canvas holding its component, when that is another canvas of the project. */
  library?: string;
  /** On every node of an instance: the component node it mirrors. */
  sourceId?: string;
  overrides?: SyncedKey[];
  constraints?: Constraints;
  /** Inside an auto-layout parent, the node keeps its own x and y and the stack ignores it. */
  absolute?: boolean;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  /** A colour style: a brand kit token whose colour the fill (or a text's colour) follows. */
  fillStyle?: string;
  strokeStyle?: string;
  /** A text style id whose size, weight, line height and brand face the text follows. */
  textStyle?: string;
  shadow?: Shadow;
  /** Layer blur radius. */
  blur?: number;
  /** On a top-level node: the canvas page it sits on; absent means the first page. */
  page?: string;
  grids?: LayoutGrid[];
  prototype?: PrototypeLink;
  /** On a frame: the Origin issue it designs. */
  issue?: string;
  /** Rectangles, frames and images: radii per corner, in place of `radius`. */
  radii?: CornerRadii;
  gradient?: Gradient;
  /** On a group: its children stay editable and it draws as their combined outline, filled and stroked as the group. */
  boolean?: BooleanOperation;
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

export const fontStack = (node: Pick<CanvasNode, "font" | "family">) => {
  const fallback = FONT_STACKS[node.font ?? "sans"];
  return node.family ? brandFontStack(node.family, fallback) : fallback;
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
    ...(raw.wrap === true ? { wrap: true, crossGap: finite(raw.crossGap, finite(raw.gap, 0, 0, 10_000), 0, 10_000) } : {}),
  };
}

const ID = (value: unknown) => (typeof value === "string" && value.length > 0 && value.length <= 100 ? value : undefined);
const TOKEN = (value: unknown) => (typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value) ? value : undefined);

function constraints(value: unknown): Constraints | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const h = oneOf(raw.h, ["left", "right", "center", "scale", "stretch"] as const) ?? "left";
  const v = oneOf(raw.v, ["top", "bottom", "center", "scale", "stretch"] as const) ?? "top";
  return h === "left" && v === "top" ? undefined : { h, v };
}

function componentInfo(value: unknown): ComponentInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const info: ComponentInfo = {};
  const set = shortText(raw.set, 80).trim();
  if (set) info.set = set;
  if (raw.props && typeof raw.props === "object") {
    const props = Object.entries(raw.props as Record<string, unknown>).slice(0, 8)
      .map(([key, prop]) => [key.trim().slice(0, 40), shortText(prop, 40).trim()] as const).filter(([key, prop]) => key && prop);
    if (props.length) info.props = Object.fromEntries(props);
  }
  const description = shortText(raw.description, 400).trim();
  if (description) info.description = description;
  return info;
}

export function shadowOf(value: unknown): Shadow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const color = canvasColor(raw.color);
  if (!color) return undefined;
  return { x: finite(raw.x, 0, -1000, 1000), y: finite(raw.y, 4, -1000, 1000), blur: finite(raw.blur, 12, 0, 1000), spread: finite(raw.spread, 0, -1000, 1000), color };
}

function grids(value: unknown): LayoutGrid[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.slice(0, 4).flatMap((item): LayoutGrid[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const kind = oneOf(raw.kind, GRID_KINDS);
    if (!kind) return [];
    return [{ kind, count: Math.round(finite(raw.count, 12, 1, 100)), gutter: finite(raw.gutter, 20, 0, 1000), margin: finite(raw.margin, 0, 0, 10_000), size: finite(raw.size, 8, 1, 1000), color: canvasColor(raw.color) ?? "#FF4D4D1A" }];
  });
  return list.length ? list : undefined;
}

export function gradientOf(value: unknown): Gradient | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const stops = (Array.isArray(raw.stops) ? raw.stops : []).slice(0, 8).flatMap((item) => {
    const stop = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const color = canvasColor(stop.color);
    return color ? [{ at: finite(stop.at, 0, 0, 1), color }] : [];
  }).sort((a, b) => a.at - b.at);
  if (stops.length < 2) return undefined;
  return { kind: raw.kind === "radial" ? "radial" : "linear", angle: finite(raw.angle, 90, -360, 360), stops };
}

function cropOf(value: unknown, fit: ImageFit): ImageCrop | undefined {
  if ((fit !== "crop" && fit !== "tile") || !value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (fit === "tile") return { scale: finite(raw.scale, 0.25, 0.05, 1), x: 0, y: 0 };
  const scale = finite(raw.scale, 1, 1, 10);
  return { scale, x: finite(raw.x, 0, 1 - scale, 0), y: finite(raw.y, 0, 1 - scale, 0) };
}

const numbers = (value: unknown, max: number, min: number = -CANVAS_LIMITS.coordinate, top: number = CANVAS_LIMITS.coordinate) =>
  Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "number" && Number.isFinite(item)) ? value.map((item) => finite(item, 0, min, top)) : undefined;

export function leadForm(value: unknown): LeadForm | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const wanted: readonly unknown[] = Array.isArray(raw.fields) ? raw.fields : LEAD_FIELDS;
  const fields = LEAD_FIELDS.filter((field) => wanted.includes(field));
  if (!fields.includes("email") && !fields.includes("phone")) fields.splice(fields.includes("name") ? 1 : 0, 0, "email");
  return { fields, button: shortText(raw.button, 40).trim() || "Submit", accent: canvasColor(raw.accent) };
}

export const isLinkAddress = (value: unknown): value is string => typeof value === "string" && /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(value);

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
  if (isLinkAddress(value.link) && value.link.length <= 2000) node.link = value.link;
  if (type === "text") {
    node.text = shortText(value.text, CANVAS_LIMITS.text);
    node.fontSize = finite(value.fontSize, 16, 1, 1000);
    node.fontWeight = Math.round(finite(value.fontWeight, 400, 100, 900) / 100) * 100;
    node.font = oneOf(value.font, ["sans", "serif", "mono"] as const) ?? "sans";
    if (isBrandFont(value.family)) node.family = value.family;
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
    if (type === "path") {
      const curves = numbers(value.curves, CANVAS_LIMITS.points * 4);
      if (curves && curves.length === node.points.length * 2 && curves.some((item) => item !== 0)) node.curves = curves;
      const anchors = node.points.length / 2;
      const breaks = numbers(value.breaks, 500, 1, anchors - 1)?.map(Math.round).filter((at, index, list) => at > 0 && at < anchors && (index === 0 || at > list[index - 1]!));
      if (breaks?.length) node.breaks = breaks;
    }
  }
  const info = type === "frame" ? componentInfo(value.component) : undefined;
  if (info) node.component = info;
  if (ID(value.instanceOf) && (type === "frame" || type === "group")) node.instanceOf = value.instanceOf as string;
  if (node.instanceOf && ID(value.library)) node.library = value.library as string;
  if (ID(value.sourceId)) node.sourceId = value.sourceId as string;
  if (node.sourceId && Array.isArray(value.overrides)) {
    const overrides = (SYNCED_KEYS as readonly unknown[]).filter((key) => (value.overrides as unknown[]).includes(key)) as SyncedKey[];
    if (overrides.length) node.overrides = overrides;
  }
  const constraint = constraints(value.constraints);
  if (constraint) node.constraints = constraint;
  if (value.absolute === true) node.absolute = true;
  for (const key of ["minW", "maxW", "minH", "maxH"] as const) if (typeof value[key] === "number" && Number.isFinite(value[key])) node[key] = finite(value[key], 0, 0, CANVAS_LIMITS.size);
  for (const key of ["fillStyle", "strokeStyle", "textStyle"] as const) { const token = TOKEN(value[key]); if (token) node[key] = token; }
  const shadow = shadowOf(value.shadow);
  if (shadow) node.shadow = shadow;
  if (typeof value.blur === "number" && value.blur > 0) node.blur = finite(value.blur, 0, 0, 250);
  const page = TOKEN(value.page);
  if (page) node.page = page;
  const grid = type === "frame" ? grids(value.grids) : undefined;
  if (grid) node.grids = grid;
  if (value.prototype && typeof value.prototype === "object" && ID((value.prototype as Record<string, unknown>).to)) {
    const link = value.prototype as Record<string, unknown>;
    node.prototype = { to: link.to as string, transition: oneOf(link.transition, TRANSITIONS) ?? "dissolve" };
  }
  if (type === "frame" && ID(value.issue)) node.issue = value.issue as string;
  if (type === "image") {
    if (typeof value.fileId === "string" && value.fileId.length <= 100) node.fileId = value.fileId;
    node.imageFit = oneOf(value.imageFit, IMAGE_FITS) ?? "cover";
    const crop = cropOf(value.crop, node.imageFit);
    if (crop) node.crop = crop;
  }
  if (type === "rect" || type === "frame" || type === "image") {
    const radii = numbers(value.radii, 4, 0, 10_000);
    if (radii?.length === 4) node.radii = radii as CornerRadii;
  }
  const gradient = type === "line" || type === "arrow" || type === "image" ? undefined : gradientOf(value.gradient);
  if (gradient) node.gradient = gradient;
  if (type === "group") { const operation = oneOf(value.boolean, BOOLEAN_OPS); if (operation) node.boolean = operation; }
  if (type === "frame") {
    node.clip = value.clip !== false;
    const layout = stackLayout(value.layout);
    if (layout) node.layout = layout;
    const form = leadForm(value.leadForm);
    if (form) node.leadForm = form;
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

export type TextMeasure = (text: string, node: Pick<CanvasNode, "fontSize" | "fontWeight" | "font" | "family">) => number;

/** A width estimate for writers without fonts: close to Inter's average advance. */
export const estimateTextWidth: TextMeasure = (text, node) => {
  const size = node.fontSize ?? 16;
  const factor = node.font === "mono" ? 0.6 : (node.fontWeight ?? 400) >= 600 ? 0.58 : 0.54;
  let width = 0;
  for (const char of text) width += char === " " ? size * 0.28 : /[A-Z0-9]/.test(char) ? size * (factor + 0.08) : /[il.,:;'|!]/.test(char) ? size * 0.28 : size * factor;
  return width;
};

export function wrapText(text: string, maxWidth: number | null, node: Pick<CanvasNode, "fontSize" | "fontWeight" | "font" | "family">, measure: TextMeasure): string[] {
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
    const bounded = { ...patch };
    if (bounded.width !== undefined) bounded.width = clampSize(bounded.width, current.minW, current.maxW);
    if (bounded.height !== undefined) bounded.height = clampSize(bounded.height, current.minH, current.maxH);
    const changed = Object.entries(bounded).some(([key, value]) => Math.abs(Number(current[key as keyof CanvasNode]) - Number(value)) > 0.01);
    if (changed) next.set(node.id, { ...current, ...bounded });
  };
  const fitText = (id: string) => {
    const node = read(id);
    if (node.type !== "text") return;
    const size = layoutText(node, measure);
    write(node, { width: size.width, height: size.height });
  };
  const visit = (id: string) => {
    const frame = read(id);
    const visible = (index.get(id) ?? []).filter((child) => !child.hidden);
    for (const child of visible) if (child.type === "frame" && child.layout) visit(child.id); else fitText(child.id);
    const layout = frame.layout;
    if (frame.type !== "frame" || !layout) return;
    const children = visible.filter((child) => !child.absolute);
    const row = layout.direction === "row";
    const [top, right, bottom, left] = layout.padding;
    const hugMain = layout.hug === "both" || layout.hug === (row ? "width" : "height");
    const hugCross = layout.hug === "both" || layout.hug === (row ? "height" : "width");
    const wrap = Boolean(layout.wrap && row && !hugMain);
    const main = (node: CanvasNode) => (row ? node.width : node.height);
    const cross = (node: CanvasNode) => (row ? node.height : node.width);
    const stretch = (child: CanvasNode, size: number) => {
      const current = read(child.id);
      write(current, row ? { height: Math.max(1, size) } : { width: Math.max(1, size) });
      if (!row && current.type === "text") { const text = read(child.id); write(text, { autoWidth: false, height: layoutText({ ...text, autoWidth: false }, measure).height } as Partial<CanvasNode>); }
      if (current.type === "frame" && current.layout) visit(current.id);
    };
    let crossInner = (row ? frame.height - top - bottom : frame.width - left - right);
    if (hugCross && !wrap) crossInner = Math.max(0, ...children.map((child) => cross(read(child.id))));
    if (layout.align === "stretch" && !wrap) for (const child of children) stretch(child, crossInner);
    const fixedOf = (list: readonly CanvasNode[]) => list.reduce((sum, child) => sum + (child.grow && !hugMain ? 0 : main(read(child.id))), 0);
    const gapsOf = (list: readonly CanvasNode[]) => layout.gap * Math.max(0, list.length - 1);
    const mainInner = hugMain ? fixedOf(children) + gapsOf(children) : (row ? frame.width - left - right : frame.height - top - bottom);
    const lines: CanvasNode[][] = [];
    if (wrap) {
      let line: CanvasNode[] = [];
      let used = 0;
      for (const child of children) {
        const size = child.grow ? Math.max(child.minW ?? 0, 1) : main(read(child.id));
        if (line.length && used + layout.gap + size > mainInner + 0.5) { lines.push(line); line = []; used = 0; }
        used += (line.length ? layout.gap : 0) + size;
        line.push(child);
      }
      if (line.length) lines.push(line);
    } else lines.push(children);
    const crossGap = layout.crossGap ?? layout.gap;
    let crossCursor = row ? top : left;
    let totalCross = 0;
    lines.forEach((line, lineIndex) => {
      const lineCross = wrap ? Math.max(0, ...line.map((child) => cross(read(child.id)))) : crossInner;
      if (wrap && layout.align === "stretch") for (const child of line) stretch(child, lineCross);
      const fixed = fixedOf(line);
      const gaps = gapsOf(line);
      const growing = hugMain ? [] : line.filter((child) => child.grow);
      if (growing.length) {
        const share = Math.max(1, (mainInner - fixed - gaps) / growing.length);
        for (const child of growing) {
          write(read(child.id), row ? { width: share } : { height: share });
          const grown = read(child.id);
          if (grown.type === "text" && row) write(grown, { autoWidth: false, height: layoutText({ ...grown, autoWidth: false }, measure).height } as Partial<CanvasNode>);
          if (grown.type === "frame" && grown.layout) visit(grown.id);
        }
      }
      const used = line.reduce((sum, child) => sum + main(read(child.id)), 0) + gaps;
      const free = Math.max(0, mainInner - used);
      let cursor = (row ? left : top) + (layout.justify === "center" ? free / 2 : layout.justify === "end" ? free : 0);
      const between = layout.justify === "between" && line.length > 1 ? free / (line.length - 1) : 0;
      for (const child of line) {
        const current = read(child.id);
        const room = lineCross - cross(current);
        const offset = layout.align === "center" ? room / 2 : layout.align === "end" ? room : 0;
        const crossStart = crossCursor + offset;
        write(current, row ? { x: cursor, y: crossStart } : { x: crossStart, y: cursor });
        cursor += main(current) + layout.gap + between;
      }
      crossCursor += lineCross + crossGap;
      totalCross += lineCross + (lineIndex ? crossGap : 0);
    });
    const size: Partial<CanvasNode> = {};
    if (hugMain) Object.assign(size, row ? { width: mainInner + left + right } : { height: mainInner + top + bottom });
    const crossTotal = wrap ? totalCross : crossInner;
    if (hugCross) Object.assign(size, row ? { height: crossTotal + top + bottom } : { width: crossTotal + left + right });
    if (Object.keys(size).length) write(read(id), size);
  };
  for (const id of rootIds) if (isLive(scene.get(id))) visit(id);
  return [...next.values()];
}

export const clampSize = (value: number, min: number | undefined, max: number | undefined) => Math.max(min ?? 0, Math.min(max ?? Infinity, value));

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
