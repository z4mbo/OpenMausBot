import { v } from "convex/values";
import { action, httpAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib/permissions";
import { newToken, settingsOf } from "./lib/pipelineCore";
import { SEALING_MISSING, sealingConfigured, seal, unseal } from "./lib/sealing";
import { BodyTooLarge, readBoundedText } from "../lib/http-body";
import { markPaid } from "./pipelineDeals";
import { majorUnits } from "../../shared/origin-sales";

const BODY_MAX = 512_000;
/** Stripe's own libraries refuse a signature older than five minutes (https://docs.stripe.com/webhooks#replay-attacks). */
const TOLERANCE_S = 300;
const PAID_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const SECRET = /^whsec_[A-Za-z0-9+/=_-]{16,200}$/;

const purpose = (projectId: string) => `pipeline-stripe:${projectId}`;
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export async function stripeSignature(secret: string, timestamp: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stripe-Signature is `t=<unix seconds>,v1=<hex>[,v1=<hex>…]`; any v1 that matches within the tolerance is accepted. */
export async function verifyStripeSignature(secret: string, header: string, payload: string, nowMs = Date.now()): Promise<boolean> {
  const parts = header.split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1] ?? "";
  const signatures = parts.filter(([key, value]) => key === "v1" && value).map(([, value]) => value!);
  if (!/^\d{1,12}$/.test(timestamp) || !signatures.length || Math.abs(nowMs / 1000 - Number(timestamp)) > TOLERANCE_S) return false;
  const expected = await stripeSignature(secret, timestamp, payload);
  return signatures.some((signature) => sameText(signature, expected));
}

export const store = internalMutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), enabled: v.boolean(), sealed: v.optional(v.string()), rotate: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.projectId, args.sessionToken);
    const existing = await settingsOf(ctx, args.projectId);
    const patch = args.enabled
      ? { stripeToken: !existing?.stripeToken || args.rotate ? newToken() : existing.stripeToken, ...(args.sealed !== undefined ? { stripeSecret: args.sealed || undefined } : {}) }
      : { stripeToken: undefined, stripeSecret: undefined };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("pipelineSettings", { projectId: args.projectId, captureToken: newToken(), captureEnabled: false, autoSend: false, ...patch });
    return null;
  },
});

/** Security: only project admins set the webhook up; the signing secret is sealed before it is stored and only the webhook opens it. */
export const configure = action({
  args: { sessionToken: v.string(), projectId: v.id("projects"), enabled: v.boolean(), signingSecret: v.optional(v.string()), rotate: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const secret = args.signingSecret?.trim();
    if (secret && !SECRET.test(secret)) throw new Error("A Stripe signing secret starts with whsec_");
    if (secret && !sealingConfigured()) throw new Error(SEALING_MISSING);
    const sealed = secret === undefined ? undefined : secret ? await seal(secret, purpose(args.projectId)) : "";
    await ctx.runMutation(internal.pipelineStripe.store, {
      sessionToken: args.sessionToken, projectId: args.projectId, enabled: args.enabled, ...(sealed !== undefined ? { sealed } : {}), ...(args.rotate ? { rotate: true } : {}),
    });
    return null;
  },
});

export const secretFor = internalQuery({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ projectId: v.id("projects"), sealed: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{48}$/.test(args.token)) return null;
    const settings = await ctx.db.query("pipelineSettings").withIndex("by_stripeToken", (q) => q.eq("stripeToken", args.token)).unique();
    return settings ? { projectId: settings.projectId, ...(settings.stripeSecret ? { sealed: settings.stripeSecret } : {}) } : null;
  },
});

export const paid = internalMutation({
  args: { projectId: v.id("projects"), linkId: v.string(), amountMinor: v.number(), currency: v.string(), checkoutId: v.string() },
  returns: v.union(v.literal("won"), v.literal("duplicate"), v.literal("unknown")),
  handler: async (ctx, args) => {
    const deals = await ctx.db.query("pipelineDeals").withIndex("by_paymentLinkId", (q) => q.eq("payment.linkId", args.linkId)).take(5);
    const deal = deals.find((row) => row.projectId === args.projectId);
    if (!deal) return "unknown";
    const done = await markPaid(ctx, deal, { amount: majorUnits(args.amountMinor, args.currency), currency: args.currency, checkoutId: args.checkoutId });
    return done ? "won" : "duplicate";
  },
});

export const stripeWebhook = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  let raw: string;
  try { raw = await readBoundedText(request, BODY_MAX); }
  catch (error) { return new Response("Request rejected", { status: error instanceof BodyTooLarge ? 413 : 400 }); }
  const target = await ctx.runQuery(internal.pipelineStripe.secretFor, { token });
  if (!target) return new Response("Unknown webhook", { status: 404 });
  if (!target.sealed) return new Response("Add the signing secret in Sales settings", { status: 403 });
  let secret: string;
  try { secret = await unseal(target.sealed, purpose(target.projectId)); }
  catch { return new Response("Webhook unavailable", { status: 503 }); }
  if (!await verifyStripeSignature(secret, request.headers.get("stripe-signature") ?? "", raw)) return new Response("Invalid signature", { status: 400 });
  let event: Record<string, unknown>;
  try { event = record(JSON.parse(raw)); } catch { return new Response("Send JSON", { status: 400 }); }
  const session = record(record(event.data).object);
  const linkId = text(session.payment_link, 120);
  const paidNow = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (!PAID_EVENTS.has(text(event.type, 80)) || !paidNow || !/^plink_[A-Za-z0-9]{1,100}$/.test(linkId)) return Response.json({ received: true, outcome: "ignored" });
  const amountMinor = Number(session.amount_total);
  const currency = text(session.currency, 3);
  if (!Number.isFinite(amountMinor) || amountMinor < 0 || !/^[a-z]{3}$/i.test(currency)) return new Response("Missing amount", { status: 400 });
  const outcome = await ctx.runMutation(internal.pipelineStripe.paid, { projectId: target.projectId, linkId, amountMinor, currency, checkoutId: text(session.id, 100) });
  return Response.json({ received: true, outcome });
});
