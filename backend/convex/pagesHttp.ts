import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { readBoundedText } from "../lib/http-body";
import { pageDocument, type FormStatus } from "../../shared/canvas-page";
import { pagesOrigin } from "./pages";

const MAX_FORM_BYTES = 16_000;
const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|discord|telegram|vkshare|headless/i;
const STATUSES = new Set<FormStatus>(["invalid", "limited", "unknown"]);

function address(request: Request): { site: string; slug: string } | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "p") return null;
  const [site, slug] = [decodeURIComponent(parts[1]!), decodeURIComponent(parts[2]!)];
  return /^[a-z0-9-]{1,80}$/.test(site) && /^[a-z0-9-]{1,48}$/.test(slug) ? { site, slug } : null;
}

const originOf = (value: string | undefined) => {
  try { return value ? new URL(value).origin : ""; } catch { return ""; }
};

/** Security: a published page runs no script and may only load its own images, Google Fonts and post its form back to itself. */
function policy() {
  const storage = [originOf(process.env.CONVEX_SITE_URL), originOf(process.env.CONVEX_CLOUD_URL)].filter((origin) => origin.startsWith("http:")).join(" ");
  return [
    "default-src 'none'", `img-src https: data:${storage ? ` ${storage}` : ""}`, "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'",
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
  const query = new URL(request.url).searchParams;
  const reported = query.get("form") as FormStatus | null;
  const status = query.get("sent") === "1" ? "sent" : reported && STATUSES.has(reported) ? reported : null;
  if (!status && !BOTS.test(request.headers.get("user-agent") ?? "")) await ctx.runMutation(internal.pages.viewed, where);
  const html = pageDocument({
    title: page.title, description: page.description, url: `${pagesOrigin()}/p/${where.site}/${where.slug}`, ...(page.image ? { image: page.image } : {}),
    page: { body: page.body, background: page.background, fonts: page.fonts.filter((font): font is "sans" | "serif" | "mono" => ["sans", "serif", "mono"].includes(font)) }, status,
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": policy(), "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin", "Cache-Control": "no-cache",
    },
  });
});

export const submitPage = httpAction(async (ctx, request) => {
  const where = address(request);
  if (!where) return notFound();
  const back = (status: string) => new Response(null, { status: 303, headers: { Location: `/p/${where.site}/${where.slug}?${status}#lead` } });
  let input: URLSearchParams;
  try { input = new URLSearchParams(await readBoundedText(request, MAX_FORM_BYTES)); }
  catch { return back("form=invalid"); }
  if (input.get("website")?.trim()) return back("sent=1");
  const target = await ctx.runQuery(internal.pages.captureTarget, where);
  if (!target) return notFound();
  if (!target.leadForms) return back("form=unknown");
  const field = (name: string, max: number) => {
    const value = input.get(name)?.trim();
    return value ? { [name]: value.slice(0, max) } : {};
  };
  const outcome = await ctx.runMutation(internal.pipeline.capture, {
    token: target.token, ...field("name", 200), ...field("email", 320), ...field("phone", 40), ...field("message", 4000),
    source: where.slug, page: `${pagesOrigin()}/p/${where.site}/${where.slug}`.slice(0, 300),
  });
  return back(outcome === "ok" ? "sent=1" : `form=${outcome}`);
});
