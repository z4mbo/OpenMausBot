import {
  FONT_STACKS, LEAD_FIELDS, childrenIndex, isLinkAddress,
  type CanvasNode, type LeadField, type LeadForm, type Scene, type StackLayout,
} from "./canvas-scene.ts";

/** A page address segment: lowercase letters, digits and inner hyphens, at most 48 characters. */
export const PAGE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
export const PAGE_TITLE_MAX = 120;
export const PAGE_DESCRIPTION_MAX = 300;
export const PAGE_BODY_MAX = 700_000;

export function pageSlug(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 48).replace(/-+$/, "");
}

export const LEAD_FORM_METRICS = { field: 44, message: 96, button: 44, gap: 12, radius: 10 } as const;
export const LEAD_FIELD_LABELS: Record<LeadField, string> = { name: "Name", email: "Email", phone: "Phone", message: "Message" };
export const DEFAULT_LEAD_FORM: LeadForm = { fields: ["name", "email"], button: "Join the waitlist", accent: null };

export function leadFormHeight(form: LeadForm): number {
  const rows = form.fields.map((field) => (field === "message" ? LEAD_FORM_METRICS.message : LEAD_FORM_METRICS.field));
  return rows.reduce((sum, row) => sum + row, 0) + LEAD_FORM_METRICS.button + LEAD_FORM_METRICS.gap * rows.length;
}

function luminance(hex: string): number {
  const digits = hex.replace("#", "");
  const full = digits.length <= 4 ? digits.slice(0, 3).split("").map((digit) => digit + digit).join("") : digits.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isDarkColor = (hex: string) => luminance(hex) < 0.4;
export const inkOn = (hex: string) => (isDarkColor(hex) ? "#FFFFFF" : "#111111");

/** The colours of a lead form's fields and button on a surface of the given colour, shared by the editor and the page. */
export function leadFormColors(form: LeadForm, surface: string) {
  const dark = isDarkColor(surface);
  const button = form.accent ?? (dark ? "#FFFFFF" : "#111111");
  return {
    field: dark ? "rgba(255,255,255,0.06)" : "#FFFFFF",
    border: dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.14)",
    text: dark ? "#FFFFFF" : "#111111",
    placeholder: dark ? "rgba(255,255,255,0.5)" : "rgba(17,17,17,0.45)",
    button,
    buttonText: inkOn(button),
  };
}

export function pathData(points: readonly number[], closed?: boolean): string {
  let out = "";
  for (let index = 0; index + 1 < points.length; index += 2) out += `${index ? "L" : "M"}${points[index]} ${points[index + 1]}`;
  return out + (closed ? "Z" : "");
}

export function arrowHead(points: readonly number[], size: number): string {
  const count = Math.floor(points.length / 2);
  const x2 = points[(count - 1) * 2];
  const y2 = points[(count - 1) * 2 + 1];
  let at = count - 2;
  while (at > 0 && points[at * 2] === x2 && points[at * 2 + 1] === y2) at--;
  const angle = Math.atan2(y2 - points[at * 2 + 1], x2 - points[at * 2]);
  const spread = Math.PI / 7;
  const a = { x: x2 - size * Math.cos(angle - spread), y: y2 - size * Math.sin(angle - spread) };
  const b = { x: x2 - size * Math.cos(angle + spread), y: y2 - size * Math.sin(angle + spread) };
  return `M${x2} ${y2}L${a.x} ${a.y}L${b.x} ${b.y}Z`;
}

export type FormStatus = "sent" | "invalid" | "limited" | "unknown";
export const FORM_STATUS_TEXT: Record<FormStatus, string> = {
  sent: "Thanks, we will be in touch.",
  invalid: "Please leave a name and an email or phone number.",
  limited: "Too many submissions right now. Please try again later.",
  unknown: "This form is not accepting submissions right now.",
};
const STATUS_SLOT = "<!--origin:status-->";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

const round = (value: number) => Math.round(value * 100) / 100;
type Style = Record<string, string | number | undefined>;
const styleAttr = (style: Style) => {
  const body = Object.entries(style).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => `${key}:${value}`).join(";");
  return body ? ` style="${escapeHtml(body)}"` : "";
};

interface Context {
  board: number | null;
  root: number;
  surface: string;
  images: ReadonlyMap<string, string>;
  index: Map<string | null, CanvasNode[]>;
  heading: number;
  state: { headingUsed: boolean; forms: number; texts: string[] };
}

type Place = { kind: "root" } | { kind: "board" } | { kind: "stack"; layout: StackLayout };

const len = (value: number, context: Context) => (context.board ? `${round((value / context.board) * 100)}cqw` : `${round(value)}px`);
const space = (value: number, context: Context) => context.board || value <= 16 ? len(value, context) : `clamp(16px,${round((value / context.root) * 100)}vw,${round(value)}px)`;
function fontSize(size: number, context: Context) {
  if (context.board) return len(size, context);
  return size <= 18 ? `${size}px` : `clamp(${round(Math.max(16, size * 0.6))}px,${round((size / context.root) * 100)}vw,${size}px)`;
}

const GROW_BASIS = 240;
const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const;
const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const;

const isBoard = (node: CanvasNode) => (node.type === "frame" && !node.layout && !node.leadForm) || node.type === "group";
const hugs = (node: CanvasNode, axis: "width" | "height") => Boolean(node.layout && (node.layout.hug === axis || node.layout.hug === "both"));
const autoHeight = (node: CanvasNode) => node.type === "text" || Boolean(node.leadForm) || hugs(node, "height");
const autoWidth = (node: CanvasNode) => (node.type === "text" && node.autoWidth) || hugs(node, "width");

function placement(node: CanvasNode, place: Place, context: Context): Style {
  const size = (value: number) => len(value, context);
  if (place.kind === "root") {
    return {
      width: "100%", "max-width": `${round(node.width)}px`, margin: "0 auto",
      ...(isBoard(node) ? { "aspect-ratio": `${round(node.width)}/${round(Math.max(1, node.height))}` } : autoHeight(node) ? {} : { "min-height": `${round(node.height)}px` }),
    };
  }
  if (place.kind === "board") {
    return { position: "absolute", left: size(node.x), top: size(node.y), width: size(node.width), ...(node.type === "text" || node.leadForm ? {} : { height: size(node.height) }) };
  }
  const row = place.layout.direction === "row";
  const stretch = place.layout.align === "stretch";
  const style: Style = { "max-width": "100%" };
  if (row) {
    if (node.grow) Object.assign(style, { flex: `1 1 ${context.board ? size(node.width) : `min(${round(node.width)}px,${GROW_BASIS}px)`}`, "min-width": "0" });
    else Object.assign(style, { flex: "0 1 auto", ...(autoWidth(node) ? {} : { width: size(node.width) }) });
  } else {
    if (!stretch && !autoWidth(node)) style.width = size(node.width);
    if (node.grow) style.flex = "1 1 auto";
  }
  if (stretch) style["align-self"] = "stretch";
  if (!(stretch && row) && !autoHeight(node)) {
    if (node.type === "image" || isBoard(node)) Object.assign(style, { "aspect-ratio": `${round(Math.max(1, node.width))}/${round(Math.max(1, node.height))}` });
    else if (node.type === "frame") style["min-height"] = size(node.height);
    else style.height = size(node.height);
  }
  return style;
}

function visuals(node: CanvasNode, context: Context): Style {
  const style: Style = {};
  if (node.fill && node.type !== "text" && node.type !== "line" && node.type !== "arrow" && node.type !== "path") style.background = node.fill;
  if (node.stroke && node.strokeWidth > 0 && (node.type === "frame" || node.type === "rect" || node.type === "ellipse" || node.type === "image")) style.border = `${len(node.strokeWidth, context)} solid ${node.stroke}`;
  if (node.type === "ellipse") style["border-radius"] = "50%";
  else if (node.radius > 0) style["border-radius"] = len(Math.min(node.radius, node.width / 2, node.height / 2), context);
  if (node.opacity < 1) style.opacity = round(node.opacity);
  if (node.rotation && node.type !== "frame" && node.type !== "group") style.transform = `rotate(${round(node.rotation)}deg)`;
  if ((node.type === "frame" && node.clip && !node.leadForm) || node.type === "image") style.overflow = "hidden";
  return style;
}

function container(node: CanvasNode, context: Context): Style {
  if (node.leadForm) return { display: "flex", "flex-direction": "column", gap: len(LEAD_FORM_METRICS.gap, context), position: "relative" };
  if (isBoard(node)) return { position: "relative", "container-type": "inline-size" };
  const layout = node.layout!;
  const [top, right, bottom, left] = layout.padding;
  return {
    display: "flex", "flex-direction": layout.direction, ...(layout.direction === "row" ? { "flex-wrap": "wrap" } : {}),
    gap: space(layout.gap, context), padding: [top, right, bottom, left].map((value) => space(value, context)).join(" "),
    "align-items": ALIGN[layout.align], "justify-content": JUSTIFY[layout.justify],
  };
}

const linkAttrs = (node: CanvasNode) => (node.link && isLinkAddress(node.link) ? ` href="${escapeHtml(node.link)}"` : "");

function renderLeadForm(node: CanvasNode, form: LeadForm, context: Context, style: Style): string {
  const count = ++context.state.forms;
  const id = count === 1 ? "lead" : `lead-${count}`;
  const colors = leadFormColors(form, node.fill ?? context.surface);
  const contact = form.fields.filter((field) => field === "email" || field === "phone");
  const control: Style = {
    width: "100%", padding: `0 ${len(14, context)}`, "border-radius": len(LEAD_FORM_METRICS.radius, context),
    background: colors.field, border: `1px solid ${colors.border}`, color: colors.text, "font-size": context.board ? len(16, context) : "16px",
  };
  const inputs = LEAD_FIELDS.filter((field) => form.fields.includes(field)).map((field) => {
    const label = LEAD_FIELD_LABELS[field];
    const required = contact.length === 1 && contact[0] === field ? " required" : "";
    if (field === "message") return `<textarea name="message" rows="3" maxlength="4000" placeholder="${label}" aria-label="${label}"${styleAttr({ ...control, height: len(LEAD_FORM_METRICS.message, context), padding: `${len(10, context)} ${len(14, context)}` })}></textarea>`;
    const type = field === "email" ? "email" : field === "phone" ? "tel" : "text";
    const complete = field === "phone" ? "tel" : field;
    return `<input type="${type}" name="${field}" autocomplete="${complete}" maxlength="${field === "name" ? 200 : 320}" placeholder="${label}" aria-label="${label}"${required}${styleAttr({ ...control, height: len(LEAD_FORM_METRICS.field, context) })}>`;
  });
  const button = styleAttr({
    height: len(LEAD_FORM_METRICS.button, context), border: "0", "border-radius": len(LEAD_FORM_METRICS.radius, context), background: colors.button, color: colors.buttonText,
    "font-weight": 600, "font-size": context.board ? len(16, context) : "16px", cursor: "pointer",
  });
  return `<form method="post" id="${id}" class="o-form"${styleAttr({ ...style, color: colors.text })}>${inputs.join("")}`
    + `<input class="o-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">`
    + `<button type="submit"${button}>${escapeHtml(form.button)}</button><p class="o-status" role="status">${STATUS_SLOT}</p></form>`;
}

function renderText(node: CanvasNode, style: Style, context: Context): string {
  const text = node.text ?? "";
  if (text.trim()) context.state.texts.push(text.trim());
  const size = node.fontSize ?? 16;
  let tag = "p";
  if (!context.state.headingUsed && size >= context.heading && size >= 24) { tag = "h1"; context.state.headingUsed = true; }
  else if (size >= 28) tag = "h2";
  const body = escapeHtml(text);
  const content = node.link ? `<a${linkAttrs(node)}>${body}</a>` : body;
  return `<${tag} class="o-t"${styleAttr({
    ...style, color: node.fill ?? undefined, "font-family": FONT_STACKS[node.font ?? "sans"], "font-weight": node.fontWeight ?? 400,
    "font-size": fontSize(size, context), "line-height": node.lineHeight ?? 1.3, "text-align": node.align ?? "left",
  })}>${content}</${tag}>`;
}

function renderVector(node: CanvasNode, style: Style): string {
  const points = node.points ?? [0, 0, node.width, node.height];
  const stroke = node.stroke ?? "none";
  const width = Math.max(node.strokeWidth, 0.5);
  const fill = node.type === "path" && node.closed && node.fill ? node.fill : "none";
  const head = node.type === "arrow" && points.length >= 4 ? `<path d="${arrowHead(points, Math.max(8, width * 3.5))}" fill="${stroke}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>` : "";
  return `<svg aria-hidden="true" viewBox="0 0 ${round(Math.max(1, node.width))} ${round(Math.max(1, node.height))}" preserveAspectRatio="none"${styleAttr({ ...style, overflow: "visible" })}>`
    + `<path d="${pathData(points, node.closed)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${head}</svg>`;
}

function renderNode(node: CanvasNode, place: Place, context: Context): string {
  if (node.hidden || node.deleted) return "";
  const style: Style = { ...placement(node, place, context), ...visuals(node, context) };
  if (node.type === "text") return renderText(node, style, context);
  if (node.type === "line" || node.type === "arrow" || node.type === "path") return renderVector(node, style);
  if (node.type === "image") {
    const url = node.fileId ? context.images.get(node.fileId) : undefined;
    if (!url) return `<div${styleAttr(style)}></div>`;
    const image = `<img src="${escapeHtml(url)}" alt="${escapeHtml(node.name)}" loading="lazy"${styleAttr({ width: "100%", height: "100%", "object-fit": node.imageFit === "contain" ? "contain" : "cover" })}>`;
    return node.link ? `<a${linkAttrs(node)}${styleAttr({ ...style, display: "block" })}>${image}</a>` : `<div${styleAttr(style)}>${image}</div>`;
  }
  if (node.type === "rect" || node.type === "ellipse") {
    return node.link ? `<a${linkAttrs(node)}${styleAttr({ ...style, display: "block" })}></a>` : `<div${styleAttr(style)}></div>`;
  }
  const own = { ...style, ...container(node, context) };
  if (node.type === "frame" && node.leadForm) return renderLeadForm(node, node.leadForm, context, own);
  const inner: Context = { ...context, surface: node.fill ?? context.surface, ...(isBoard(node) ? { board: Math.max(1, node.width) } : {}) };
  const children = (context.index.get(node.id) ?? []).map((child) => renderNode(child, isBoard(node) ? { kind: "board" } : { kind: "stack", layout: node.layout! }, inner)).join("");
  const tag = node.link ? "a" : node.type === "frame" && place.kind === "root" ? "main" : "div";
  return `<${tag}${tag === "a" ? linkAttrs(node) : ""}${styleAttr(own)}>${children}</${tag}>`;
}

export interface RenderedPage {
  body: string;
  background: string;
  fonts: ("sans" | "serif" | "mono")[];
  leadForms: number;
  summary: string;
}

/** The frame `frameId` of a Canvas scene as static responsive HTML: auto-layout frames become flexbox, other frames scale as one board. */
export function renderCanvasPage(scene: Scene, frameId: string, images: ReadonlyMap<string, string>): RenderedPage | null {
  const frame = scene.get(frameId);
  if (!frame || frame.deleted || frame.type !== "frame") return null;
  const index = childrenIndex(scene);
  const nodes = [frame];
  for (let at = 0; at < nodes.length; at++) nodes.push(...(index.get(nodes[at]!.id) ?? []));
  const visible = nodes.filter((node) => !node.hidden);
  const heading = Math.max(0, ...visible.filter((node) => node.type === "text").map((node) => node.fontSize ?? 16));
  const background = frame.fill ?? "#FFFFFF";
  const context: Context = { board: null, root: Math.max(320, frame.width), surface: background, images, index, heading, state: { headingUsed: false, forms: 0, texts: [] } };
  const body = renderNode(frame, { kind: "root" }, context);
  const fonts = [...new Set(visible.filter((node) => node.type === "text").map((node) => node.font ?? "sans"))];
  const { texts, forms } = context.state;
  const summary = texts.find((text) => text.length >= 40) ?? texts.slice(1).join(" ").slice(0, PAGE_DESCRIPTION_MAX);
  return { body, background, fonts, leadForms: forms, summary: summary.replace(/\s+/g, " ").slice(0, PAGE_DESCRIPTION_MAX) };
}

const FONT_FAMILIES = { sans: "Inter:wght@300..900", serif: null, mono: "JetBrains+Mono:wght@400;600" } as const;

const PAGE_CSS = `*,*::before,*::after{box-sizing:border-box}html,body{margin:0}body{font-family:${FONT_STACKS.sans};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}`
  + "img{display:block}a{color:inherit;text-decoration:none}.o-t{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.o-t a{text-decoration:underline;text-underline-offset:.15em}"
  + ".o-form input,.o-form textarea,.o-form button{font-family:inherit;margin:0}.o-form textarea{resize:vertical}.o-form input::placeholder,.o-form textarea::placeholder{color:inherit;opacity:.5}"
  + ".o-form :is(input,textarea,button):focus-visible{outline:2px solid currentColor;outline-offset:2px}.o-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}"
  + ".o-status{margin:0;font-size:15px;line-height:1.4}.o-status:empty{display:none}.o-sent .o-form>:not(.o-status){display:none}"
  + "@media (prefers-reduced-motion:no-preference){a,button{transition:opacity 150ms ease-out}a:hover,button:hover{opacity:.86}}";

export interface PageDocument {
  title: string;
  description: string;
  url?: string;
  image?: string;
  page: Pick<RenderedPage, "body" | "background" | "fonts">;
  status?: FormStatus | null;
}

/** The whole HTML document of a published page, with its SEO and social tags; `status` reports the last form submission. */
export function pageDocument({ title, description, url, image, page, status }: PageDocument): string {
  const families = page.fonts.map((font) => FONT_FAMILIES[font]).filter(Boolean);
  const fonts = families.length
    ? `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families.map((family) => `family=${family}`).join("&amp;")}&amp;display=swap">`
    : "";
  const meta = [
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escapeHtml(title)}</title>`,
    description ? `<meta name="description" content="${escapeHtml(description)}">` : "",
    `<meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}">`,
    description ? `<meta property="og:description" content="${escapeHtml(description)}">` : "",
    url ? `<meta property="og:url" content="${escapeHtml(url)}"><link rel="canonical" href="${escapeHtml(url)}">` : "",
    image ? `<meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`,
    `<meta name="theme-color" content="${escapeHtml(page.background)}"><meta name="generator" content="Origin">`,
  ].join("");
  const body = status ? page.body.split(STATUS_SLOT).join(escapeHtml(FORM_STATUS_TEXT[status])) : page.body;
  const css = `${PAGE_CSS}body{background:${page.background}}`;
  return `<!doctype html><html lang="en"><head>${meta}${fonts}<style>${css}</style></head><body class="o-page${status === "sent" ? " o-sent" : ""}">${body}</body></html>`;
}
