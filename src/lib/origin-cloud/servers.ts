/** The hosted Origin backend that origin.imbored.fun runs on. */
export const ORIGIN_CLOUD_URL = "https://wry-fly-446.eu-west-1.convex.cloud";
export const LOCAL_ORIGIN_URL = "http://127.0.0.1:3210";

const SITE_BACKENDS: Record<string, string> = { "origin.imbored.fun": ORIGIN_CLOUD_URL };

export const defaultOriginServer = (): string => (import.meta.env.DEV ? LOCAL_ORIGIN_URL : ORIGIN_CLOUD_URL);

/** Accepts a website address people know (origin.imbored.fun) or a bare host, and returns the backend address the app talks to. */
export function originServerFor(input: string): string {
  const text = input.trim();
  if (!text) return defaultOriginServer();
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return text;
  }
  return SITE_BACKENDS[url.hostname.toLowerCase()] ?? url.origin;
}
