import type { CanvasSpec } from "./canvas-ops.ts";
import { isLive, type CanvasNode, type Scene } from "./canvas-scene.ts";
import type { BrandFontId } from "./brand-fonts.ts";

/** Slides are 1920×1080 frames stacked in one column; their order is top to bottom, as Present plays them. */
export const SLIDE = { width: 1920, height: 1080, gap: 160 } as const;

export const SLIDE_LAYOUTS = ["title", "section", "bullets", "two-column", "stat", "image", "quote", "closing"] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];

export const SLIDE_LAYOUT_NAMES: Record<SlideLayout, string> = {
  title: "Title", section: "Section", bullets: "Bullets", "two-column": "Two columns", stat: "Big number", image: "Image", quote: "Quote", closing: "Closing",
};

export interface SlideContent {
  layout?: SlideLayout;
  title?: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  /** Two-column slides: the left and right text. */
  columns?: string[];
  /** Big-number slides: the figure, such as "3×" or "$1.2M". */
  stat?: string;
  /** Image slides: an image asset of the project, by name or id. */
  image?: string;
  notes?: string;
}

/** The brand kit's faces, so slides follow the project's type. */
export interface DeckTheme { heading?: BrandFontId; body?: BrandFontId }

const MARGIN = 160;
const WIDE = SLIDE.width - MARGIN * 2;
const clip = (value: string | undefined, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export const slideY = (at: number) => at * (SLIDE.height + SLIDE.gap);

/** A presentation's slides in playing order: its live, visible top-level frames on the first page. */
export function slidesOf(scene: Scene): CanvasNode[] {
  return [...scene.values()].filter((node) => isLive(node) && node.type === "frame" && !node.parentId && !node.page && !node.hidden).sort((a, b) => a.y - b.y || a.x - b.x);
}

function text(value: string, size: number, at: { x: number; y: number; w: number }, extra: CanvasSpec, theme: DeckTheme, role: "heading" | "body" = "body"): CanvasSpec {
  const family = theme[role];
  return {
    type: "text", text: value, x: at.x, y: at.y, w: at.w, autoWidth: false, fontSize: size, fontWeight: role === "heading" ? 700 : 400,
    lineHeight: role === "heading" ? 1.08 : 1.4, fillStyle: "text", ...(family ? { family } : {}), ...extra,
  };
}

const bulletList = (items: readonly string[]) => items.map((item) => `•  ${item}`).join("\n");

/** One slide as a canvas spec at position `at` in the deck; people and agents both add slides through it. */
export function slideSpec(content: SlideContent, at: number, theme: DeckTheme = {}, key?: string): CanvasSpec {
  const layout = content.layout ?? (content.bullets?.length ? "bullets" : content.stat ? "stat" : content.image ? "image" : at === 0 ? "title" : "bullets");
  const title = clip(content.title, 300);
  const subtitle = clip(content.subtitle, 600);
  const body = clip(content.body, 4000);
  const bullets = (content.bullets ?? []).map((item) => clip(item, 400)).filter(Boolean).slice(0, 12);
  const bold = layout === "section" || layout === "closing";
  const ink: CanvasSpec = bold ? { fillStyle: "on-primary" } : {};
  const children: CanvasSpec[] = [];
  switch (layout) {
    case "title":
      children.push({ type: "rect", name: "Accent", x: MARGIN, y: 360, w: 120, h: 12, radius: 6, fillStyle: "primary" });
      children.push(text(title || "Presentation title", 112, { x: MARGIN, y: 420, w: WIDE }, { name: "Title" }, theme, "heading"));
      if (subtitle || body) children.push(text(subtitle || body, 44, { x: MARGIN, y: 600, w: 1400 }, { name: "Subtitle", opacity: 0.7 }, theme));
      break;
    case "section":
    case "closing": {
      const centred = layout === "closing" ? { align: "center" as const } : {};
      children.push(text(title || (layout === "closing" ? "Thank you" : "Section"), layout === "closing" ? 140 : 120, { x: MARGIN, y: 400, w: WIDE }, { name: "Title", ...ink, ...centred }, theme, "heading"));
      if (subtitle || body) children.push(text(subtitle || body, 44, { x: MARGIN, y: 600, w: WIDE }, { name: "Subtitle", ...ink, opacity: 0.85, ...centred }, theme));
      break;
    }
    case "bullets":
      children.push(text(title || "Title", 72, { x: MARGIN, y: 140, w: WIDE }, { name: "Title" }, theme, "heading"));
      children.push(text(bullets.length ? bulletList(bullets) : body || bulletList(["First point", "Second point", "Third point"]), 44, { x: MARGIN, y: 320, w: WIDE }, { name: "Body", lineHeight: 1.6 }, theme));
      break;
    case "two-column": {
      const [left, right] = content.columns?.length ? content.columns.map((item) => clip(item, 2000)) : [body || "Left column", bulletList(bullets) || "Right column"];
      children.push(text(title || "Title", 72, { x: MARGIN, y: 140, w: WIDE }, { name: "Title" }, theme, "heading"));
      children.push(text(left ?? "", 36, { x: MARGIN, y: 320, w: 760 }, { name: "Left column" }, theme));
      children.push(text(right ?? "", 36, { x: 1000, y: 320, w: 760 }, { name: "Right column" }, theme));
      break;
    }
    case "stat":
      children.push(text(clip(content.stat, 24) || "100%", 280, { x: MARGIN, y: 260, w: WIDE }, { name: "Number", fontWeight: 800, fillStyle: "primary" }, theme, "heading"));
      children.push(text(title || "What the number means", 56, { x: MARGIN, y: 640, w: WIDE }, { name: "Title" }, theme, "heading"));
      if (subtitle || body) children.push(text(subtitle || body, 36, { x: MARGIN, y: 760, w: 1400 }, { name: "Detail", opacity: 0.7 }, theme));
      break;
    case "image":
      children.push(text(title || "Title", 72, { x: MARGIN, y: 140, w: 760 }, { name: "Title" }, theme, "heading"));
      if (body || bullets.length) children.push(text(bullets.length ? bulletList(bullets) : body, 36, { x: MARGIN, y: 360, w: 760 }, { name: "Body", lineHeight: 1.5 }, theme));
      children.push(content.image
        ? { type: "image", name: "Image", x: 1040, y: 0, w: 880, h: 1080, asset: content.image, imageFit: "cover" }
        : { type: "rect", name: "Image placeholder", x: 1040, y: 0, w: 880, h: 1080, fill: "#E4E4E7" });
      break;
    case "quote":
      children.push(text(`“${title || body || "A line worth remembering."}”`, 72, { x: 240, y: 300, w: 1440 }, { name: "Quote", fontWeight: 500, lineHeight: 1.25 }, theme, "heading"));
      if (subtitle) children.push(text(`— ${subtitle}`, 36, { x: 240, y: 720, w: 1440 }, { name: "Attribution", opacity: 0.7 }, theme));
      break;
  }
  const notes = clip(content.notes, 10_000);
  return {
    type: "frame", name: title.slice(0, 60) || `Slide ${at + 1}`, x: 0, y: slideY(at), w: SLIDE.width, h: SLIDE.height, fillStyle: bold ? "primary" : "background",
    ...(notes ? { notes } : {}), ...(key ? { key } : {}), children,
  };
}

/** Update operations that put the `ordered` slides into that order, moving only the ones out of place. */
export function arrangeSlides(scene: Scene, ordered: readonly string[]): { op: "update"; id: string; set: CanvasSpec }[] {
  return ordered.flatMap((id, at) => {
    const node = scene.get(id);
    return isLive(node) && (node.x !== 0 || node.y !== slideY(at)) ? [{ op: "update" as const, id, set: { x: 0, y: slideY(at) } }] : [];
  });
}
