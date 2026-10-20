// No node-canvas: text in a canvas screenshot uses the system's fonts through resvg, so a brand web font may render as its fallback.
import type { Resvg as ResvgClass } from "@resvg/resvg-js";
import { nativeRequire } from "./data/engine.ts";

/** Required at first use from the staged tree: a static import would make esbuild bundle its .node file, which it cannot. */
let resvgModule: { Resvg: typeof ResvgClass } | null = null;

/** Rasterizes an SVG document to PNG at `width` pixels wide. */
export function svgToPng(svg: string, width: number, background: string): Buffer {
  resvgModule ??= nativeRequire()("@resvg/resvg-js") as { Resvg: typeof ResvgClass };
  const image = new resvgModule.Resvg(svg, {
    fitTo: { mode: "width", value: Math.max(1, Math.round(width)) },
    background,
    font: { loadSystemFonts: true, defaultFontFamily: "Inter" },
  });
  return Buffer.from(image.render().asPng());
}
