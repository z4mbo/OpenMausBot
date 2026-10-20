import {
  CANVAS_NODE_TYPES, CANVAS_LIMITS, canvasColor, childrenIndex, descendants, effectiveParent, estimateTextWidth, isContainer, isLive,
  layoutRoot, layoutStacks, layoutText, leadForm, nextZ, randomId, randomNonce, sanitizeNode, stackLayout, typeName,
  type CanvasNode, type CanvasNodeType, type LeadForm, type Scene, type StackLayout, type TextMeasure,
} from "./canvas-scene.ts";
import { leadFormHeight } from "./canvas-page.ts";
import { BRAND_FONT_IDS, isBrandFont } from "./brand-fonts.ts";

/**
 * A node as agents read and write it: `x` and `y` relative to the parent, sizes as `w` and `h`, defaults left out,
 * children nested. `key` names a node created earlier in the same call so later operations can refer to it.
 */
export interface CanvasSpec {
  id?: string;
  key?: string;
  type?: CanvasNodeType;
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  radius?: number;
  rotation?: number;
  opacity?: number;
  hidden?: boolean;
  locked?: boolean;
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  font?: CanvasNode["font"];
  /** A brand kit typeface id, such as the kit's heading or body font; null removes it. */
  family?: string | null;
  align?: CanvasNode["align"];
  lineHeight?: number;
  autoWidth?: boolean;
  points?: [number, number][];
  closed?: boolean;
  /** An image asset of the project, by name or id, for image nodes. */
  asset?: string;
  fileId?: string;
  imageFit?: CanvasNode["imageFit"];
  clip?: boolean;
  layout?: Partial<Omit<StackLayout, "padding">> & { padding?: number | number[] } | null;
  grow?: boolean;
  link?: string;
  /** Frames only: shown on a published page as a form whose submissions become Pipeline leads; null removes it. */
  leadForm?: Partial<LeadForm> | null;
  children?: CanvasSpec[];
}

export type CanvasOp =
  | { op: "create"; parent?: string | null; node: CanvasSpec }
  | { op: "update"; id: string; set: CanvasSpec & { parent?: string | null } }
  | { op: "delete"; id: string };

export interface CanvasOpsResult {
  changed: CanvasNode[];
  created: { id: string; key?: string; name: string; type: CanvasNodeType }[];
  problems: string[];
}

const round = (value: number) => Math.round(value * 100) / 100;
const DEFAULT_TEXT_COLOR = "#111111";

/** The scene, or one subtree of it, as nested agent specs. */
export function compactScene(scene: Scene, options: { root?: string; max?: number } = {}): { nodes: CanvasSpec[]; total: number; shown: number } {
  const index = childrenIndex(scene);
  const max = options.max ?? 600;
  let shown = 0;
  const one = (node: CanvasNode): CanvasSpec => {
    shown++;
    const spec: CanvasSpec = { id: node.id, type: node.type };
    if (node.name !== typeName(node.type)) spec.name = node.name;
    Object.assign(spec, { x: round(node.x), y: round(node.y), w: round(node.width), h: round(node.height) });
    if (node.fill) spec.fill = node.fill;
    if (node.stroke) { spec.stroke = node.stroke; spec.strokeWidth = node.strokeWidth; }
    if (node.radius) spec.radius = node.radius;
    if (node.rotation) spec.rotation = round(node.rotation);
    if (node.opacity !== 1) spec.opacity = round(node.opacity);
    if (node.hidden) spec.hidden = true;
    if (node.locked) spec.locked = true;
    if (node.grow) spec.grow = true;
    if (node.link) spec.link = node.link;
    if (node.leadForm) spec.leadForm = node.leadForm;
    if (node.type === "text") {
      spec.text = (node.text ?? "").slice(0, 2000);
      spec.fontSize = node.fontSize;
      if (node.fontWeight !== 400) spec.fontWeight = node.fontWeight;
      if (node.font !== "sans") spec.font = node.font;
      if (node.family) spec.family = node.family;
      if (node.align !== "left") spec.align = node.align;
      if (node.autoWidth) spec.autoWidth = true;
    }
    if (node.points) spec.points = pairs(node.points).map(([x, y]) => [round(x), round(y)]);
    if (node.closed) spec.closed = true;
    if (node.fileId) spec.fileId = node.fileId;
    if (node.type === "frame" && !node.clip) spec.clip = false;
    if (node.layout) spec.layout = node.layout;
    const children = (index.get(node.id) ?? []).filter(() => shown < max).map(one);
    if (children.length) spec.children = children;
    return spec;
  };
  const roots = options.root ? [scene.get(options.root)].filter(isLive) : index.get(null) ?? [];
  const nodes = roots.filter(() => shown < max).map(one);
  const total = options.root ? 1 + descendants(scene, options.root, index).length : [...scene.values()].filter((node) => !node.deleted).length;
  return { nodes, total, shown };
}

function pairs(points: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let index = 0; index + 1 < points.length; index += 2) out.push([points[index], points[index + 1]]);
  return out;
}

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Every asset name an operation list asks for, so the caller can admit those images before applying it. */
export function assetReferences(ops: readonly unknown[]): string[] {
  const names = new Set<string>();
  const walk = (spec: unknown) => {
    if (!spec || typeof spec !== "object") return;
    const value = spec as CanvasSpec;
    if (typeof value.asset === "string" && value.asset.trim()) names.add(value.asset.trim());
    if (Array.isArray(value.children)) value.children.forEach(walk);
  };
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    const { node, set } = op as { node?: unknown; set?: unknown };
    walk(node);
    walk(set);
  }
  return [...names];
}

function applySpec(target: CanvasNode, spec: CanvasSpec, assets: ReadonlyMap<string, string>, problems: string[]): CanvasNode {
  const raw: Record<string, unknown> = { ...target };
  const set = (key: string, value: unknown) => { if (value !== undefined) raw[key] = value; };
  set("name", typeof spec.name === "string" ? spec.name.slice(0, CANVAS_LIMITS.name) : undefined);
  set("x", num(spec.x)); set("y", num(spec.y)); set("width", num(spec.w)); set("height", num(spec.h));
  if (spec.fill !== undefined) raw.fill = spec.fill === null ? null : canvasColor(spec.fill) ?? raw.fill;
  if (spec.stroke !== undefined) raw.stroke = spec.stroke === null ? null : canvasColor(spec.stroke) ?? raw.stroke;
  for (const key of ["strokeWidth", "radius", "rotation", "opacity", "fontSize", "fontWeight", "lineHeight"] as const) set(key, num(spec[key]));
  for (const key of ["hidden", "locked", "autoWidth", "closed", "clip", "grow"] as const) if (typeof spec[key] === "boolean") raw[key] = spec[key];
  for (const key of ["text", "font", "align", "imageFit", "fileId", "link"] as const) if (typeof spec[key] === "string") raw[key] = spec[key];
  if (spec.link === "") delete raw.link;
  if (spec.family === null || spec.family === "") delete raw.family;
  else if (typeof spec.family === "string") {
    if (isBrandFont(spec.family)) raw.family = spec.family; else problems.push(`No brand font "${spec.family.slice(0, 40)}"; use one of ${BRAND_FONT_IDS.join(", ")}.`);
  }
  if (spec.leadForm === null) delete raw.leadForm;
  else if (spec.leadForm && target.type === "frame") {
    const form = leadForm({ ...target.leadForm, ...spec.leadForm });
    raw.leadForm = form;
    delete raw.layout;
    if (form && spec.h === undefined) raw.height = leadFormHeight(form);
  } else if (spec.leadForm) problems.push(`Only frames can be lead forms; ${target.name} is a ${typeName(target.type).toLowerCase()}.`);
  if (spec.layout === null) delete raw.layout;
  else if (spec.layout) raw.layout = stackLayout({ ...target.layout, ...spec.layout, ...(spec.layout.padding === undefined && target.layout ? { padding: target.layout.padding } : {}) });
  if (Array.isArray(spec.points)) {
    const flat = spec.points.flatMap((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : []);
    if (flat.length >= 4 && flat.every(Number.isFinite)) {
      raw.points = flat;
      if (spec.w === undefined) raw.width = Math.max(...flat.filter((_, i) => i % 2 === 0)) - Math.min(...flat.filter((_, i) => i % 2 === 0));
      if (spec.h === undefined) raw.height = Math.max(...flat.filter((_, i) => i % 2 === 1)) - Math.min(...flat.filter((_, i) => i % 2 === 1));
    }
  }
  if (typeof spec.asset === "string") {
    const fileId = assets.get(spec.asset.trim());
    if (fileId) raw.fileId = fileId; else problems.push(`No image asset "${spec.asset}" in this project.`);
  }
  if (target.type === "text" && (spec.text !== undefined || spec.fontSize !== undefined || spec.w !== undefined || spec.autoWidth !== undefined || spec.fontWeight !== undefined || spec.family !== undefined)) raw.unmeasured = true;
  return sanitizeNode(raw) ?? target;
}

function defaults(type: CanvasNodeType): Partial<CanvasNode> {
  switch (type) {
    case "frame": return { width: 400, height: 300, fill: "#FFFFFF", clip: true };
    case "group": return { width: 0, height: 0 };
    case "text": return { width: 200, height: 20, fill: DEFAULT_TEXT_COLOR, text: "Text", fontSize: 16, fontWeight: 400, font: "sans", align: "left", lineHeight: 1.3 };
    case "line": case "arrow": return { width: 120, height: 0, stroke: DEFAULT_TEXT_COLOR, strokeWidth: 2 };
    case "path": return { width: 100, height: 100, stroke: DEFAULT_TEXT_COLOR, strokeWidth: 2 };
    case "image": return { width: 240, height: 160, fill: "#E5E7EB" };
    default: return { width: 100, height: 100, fill: "#D9D9D9" };
  }
}

export function newNode(type: CanvasNodeType, parentId: string | null, z: number, patch: Partial<CanvasNode> = {}): CanvasNode {
  return sanitizeNode({
    id: randomId(), type, version: 1, versionNonce: randomNonce(), parentId, z, name: typeName(type),
    x: 0, y: 0, rotation: 0, opacity: 1, fill: null, stroke: null, strokeWidth: 0, radius: 0, ...defaults(type), ...patch,
  })!;
}

/** Applies agent operations to a scene and returns the nodes to save, with versions already bumped. */
export function applyCanvasOps(scene: Scene, ops: readonly unknown[], options: { measure?: TextMeasure; assets?: ReadonlyMap<string, string> } = {}): CanvasOpsResult {
  const measure = options.measure ?? estimateTextWidth;
  const assets = options.assets ?? new Map<string, string>();
  const work = new Map(scene);
  const touched = new Set<string>();
  const keys = new Map<string, string>();
  const created: CanvasOpsResult["created"] = [];
  const problems: string[] = [];
  const resolve = (ref: unknown): CanvasNode | undefined => {
    if (typeof ref !== "string") return undefined;
    const node = work.get(keys.get(ref) ?? ref);
    return isLive(node) ? node : undefined;
  };
  const put = (node: CanvasNode) => { work.set(node.id, node); touched.add(node.id); };
  const siblingsOf = (parentId: string | null) => [...work.values()].filter((node) => !node.deleted && effectiveParent(work, node) === parentId);
  const placeOnCanvas = () => {
    const roots = siblingsOf(null);
    if (!roots.length) return { x: 0, y: 0 };
    const right = Math.max(...roots.map((node) => node.x + node.width));
    const top = Math.min(...roots.map((node) => node.y));
    return { x: Math.round(right + 100), y: Math.round(top) };
  };
  const build = (spec: CanvasSpec, parentId: string | null, path: string): void => {
    const type = (CANVAS_NODE_TYPES as readonly unknown[]).includes(spec.type) ? spec.type! : null;
    if (!type) { problems.push(`${path}: type must be one of ${CANVAS_NODE_TYPES.join(", ")}.`); return; }
    if (work.size >= CANVAS_LIMITS.nodes) { problems.push(`${path}: the canvas is full.`); return; }
    let node = newNode(type, parentId, nextZ(siblingsOf(parentId)));
    if (type === "text" && spec.w === undefined && spec.autoWidth === undefined) node.autoWidth = true;
    node = applySpec(node, spec, assets, problems);
    if (type === "text") node = { ...node, unmeasured: true, ...(spec.name ? {} : { name: (node.text ?? "").trim().replace(/\s+/g, " ").slice(0, 60) || "Text" }), ...sizeOfText(node, measure) };
    if (!parentId && num(spec.x) === undefined && num(spec.y) === undefined) node = { ...node, ...placeOnCanvas() };
    put(node);
    if (typeof spec.key === "string" && spec.key) keys.set(spec.key, node.id);
    created.push({ id: node.id, ...(spec.key ? { key: spec.key } : {}), name: node.name, type });
    const container = type === "frame" || type === "group";
    if (Array.isArray(spec.children)) {
      if (!container) problems.push(`${path}: only frames and groups have children.`);
      else spec.children.forEach((child, index) => build(child, node.id, `${path}.children[${index}]`));
    }
    if (type === "group") fitGroup(work, node.id, put);
  };
  ops.forEach((raw, index) => {
    const path = `ops[${index}]`;
    if (!raw || typeof raw !== "object") { problems.push(`${path}: not an operation.`); return; }
    const op = raw as Record<string, unknown>;
    if (op.op === "create") {
      const parent = op.parent === undefined || op.parent === null ? null : resolve(op.parent);
      if (op.parent && !isContainer(parent)) { problems.push(`${path}: parent ${String(op.parent)} is not a frame or group on this canvas.`); return; }
      if (!op.node || typeof op.node !== "object") { problems.push(`${path}: create needs node.`); return; }
      build(op.node as CanvasSpec, parent?.id ?? null, path);
    } else if (op.op === "update") {
      const node = resolve(op.id);
      if (!node) { problems.push(`${path}: no node ${String(op.id)}.`); return; }
      const set = (op.set && typeof op.set === "object" ? op.set : {}) as CanvasSpec & { parent?: string | null };
      let next = applySpec(node, set, assets, problems);
      if (set.parent !== undefined) {
        const parent = set.parent === null ? null : resolve(set.parent);
        if (set.parent !== null && (!isContainer(parent) || parent.id === node.id || descendants(work, node.id).some((child) => child.id === parent.id))) problems.push(`${path}: cannot move ${node.id} into ${String(set.parent)}.`);
        else next = { ...next, parentId: parent?.id ?? null, z: nextZ(siblingsOf(parent?.id ?? null)) };
      }
      if (next.type === "text") next = { ...next, ...sizeOfText(next, measure) };
      put(next);
      if (Array.isArray(set.children)) {
        if (next.type === "frame" || next.type === "group") set.children.forEach((child, childIndex) => build(child, next.id, `${path}.set.children[${childIndex}]`));
        else problems.push(`${path}: only frames and groups have children.`);
      }
    } else if (op.op === "delete") {
      const node = resolve(op.id);
      if (!node) { problems.push(`${path}: no node ${String(op.id)}.`); return; }
      for (const gone of [node, ...descendants(work, node.id)]) put({ ...gone, deleted: true });
    } else problems.push(`${path}: op must be create, update or delete.`);
  });
  const roots = new Set<string>();
  for (const id of touched) {
    const node = work.get(id)!;
    const root = layoutRoot(work, node.deleted && node.parentId ? node.parentId : id);
    if (root) roots.add(root);
  }
  for (const node of layoutStacks(work, roots, measure)) put(node);
  for (const id of touched) {
    const parent = work.get(id)?.parentId;
    if (parent && work.get(parent)?.type === "group") fitGroup(work, parent, put);
  }
  const changed = [...touched].map((id) => {
    const node = work.get(id)!;
    const before = scene.get(id);
    return { ...node, version: Math.max(node.version, (before?.version ?? 0) + 1), versionNonce: randomNonce() };
  });
  return { changed, created, problems };
}

function sizeOfText(node: CanvasNode, measure: TextMeasure): Pick<CanvasNode, "width" | "height"> {
  const size = layoutText(node, measure);
  return { width: size.width, height: size.height };
}

/** Moves a group's origin to its children's top-left corner and sizes it to them, keeping every child where it is. */
export function fitGroup(scene: Map<string, CanvasNode>, groupId: string, put: (node: CanvasNode) => void): void {
  const group = scene.get(groupId);
  if (!isLive(group) || group.type !== "group") return;
  const children = [...scene.values()].filter((node) => !node.deleted && node.parentId === groupId);
  if (!children.length) return;
  const left = Math.min(...children.map((node) => node.x));
  const top = Math.min(...children.map((node) => node.y));
  const right = Math.max(...children.map((node) => node.x + node.width));
  const bottom = Math.max(...children.map((node) => node.y + node.height));
  if (Math.abs(left) > 0.01 || Math.abs(top) > 0.01) for (const child of children) put({ ...child, x: child.x - left, y: child.y - top });
  if (Math.abs(left) > 0.01 || Math.abs(top) > 0.01 || Math.abs(group.width - (right - left)) > 0.01 || Math.abs(group.height - (bottom - top)) > 0.01) {
    put({ ...group, x: group.x + left, y: group.y + top, width: right - left, height: bottom - top });
  }
}
