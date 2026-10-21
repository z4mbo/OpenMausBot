import type { BrandKit } from "./brand-kit.ts";
import type { CanvasSpec } from "./canvas-ops.ts";
import { TEXT_STYLES, colorStyles } from "./canvas-styles.ts";

const text = (value: string, style: string, fill = "text", extra: CanvasSpec = {}): CanvasSpec => ({ type: "text", text: value, textStyle: style, fillStyle: fill, ...extra });
const label = (value: string, extra: CanvasSpec = {}): CanvasSpec => text(value, "caption", "neutral-3", extra);
const section = (title: string, body: CanvasSpec): CanvasSpec => ({ type: "frame", name: title, fill: null, layout: { direction: "column", gap: 16, align: "stretch", hug: "height" }, children: [label(title.toUpperCase()), body] });

function button(variant: "primary" | "secondary"): CanvasSpec {
  const primary = variant === "primary";
  return {
    type: "frame", key: `button-${variant}`, name: primary ? "Button / Primary" : "Button / Secondary", radius: 10,
    fillStyle: primary ? "primary" : "neutral-2", component: { set: "Button", props: { variant }, description: "The brand's call to action." },
    layout: { direction: "row", padding: [12, 20], align: "center", justify: "center", hug: "both" },
    children: [text(primary ? "Get started" : "Learn more", "body", primary ? "on-primary" : "text", { fontWeight: 600, name: "Label" })],
  };
}

/**
 * A "Design system" frame built from the brand kit: every colour style as a bound swatch, every text style as a
 * specimen, and base components (Button with primary and secondary variants, Input, Card, Nav) bound to the kit.
 */
export function designSystemSpec(kit: Pick<BrandKit, "colors" | "name"> | null | undefined): CanvasSpec {
  const name = kit?.name?.trim() || "Brand";
  const swatches = colorStyles(kit).map((style): CanvasSpec => ({
    type: "frame", name: style.name, w: 128, fill: null, layout: { direction: "column", gap: 8, align: "stretch", hug: "height" },
    children: [
      { type: "rect", name: "Swatch", h: 88, radius: 12, fillStyle: style.id, stroke: "#0000001A", strokeWidth: 1 },
      text(style.name, "small", "text", { fontWeight: 500 }), text(style.color, "caption", "neutral-3"),
    ],
  }));
  const specimens = TEXT_STYLES.map((style) => ({
    type: "frame" as const, name: style.name, fill: null, layout: { direction: "row" as const, gap: 24, align: "end" as const, hug: "height" as const },
    children: [label(`${style.name} · ${style.fontSize}/${style.fontWeight}`, { w: 160, autoWidth: false }), text(style.role === "heading" ? `${name} ships faster` : "Plan, design and sell in one place with your agents.", style.id)],
  }));
  const input: CanvasSpec = {
    type: "frame", key: "input", name: "Input", w: 280, radius: 10, fillStyle: "background", strokeStyle: "neutral-2", strokeWidth: 1,
    component: { set: "Input", description: "A single-line field." }, layout: { direction: "row", padding: [12, 14], align: "center", hug: "height" },
    children: [text("you@company.com", "body", "neutral-3", { name: "Placeholder" })],
  };
  const card: CanvasSpec = {
    type: "frame", key: "card", name: "Card", w: 320, radius: 16, fillStyle: "neutral-2", component: { set: "Card", description: "A surface for one idea." },
    layout: { direction: "column", gap: 12, padding: 24, align: "stretch", hug: "height" },
    children: [text("Card title", "h3", "text", { name: "Title" }), text("A short line that explains the idea behind this card.", "body", "neutral-3", { name: "Body" })],
  };
  const nav: CanvasSpec = {
    type: "frame", key: "nav", name: "Nav", w: 1072, fillStyle: "background", strokeStyle: "neutral-2", strokeWidth: 1, radius: 12,
    component: { set: "Nav", description: "The site's top bar." }, layout: { direction: "row", padding: [16, 24], align: "center", justify: "between", hug: "height" },
    children: [
      text(name, "h3", "text", { name: "Logo" }),
      { type: "frame", name: "Links", fill: null, layout: { direction: "row", gap: 24, align: "center", hug: "both" }, children: ["Product", "Pricing", "About"].map((item) => text(item, "small", "text", { name: item })) },
      { ...button("primary"), key: "nav-cta", component: undefined, name: "Call to action" },
    ],
  };
  return {
    type: "frame", key: "design-system", name: "Design system", w: 1200, fillStyle: "background",
    layout: { direction: "column", gap: 48, padding: 64, align: "stretch", hug: "height" },
    children: [
      text(`${name} design system`, "h1", "text", { name: "Title" }),
      section("Colour", { type: "frame", name: "Swatches", fill: null, layout: { direction: "row", gap: 16, wrap: true, hug: "height" }, children: swatches }),
      section("Type", { type: "frame", name: "Specimens", fill: null, layout: { direction: "column", gap: 20, align: "stretch", hug: "height" }, children: specimens }),
      section("Components", {
        type: "frame", name: "Library", fill: null, layout: { direction: "row", gap: 32, wrap: true, align: "start", hug: "height" },
        children: [button("primary"), button("secondary"), input, card, nav],
      }),
    ],
  };
}
