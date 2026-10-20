import { pathData } from "./canvas-page.ts";
import { childrenIndex, fontStack, type CanvasNode, type Scene } from "./canvas-scene.ts";
import { cornerRadii, cssRadii, gradientCss } from "./canvas-paint.ts";
import { booleanGroupPath } from "./canvas-boolean-group.ts";

type Index = ReadonlyMap<string | null, readonly CanvasNode[]>;
type Decl = [property: string, value: string];

const px = (value: number) => `${Math.round(value * 100) / 100}px`;
const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const;
const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const;

function declarations(node: CanvasNode, parent: CanvasNode | undefined): Decl[] {
  const out: Decl[] = [];
  const stacked = parent?.type === "frame" && parent.layout && !node.absolute;
  if (parent && !stacked) out.push(["position", "absolute"], ["left", px(node.x)], ["top", px(node.y)]);
  if (node.type === "text" && node.autoWidth) out.push(["white-space", "nowrap"]); else out.push(["width", node.grow && stacked && parent!.layout!.direction === "row" ? "auto" : px(node.width)]);
  if (node.grow && stacked) out.push(["flex", "1 1 0"]);
  if (node.type !== "text") out.push(["height", node.grow && stacked && parent!.layout!.direction === "column" ? "auto" : px(node.height)]);
  for (const [key, property] of [["minW", "min-width"], ["maxW", "max-width"], ["minH", "min-height"], ["maxH", "max-height"]] as const) if (node[key] !== undefined) out.push([property, px(node[key]!)]);
  if (node.type === "text") {
    out.push(["font-family", fontStack(node)], ["font-size", px(node.fontSize ?? 16)], ["font-weight", String(node.fontWeight ?? 400)], ["line-height", String(node.lineHeight ?? 1.3)]);
    if (node.align && node.align !== "left") out.push(["text-align", node.align]);
    if (node.gradient) out.push(["background", gradientCss(node.gradient)], ["background-clip", "text"], ["color", "transparent"]);
    else if (node.fill) out.push(["color", node.fill]);
  } else if (node.type !== "line" && node.type !== "arrow" && node.type !== "path" && !node.boolean && (node.gradient || node.fill)) out.push(["background", node.gradient ? gradientCss(node.gradient) : node.fill!]);
  if (node.stroke && node.strokeWidth > 0 && node.type !== "line" && node.type !== "arrow" && node.type !== "path") out.push(["border", `${px(node.strokeWidth)} solid ${node.stroke}`]);
  const radii = cornerRadii(node);
  if (node.type === "ellipse") out.push(["border-radius", "50%"]); else if (radii) out.push(["border-radius", cssRadii(radii, px)]);
  if (node.opacity < 1) out.push(["opacity", String(Math.round(node.opacity * 100) / 100)]);
  if (node.rotation) out.push(["transform", `rotate(${node.rotation}deg)`]);
  if (node.shadow) out.push(["box-shadow", `${px(node.shadow.x)} ${px(node.shadow.y)} ${px(node.shadow.blur)} ${px(node.shadow.spread)} ${node.shadow.color}`]);
  if (node.blur) out.push(["filter", `blur(${px(node.blur)})`]);
  if (node.type === "frame" && node.clip) out.push(["overflow", "hidden"]);
  if (node.type === "frame" && node.layout) {
    const layout = node.layout;
    out.push(["display", "flex"], ["flex-direction", layout.direction]);
    if (layout.wrap) out.push(["flex-wrap", "wrap"], ["row-gap", px(layout.crossGap ?? layout.gap)]);
    if (layout.gap) out.push(["gap", px(layout.gap)]);
    if (layout.padding.some(Boolean)) out.push(["padding", layout.padding.map(px).join(" ")]);
    if (layout.align !== "start") out.push(["align-items", ALIGN[layout.align]]);
    if (layout.justify !== "start") out.push(["justify-content", JUSTIFY[layout.justify]]);
  } else if (node.type === "frame" || node.type === "group") out.push(["position", parent && !stacked ? "absolute" : "relative"]);
  return out.filter((decl, at, list) => list.findIndex((other) => other[0] === decl[0]) === at || decl[0] !== "position");
}

/** The CSS of one node, as a rule for its class. */
export function nodeCss(scene: Scene, node: CanvasNode): string {
  const parent = node.parentId ? scene.get(node.parentId) : undefined;
  return `.${className(node)} {\n${declarations(node, parent).map(([property, value]) => `  ${property}: ${value};`).join("\n")}\n}`;
}

const TW: Record<string, (value: string) => string> = {
  position: (value) => value, left: (value) => `left-[${value}]`, top: (value) => `top-[${value}]`, width: (value) => (value === "auto" ? "w-auto" : `w-[${value}]`),
  height: (value) => (value === "auto" ? "h-auto" : `h-[${value}]`), "min-width": (value) => `min-w-[${value}]`, "max-width": (value) => `max-w-[${value}]`,
  "min-height": (value) => `min-h-[${value}]`, "max-height": (value) => `max-h-[${value}]`, "font-size": (value) => `text-[${value}]`, "font-weight": (value) => `font-[${value}]`,
  "line-height": (value) => `leading-[${value}]`, "text-align": (value) => `text-${value}`, color: (value) => (value === "transparent" ? "text-transparent" : `text-[${value}]`),
  background: (value) => `bg-[${value.replace(/ /g, "_")}]`, "background-clip": () => "bg-clip-text",
  border: (value) => `border-[${value.split(" ")[0]}] border-[${value.split(" ")[2]}]`, "border-radius": (value) => (value === "50%" ? "rounded-full" : `rounded-[${value.replace(/ /g, "_")}]`),
  opacity: (value) => `opacity-[${value}]`, transform: (value) => `rotate-[${value.slice(7, -1)}]`, "box-shadow": (value) => `shadow-[${value.replace(/ /g, "_")}]`,
  filter: (value) => `blur-[${value.slice(5, -1)}]`, overflow: () => "overflow-hidden", display: () => "flex", "flex-direction": (value) => (value === "row" ? "flex-row" : "flex-col"),
  "flex-wrap": () => "flex-wrap", "row-gap": (value) => `gap-y-[${value}]`, gap: (value) => `gap-[${value}]`, padding: (value) => `p-[${value.replace(/ /g, "_")}]`,
  "align-items": (value) => `items-${value.replace("flex-", "")}`, "justify-content": (value) => `justify-${value.replace("flex-", "").replace("space-", "")}`,
  flex: () => "flex-1", "white-space": () => "whitespace-nowrap", "font-family": () => "",
};

/** Tailwind utility classes for one node, arbitrary values where the scale has no step. */
export function nodeTailwind(scene: Scene, node: CanvasNode): string {
  const parent = node.parentId ? scene.get(node.parentId) : undefined;
  return declarations(node, parent).map(([property, value]) => TW[property]?.(value) ?? "").filter(Boolean).join(" ");
}

const className = (node: CanvasNode) => node.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || node.type;
const escapeJsx = (text: string) => text.replace(/[{}<>&]/g, (char) => `{${JSON.stringify(char)}}`);

function jsx(scene: Scene, index: Index, node: CanvasNode, depth: number): string {
  if (node.hidden) return "";
  const pad = "  ".repeat(depth);
  const classes = nodeTailwind(scene, node);
  const attr = classes ? ` className="${classes}"` : "";
  if (node.type === "text") {
    const tag = (node.fontSize ?? 16) >= 28 ? "h2" : "p";
    return `${pad}<${tag}${attr}>${escapeJsx(node.text ?? "").replace(/\n/g, "<br />")}</${tag}>`;
  }
  if (node.type === "image") return `${pad}<img${attr} src="" alt="${node.name.replace(/"/g, "")}" />`;
  if (node.type === "line" || node.type === "arrow" || node.type === "path") {
    const fill = node.type === "path" && node.closed && node.fill ? node.fill : "none";
    return `${pad}<svg${attr} viewBox="0 0 ${Math.max(1, Math.round(node.width))} ${Math.max(1, Math.round(node.height))}" fill="none"><path d="${pathData(node.points ?? [], node.closed, node.curves, node.breaks)}" fill="${fill}" stroke="${node.stroke ?? "none"}" strokeWidth={${node.strokeWidth}} /></svg>`;
  }
  if (node.boolean) {
    return `${pad}<svg${attr} viewBox="0 0 ${Math.max(1, Math.round(node.width))} ${Math.max(1, Math.round(node.height))}"><path d="${booleanGroupPath(node, index)}" fillRule="evenodd" fill="${node.fill ?? "none"}" stroke="${node.stroke ?? "none"}" strokeWidth={${node.strokeWidth}} /></svg>`;
  }
  const children = (index.get(node.id) ?? []).map((child) => jsx(scene, index, child, depth + 1)).filter(Boolean);
  const tag = node.link ? "a" : "div";
  const href = node.link ? ` href="${node.link}"` : "";
  return children.length ? `${pad}<${tag}${href}${attr}>\n${children.join("\n")}\n${pad}</${tag}>` : `${pad}<${tag}${href}${attr} />`;
}

/** A React component rendering the node and its children with Tailwind classes. */
export function nodeReact(scene: Scene, node: CanvasNode): string {
  const name = node.name.replace(/[^a-zA-Z0-9]+(.)?/g, (_match, next: string | undefined) => (next ? next.toUpperCase() : "")).replace(/^[^A-Za-z]+/, "") || "Design";
  const component = name[0]!.toUpperCase() + name.slice(1);
  return `export function ${component}() {\n  return (\n${jsx(scene, childrenIndex(scene), node, 2)}\n  );\n}\n`;
}
