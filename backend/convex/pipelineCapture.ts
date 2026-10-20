import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { BodyTooLarge, readBoundedText } from "../lib/http-body";

const MAX_BODY = 16_000;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
const FIELDS = ["name", "email", "phone", "company", "message", "source", "page"] as const;

const STATUS = { ok: 200, unknown: 404, limited: 429, invalid: 400 } as const;
const MESSAGES = { ok: "Thanks, we will be in touch.", unknown: "This form is not accepting submissions.", limited: "Too many submissions right now. Please try again later.", invalid: "Please leave a name and an email or phone number." } as const;

function answer(status: number, body: Record<string, unknown>, form: boolean, message: string) {
  if (!form) return Response.json(body, { status, headers: CORS });
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${message}</title><p style="font:16px system-ui;margin:3rem auto;max-width:28rem;text-align:center">${message}</p>`;
  return new Response(html, { status, headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" } });
}

function safeRedirect(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export const captureOptions = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

export const captureLead = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const type = request.headers.get("content-type") ?? "";
  const form = !type.includes("application/json");
  let raw: string;
  try { raw = await readBoundedText(request, MAX_BODY); }
  catch (error) { return answer(error instanceof BodyTooLarge ? 413 : 400, { ok: false, error: "Request rejected" }, form, "Request rejected."); }
  let input: Record<string, unknown>;
  try {
    input = form ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("not an object");
  } catch {
    return answer(400, { ok: false, error: "Send JSON or a form" }, form, "Request rejected.");
  }
  const redirect = form ? safeRedirect(input.redirect) : null;
  const done = (outcome: keyof typeof STATUS) => {
    if (outcome === "ok" && redirect) return new Response(null, { status: 303, headers: { ...CORS, Location: redirect } });
    return answer(STATUS[outcome], outcome === "ok" ? { ok: true } : { ok: false, error: MESSAGES[outcome] }, form, MESSAGES[outcome]);
  };
  if (typeof input.website === "string" && input.website.trim()) return done("ok");
  const fields = Object.fromEntries(FIELDS.flatMap((key) => {
    const value = input[key] ?? (key === "message" ? input.notes : undefined);
    return typeof value === "string" && value.trim() ? [[key, value.slice(0, 8000)]] : [];
  }));
  if (!fields.page && request.headers.get("referer")) fields.page = request.headers.get("referer")!.slice(0, 300);
  const outcome = await ctx.runMutation(internal.pipeline.capture, { token, ...fields });
  return done(outcome);
});
