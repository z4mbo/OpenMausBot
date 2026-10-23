import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join } from "node:path";

const PAGE_HEADERS = { "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY", "referrer-policy": "no-referrer" } as const;

export function createStaticResponder(directory: string | null | undefined, mime: Record<string, string>) {
  return (res: ServerResponse, path: string): boolean => {
    if (!directory) return false;
    const safe = path === "/" ? "/index.html" : path.replace(/\.\./g, "");
    const file = join(directory, safe);
    try {
      const data = readFileSync(file);
      const type = mime[extname(file)] ?? "application/octet-stream";
      const cache = type === "text/html" ? "no-cache" : safe.startsWith("/assets/") ? "public, max-age=31536000, immutable" : null;
      res.writeHead(200, { "content-type": type, ...(type === "text/html" ? PAGE_HEADERS : {}), ...(cache ? { "cache-control": cache } : {}) });
      res.end(data);
      return true;
    } catch {
      try {
        const data = readFileSync(join(directory, "index.html"));
        res.writeHead(200, { "content-type": "text/html", "cache-control": "no-cache", ...PAGE_HEADERS });
        res.end(data);
        return true;
      } catch {
        return false;
      }
    }
  };
}
