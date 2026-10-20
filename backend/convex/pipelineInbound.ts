import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { BodyTooLarge, readBoundedText } from "../lib/http-body";
import { addActivity, notifyLeadReply, siteUrl, sourcePatch, stagesOf, stopSequences } from "./lib/pipelineCore";
import { normalizeLeadEmail, normalizeLeadPhone } from "../../shared/origin-pipeline";

const TWILIO_BODY_MAX = 64_000;
const BREVO_BODY_MAX = 1_000_000;
const BATCH_MAX = 20;
const TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

/** Twilio's request signature: HMAC-SHA1 of the full URL followed by each POST parameter's name and value, sorted by name. */
export async function twilioSignature(authToken: string, url: string, params: Iterable<[string, string]>): Promise<string> {
  const data = url + [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, value]) => key + value).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...mac));
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function brevoSecretOf(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  if (bearer) return bearer;
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(auth)?.[1];
  if (basic) {
    try { return atob(basic).split(":").slice(1).join(":"); } catch { return ""; }
  }
  return request.headers.get("x-origin-secret") ?? "";
}

const clip = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

export const secrets = internalQuery({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ twilioAuthToken: v.optional(v.string()), brevoSecret: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{48}$/.test(args.token)) return null;
    const settings = await ctx.db.query("pipelineSettings").withIndex("by_inboundToken", (q) => q.eq("inboundToken", args.token)).unique();
    if (!settings?.inboundEnabled) return null;
    return { ...(settings.twilioAuthToken ? { twilioAuthToken: settings.twilioAuthToken } : {}), ...(settings.brevoSecret ? { brevoSecret: settings.brevoSecret } : {}) };
  },
});

async function settingsFor(ctx: MutationCtx, token: string) {
  const settings = await ctx.db.query("pipelineSettings").withIndex("by_inboundToken", (q) => q.eq("inboundToken", token)).unique();
  return settings?.inboundEnabled ? settings : null;
}

async function leadFor(ctx: MutationCtx, settings: Doc<"pipelineSettings">, contact: { email?: string; phone?: string }, fallback: { name: string; source: string }) {
  const projectId = settings.projectId;
  const known = contact.email
    ? await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_email", (q) => q.eq("projectId", projectId).eq("email", contact.email)).first()
    : await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_phone", (q) => q.eq("projectId", projectId).eq("phone", contact.phone)).first();
  if (known) {
    const sources = sourcePatch(known, fallback.source);
    if (sources.sources) await ctx.db.patch(known._id, sources);
    return known;
  }
  const stage = stagesOf(settings)[0]!;
  const now = Date.now();
  const leadId = await ctx.db.insert("pipelineLeads", {
    projectId, name: fallback.name.slice(0, 200), source: fallback.source, stage, order: -now, tags: [], stageChangedAt: now, createdAt: now, updatedAt: now,
    ...(contact.email ? { email: contact.email } : {}), ...(contact.phone ? { phone: contact.phone } : {}),
  });
  return (await ctx.db.get(leadId))!;
}

/** Files what a lead sent on its timeline, flags it unread, ends its sequence and tells whoever owns it. */
async function receive(ctx: MutationCtx, lead: Doc<"pipelineLeads">, message: { kind: "email" | "sms" | "whatsapp" | "call"; subject?: string; body?: string }) {
  const activityId = await addActivity(ctx, lead, {
    kind: message.kind, status: "received", actor: { kind: "system", name: lead.name },
    ...(message.subject ? { subject: message.subject } : {}), ...(message.body ? { body: message.body } : {}),
  });
  const now = Date.now();
  await ctx.db.patch(lead._id, { unreadReplies: (lead.unreadReplies ?? 0) + 1, lastReplyAt: now });
  await stopSequences(ctx, lead._id, "The lead replied");
  await notifyLeadReply(ctx, lead, activityId, message.body ?? message.subject ?? (message.kind === "call" ? "Called in" : "Replied"));
  return activityId;
}

async function activityByProvider(ctx: MutationCtx, settings: Doc<"pipelineSettings">, providerId: string | undefined) {
  if (!providerId) return null;
  const rows = await ctx.db.query("pipelineActivities").withIndex("by_providerId", (q) => q.eq("providerId", providerId)).take(5);
  return rows.find((row) => row.projectId === settings.projectId) ?? null;
}

const MESSAGE_FAILED = new Set(["undelivered", "failed"]);
const CALL_FAILED: Record<string, string> = { busy: "The line was busy", "no-answer": "Nobody answered", failed: "The call could not be placed", canceled: "The call was canceled" };

export const twilioEvent = internalMutation({
  args: {
    token: v.string(), from: v.optional(v.string()), body: v.optional(v.string()), profileName: v.optional(v.string()),
    messageSid: v.optional(v.string()), smsStatus: v.optional(v.string()), messageStatus: v.optional(v.string()), errorCode: v.optional(v.string()),
    callSid: v.optional(v.string()), callStatus: v.optional(v.string()), direction: v.optional(v.string()), duration: v.optional(v.string()),
  },
  returns: v.union(v.literal("received"), v.literal("status"), v.literal("ignored"), v.literal("unknown")),
  handler: async (ctx, args) => {
    const settings = await settingsFor(ctx, args.token);
    if (!settings) return "unknown";
    const now = Date.now();
    const inbound = args.messageSid && (args.smsStatus === "received" || (args.body !== undefined && !args.messageStatus));
    if (inbound) {
      const whatsapp = args.from?.startsWith("whatsapp:") ?? false;
      const phone = normalizeLeadPhone(args.from?.replace(/^whatsapp:/, ""));
      if (!phone) return "ignored";
      const lead = await leadFor(ctx, settings, { phone }, { name: clip(args.profileName, 200) ?? phone, source: whatsapp ? "whatsapp" : "sms" });
      await receive(ctx, lead, { kind: whatsapp ? "whatsapp" : "sms", body: clip(args.body, 4_000) ?? "(no text)" });
      return "received";
    }
    if (args.messageSid && args.messageStatus) {
      const activity = await activityByProvider(ctx, settings, args.messageSid);
      if (!activity || (activity.kind !== "sms" && activity.kind !== "whatsapp")) return "ignored";
      if (MESSAGE_FAILED.has(args.messageStatus)) {
        await ctx.db.patch(activity._id, { status: "failed", error: `Twilio could not deliver it${args.errorCode ? ` (error ${args.errorCode.slice(0, 10)})` : ""}`, updatedAt: now });
      }
      return "status";
    }
    if (args.callSid && args.callStatus) {
      const activity = await activityByProvider(ctx, settings, args.callSid);
      if (activity?.kind === "call") {
        const seconds = Number(args.duration);
        if (args.callStatus === "completed") {
          await ctx.db.patch(activity._id, { status: "done", updatedAt: now, ...(Number.isFinite(seconds) ? { summary: `Call lasted ${Math.floor(seconds / 60)}m ${seconds % 60}s` } : {}) });
        } else if (CALL_FAILED[args.callStatus]) {
          await ctx.db.patch(activity._id, { status: "failed", error: CALL_FAILED[args.callStatus], updatedAt: now });
        }
        return "status";
      }
      if (args.direction === "inbound" && args.callStatus === "ringing") {
        const phone = normalizeLeadPhone(args.from);
        if (!phone) return "ignored";
        const lead = await leadFor(ctx, settings, { phone }, { name: phone, source: "call" });
        await receive(ctx, lead, { kind: "call", body: "Called in" });
        return "received";
      }
    }
    return "ignored";
  },
});

const EMAIL_FAILED: Record<string, string> = {
  hard_bounce: "The address bounced", blocked: "Brevo blocked the email", invalid_email: "The address is not valid", error: "Brevo could not send it", spam: "The lead marked it as spam",
};

export const brevoEvent = internalMutation({
  args: {
    token: v.string(),
    replies: v.array(v.object({ from: v.string(), name: v.optional(v.string()), subject: v.optional(v.string()), body: v.optional(v.string()) })),
    events: v.array(v.object({ event: v.string(), messageId: v.string(), reason: v.optional(v.string()) })),
  },
  returns: v.union(v.literal("ok"), v.literal("unknown")),
  handler: async (ctx, args) => {
    const settings = await settingsFor(ctx, args.token);
    if (!settings) return "unknown";
    for (const reply of args.replies.slice(0, BATCH_MAX)) {
      const email = normalizeLeadEmail(reply.from);
      if (!email || email === settings.replyToEmail) continue;
      const lead = await leadFor(ctx, settings, { email }, { name: clip(reply.name, 200) ?? email.split("@")[0]!, source: "email" });
      await receive(ctx, lead, { kind: "email", subject: clip(reply.subject, 300), body: clip(reply.body, 20_000) ?? "(no text)" });
    }
    for (const event of args.events.slice(0, BATCH_MAX)) {
      const reason = EMAIL_FAILED[event.event];
      if (!reason) continue;
      const activity = await activityByProvider(ctx, settings, event.messageId);
      if (activity?.kind !== "email") continue;
      await ctx.db.patch(activity._id, { status: "failed", error: `${reason}${event.reason ? `: ${event.reason.slice(0, 200)}` : ""}`, updatedAt: Date.now() });
    }
    return "ok";
  },
});

function candidateUrls(request: Request): string[] {
  const url = new URL(request.url);
  const published = siteUrl(`${url.pathname}${url.search}`);
  return [...new Set([request.url, ...(published ? [published] : [])])];
}

export const twilioWebhook = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  let raw: string;
  try { raw = await readBoundedText(request, TWILIO_BODY_MAX); }
  catch (error) { return new Response("Request rejected", { status: error instanceof BodyTooLarge ? 413 : 400 }); }
  const keys = await ctx.runQuery(internal.pipelineInbound.secrets, { token });
  if (!keys) return new Response("Unknown webhook", { status: 404 });
  if (!keys.twilioAuthToken) return new Response("Add the Twilio auth token in Pipeline settings", { status: 403 });
  const params = [...new URLSearchParams(raw)];
  const signature = request.headers.get("x-twilio-signature") ?? "";
  let valid = false;
  for (const url of candidateUrls(request)) {
    if (signature && sameText(await twilioSignature(keys.twilioAuthToken, url, params), signature)) { valid = true; break; }
  }
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const field = (name: string, max = 200) => clip(params.find(([key]) => key === name)?.[1], max);
  await ctx.runMutation(internal.pipelineInbound.twilioEvent, {
    token,
    ...Object.fromEntries(Object.entries({
      from: field("From"), body: params.find(([key]) => key === "Body")?.[1]?.slice(0, 4_000), profileName: field("ProfileName"),
      messageSid: field("MessageSid", 64), smsStatus: field("SmsStatus", 32), messageStatus: field("MessageStatus", 32), errorCode: field("ErrorCode", 16),
      callSid: field("CallSid", 64), callStatus: field("CallStatus", 32), direction: field("Direction", 32), duration: field("CallDuration", 16),
    }).filter(([, value]) => value !== undefined)),
  });
  return new Response(TWIML, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
});

export const brevoWebhook = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  let raw: string;
  try { raw = await readBoundedText(request, BREVO_BODY_MAX); }
  catch (error) { return new Response("Request rejected", { status: error instanceof BodyTooLarge ? 413 : 400 }); }
  const keys = await ctx.runQuery(internal.pipelineInbound.secrets, { token });
  if (!keys?.brevoSecret) return new Response("Unknown webhook", { status: 404 });
  if (!sameText(brevoSecretOf(request), keys.brevoSecret)) return new Response("Unauthorized", { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response("Send JSON", { status: 400 }); }
  const items = Array.isArray(record(payload).items) ? record(payload).items as unknown[] : [];
  const replies = items.slice(0, BATCH_MAX).flatMap((item) => {
    const row = record(item);
    const from = record(row.From);
    const address = clip(from.Address, 254);
    if (!address) return [];
    const body = clip(row.ExtractedMarkdownMessage, 20_000) ?? clip(row.RawTextBody, 20_000);
    return [{ from: address, ...(clip(from.Name, 200) ? { name: clip(from.Name, 200)! } : {}), ...(clip(row.Subject, 300) ? { subject: clip(row.Subject, 300)! } : {}), ...(body ? { body } : {}) }];
  });
  const events = (Array.isArray(payload) ? payload : [payload]).slice(0, BATCH_MAX).flatMap((item) => {
    const row = record(item);
    const event = clip(row.event, 40);
    const messageId = clip(row["message-id"], 200) ?? clip(row.messageId, 200);
    return event && messageId ? [{ event, messageId, ...(clip(row.reason, 200) ? { reason: clip(row.reason, 200)! } : {}) }] : [];
  });
  const outcome = await ctx.runMutation(internal.pipelineInbound.brevoEvent, { token, replies, events });
  return outcome === "ok" ? Response.json({ ok: true }) : new Response("Unknown webhook", { status: 404 });
});
