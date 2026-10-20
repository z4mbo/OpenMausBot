import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { isPageFont, pageDocument } from "../../shared/canvas-page";
import { pagesOrigin } from "./pages";

const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|discord|telegram|vkshare|headless/i;

function address(request: Request): { site: string; slug: string } | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "p") return null;
  const [site, slug] = [decodeURIComponent(parts[1]!), decodeURIComponent(parts[2]!)];
  return /^[a-z0-9-]{1,80}$/.test(site) && /^[a-z0-9-]{1,48}$/.test(slug) ? { site, slug } : null;
}

const originOf = (value: string | undefined) => {
  try { return value ? new URL(value).origin : ""; } catch { return ""; }
};

/** Security: a published page runs no script and may only load its own images, Google Fonts and posts no form. */
function policy() {
  const storage = [originOf(process.env.CONVEX_SITE_URL), originOf(process.env.CONVEX_CLOUD_URL)].filter((origin) => origin.startsWith("http:")).join(" ");
  return [
    "default-src 'none'", `img-src https: data:${storage ? ` ${storage}` : ""}`, "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "form-action 'none'", "base-uri 'none'", "frame-ancestors 'none'",
  ].join("; ");
}

const notFound = () => new Response("<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Page not found</title><p style=\"font:16px system-ui;margin:3rem auto;max-width:28rem;text-align:center\">This page is not published.</p>", {
  status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
});

export const servePage = httpAction(async (ctx, request) => {
  const where = address(request);
  if (!where) return notFound();
  const page = await ctx.runQuery(internal.pages.served, where);
  if (!page) return notFound();
  if (!BOTS.test(request.headers.get("user-agent") ?? "")) await ctx.runMutation(internal.pages.viewed, where);
  const html = pageDocument({
    title: page.title, description: page.description, url: `${pagesOrigin()}/p/${where.site}/${where.slug}`, ...(page.image ? { image: page.image } : {}),
    page: { body: page.body, background: page.background, fonts: page.fonts.filter(isPageFont) }, status: null,
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": policy(), "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin", "Cache-Control": "no-cache",
    },
  });
});
