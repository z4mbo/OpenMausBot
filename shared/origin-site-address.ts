export const ORIGIN_HOSTED_CONVEX_URL = "https://wry-fly-446.eu-west-1.convex.cloud";
export const ORIGIN_HOSTED_SITE_URL = "https://origin.imbored.fun";

/** Provider acceptance is distinct from delivery to the recipient's inbox. */
export type OriginInviteDeliveryStatus = "not_requested" | "not_configured" | "failed" | "accepted";

export function normalizeOriginBackendUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function publicSite(value: string): string | null {
  const origin = normalizeOriginBackendUrl(value);
  if (!origin) return null;
  const url = new URL(origin);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || !host.includes(".") || host.includes(":") || /(^|\.)(localhost|local|internal)$/.test(host) || /^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
  return origin;
}

/** Site configuration must come from the issuing backend, never an invitation recipient or request origin. */
export function resolveOriginSiteAddress(options: { convexUrl: string | null | undefined; siteUrl?: string | null; publicUrl?: string | null }): string | null {
  const backend = normalizeOriginBackendUrl(options.convexUrl);
  if (!backend) return null;
  if (backend === ORIGIN_HOSTED_CONVEX_URL) return ORIGIN_HOSTED_SITE_URL;
  const configured = options.siteUrl?.trim() || options.publicUrl?.trim();
  const origin = configured ? publicSite(configured) : null;
  if (origin && new URL(origin).hostname.replace(/\.$/, "") === new URL(ORIGIN_HOSTED_SITE_URL).hostname) return null;
  return origin;
}
