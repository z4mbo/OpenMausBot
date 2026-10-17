type Environment = Record<string, string | undefined>;

function checkedOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("CSP destinations must be HTTPS origins or HTTP loopback origins");
  return url.origin;
}

/** The site's Content-Security-Policy: scripts only from this origin or with the per-request nonce, network only to this origin and Convex. */
export function siteCsp(environment: Environment, nonce: string): string {
  const origin = checkedOrigin(environment.ORIGIN_URL || "http://localhost:3000");
  const convex = checkedOrigin(environment.NEXT_PUBLIC_CONVEX_URL || "http://localhost:3210");
  const extra = (environment.ORIGIN_CSP_CONNECT_ORIGINS || "").split(/\s+/).filter(Boolean).map(checkedOrigin);
  const destinations = [...new Set([origin, convex, ...extra])];
  const sockets = destinations.map(value => value.replace(/^http/, "ws"));
  if (!/^[A-Za-z0-9+/_=-]+$/.test(nonce)) throw new Error("Invalid CSP nonce");
  return [
    "default-src 'self'",
    `script-src 'self'${environment.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${destinations.join(" ")} ${sockets.join(" ")}`,
    `img-src 'self' data: blob: ${destinations.join(" ")}`,
    `font-src 'self' data: ${origin}`,
    `media-src 'self' blob: ${destinations.join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
