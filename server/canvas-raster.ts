// No node-canvas: canvas screenshots render through resvg with this computer's fonts plus brand faces cached from Google Fonts.
import { join } from "node:path";
import type { Resvg as ResvgClass } from "@resvg/resvg-js";
import { canvasFontLoader } from "./canvas-fonts.ts";
import { DATA_DIR } from "./config.ts";
import { nativeRequire } from "./data/engine.ts";

/** Required at first use from the staged tree: a static import would make esbuild bundle its .node file, which it cannot. */
let resvgModule: { Resvg: typeof ResvgClass } | null = null;

/** Rasterizes an SVG document to PNG at `width` pixels wide; resvg 2.6 takes fonts as TrueType/OpenType file paths only. */
export function svgToPng(svg: string, width: number, background: string, fontFiles: readonly string[] = []): Buffer {
  resvgModule ??= nativeRequire()("@resvg/resvg-js") as { Resvg: typeof ResvgClass };
  const image = new resvgModule.Resvg(svg, {
    fitTo: { mode: "width", value: Math.max(1, Math.round(width)) },
    background,
    font: { loadSystemFonts: true, defaultFontFamily: "Inter", fontFiles: [...fontFiles] },
  });
  return Buffer.from(image.render().asPng());
}

export const canvasFonts = canvasFontLoader({ cacheDir: join(DATA_DIR, "cache", "fonts") });
