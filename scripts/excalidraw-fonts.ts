import { createReadStream, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { EXCALIDRAW_ASSET_PATH } from "../src/lib/excalidraw-assets.ts";

const EXCALIDRAW_FONTS_PATH = `${EXCALIDRAW_ASSET_PATH}fonts/`;

function fontsDirectory(): string {
  const entry = createRequire(import.meta.url).resolve("@excalidraw/excalidraw");
  return join(dirname(entry), "fonts");
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** Excalidraw fetches its fonts from `EXCALIDRAW_ASSET_PATH` and otherwise from a public CDN; this serves and ships them with the app. */
export function excalidrawFonts(): Plugin {
  return {
    name: "excalidraw-fonts",
    configureServer(server) {
      const root = fontsDirectory();
      server.middlewares.use(EXCALIDRAW_FONTS_PATH, (req, res, next) => {
        const path = resolve(root, decodeURIComponent((req.url ?? "").split("?")[0]!).replace(/^\/+/, ""));
        if (!path.startsWith(root + sep) || !path.endsWith(".woff2") || !statSync(path, { throwIfNoEntry: false })?.isFile()) return next();
        res.setHeader("content-type", "font/woff2");
        createReadStream(path).pipe(res);
      });
    },
    generateBundle() {
      const root = fontsDirectory();
      for (const file of filesUnder(root)) {
        this.emitFile({ type: "asset", fileName: `${EXCALIDRAW_FONTS_PATH.slice(1)}${relative(root, file).split(sep).join("/")}`, source: readFileSync(file) });
      }
    },
  };
}
