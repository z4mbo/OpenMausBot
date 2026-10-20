type Environment = Record<string, string | undefined>;

const SITE = /^[a-z0-9-]{1,80}$/;
const PAGE = /^[a-z0-9-]{1,48}$/;
const PASSED_HEADERS = ["content-type", "content-security-policy", "cache-control", "location", "x-content-type-options", "referrer-policy"];
const FORM_BYTES_MAX = 16_000;

/** The Convex HTTP origin that serves published pages: ORIGIN_CONVEX_SITE_URL, or the one paired with NEXT_PUBLIC_CONVEX_URL. */
export function convexSiteOrigin(environment: Environment): string | null {
  const configured = environment.ORIGIN_CONVEX_SITE_URL?.trim();
  try {
    if (configured) return new URL(configured).origin;
    const cloud = new URL(environment.NEXT_PUBLIC_CONVEX_URL || "");
    if (cloud.hostname.endsWith(".convex.cloud")) return `${cloud.protocol}//${cloud.hostname.replace(/\.convex\.cloud$/, ".convex.site")}`;
    // A local Convex backend serves HTTP actions on the port after its API port (convex dev, 1.45).
    if (["127.0.0.1", "localhost"].includes(cloud.hostname) && cloud.port) return `${cloud.protocol}//${cloud.hostname}:${Number(cloud.port) + 1}`;
  } catch {
    return null;
  }
  return null;
}

/** Relays a published page or its form submission to Convex, keeping the page's own security headers. */
export async function relayPage(request: Request, params: { site: string; page: string }, environment: Environment, send: typeof fetch = fetch): Promise<Response> {
  const origin = convexSiteOrigin(environment);
  if (!origin || !SITE.test(params.site) || !PAGE.test(params.page)) return new Response("Not found", { status: 404 });
  const search = request.method === "GET" ? new URL(request.url).search : "";
  const init: RequestInit = { method: request.method, redirect: "manual", headers: { "user-agent": request.headers.get("user-agent") ?? "", accept: "text/html" } };
  if (request.method === "POST") {
    const body = await request.text();
    if (body.length > FORM_BYTES_MAX) return new Response("Request too large", { status: 413 });
    init.body = body;
    init.headers = { ...init.headers, "content-type": "application/x-www-form-urlencoded" };
  }
  const upstream = await send(`${origin}/p/${params.site}/${params.page}${search}`, init);
  const headers = new Headers();
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.status === 303 ? null : await upstream.text(), { status: upstream.status, headers });
}
