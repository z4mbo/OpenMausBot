type Environment = Record<string, string | undefined>;

function checkedOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("CSP destinations must be HTTPS origins or HTTP loopback origins");
  return url.origin;
}

export function originCsp(environment: Environment = {}, nonce?: string, target: "renderer" | "next" = "renderer"): string {
  const origin = checkedOrigin(environment.ORIGIN_URL || environment.VITE_ORIGIN_URL || "http://localhost:3000");
  const convex = checkedOrigin(environment.NEXT_PUBLIC_CONVEX_URL || environment.VITE_ORIGIN_CONVEX_URL || "http://localhost:3210");
  const extra = (environment.ORIGIN_CSP_CONNECT_ORIGINS || "").split(/\s+/).filter(Boolean).map(checkedOrigin);
  const destinations = [...new Set([origin, convex, ...extra])];
  const sockets = destinations.map(value => value.replace(/^http/, "ws"));
  const drawingFonts = "https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/fonts/";
  if (nonce && !/^[A-Za-z0-9+/_=-]+$/.test(nonce)) throw new Error("Invalid CSP nonce");
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval'${target === "next" && environment.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}${nonce ? ` 'nonce-${nonce}'` : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${destinations.join(" ")} ${sockets.join(" ")} ${drawingFonts}`,
    `img-src 'self' data: blob: ${destinations.join(" ")}`,
    `font-src 'self' data: ${origin} ${drawingFonts}`,
    `media-src 'self' blob: ${destinations.join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
