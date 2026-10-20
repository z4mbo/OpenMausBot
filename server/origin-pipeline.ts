import { normalizeLeadPhone, type PipelineChannel } from "../shared/origin-pipeline.ts";
import { parseSummary, summaryPrompt, type CallSummary } from "./origin-call-agent.ts";
import type { OriginCloudClient } from "./origin-cloud.ts";
import { connectedConvex, originSessionToken } from "./origin-members.ts";
import { integrationKey } from "./integration-keys.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import { createSalesService, SalesError, type SalesService } from "./origin-sales.ts";
import { SALES_REPLY_CHANNELS, type SalesReplyChannel } from "../shared/origin-sales.ts";

type Args = Record<string, unknown>;

export interface PipelineProviderKeys {
  brevo(): { apiKey: string; senderEmail: string; senderName?: string } | null;
  twilio(): { accountSid: string; authToken: string; fromNumber: string } | null;
  elevenlabs(): { apiKey: string } | null;
}

export interface PipelineSenderDeps {
  keys?: PipelineProviderKeys;
  fetch?: typeof fetch;
  /** The cheap model that writes call summaries, chosen for this bot the way live call summaries are. */
  summarize?(input: { botId: string; prompt: string }): Promise<string>;
  /** Test hook: every provider request goes to this loopback origin instead. */
  providerOrigin?: string;
  pollMs?: number;
  pollTries?: number;
  log?(line: string): void;
}

export type PipelineSendInput = { client: OriginCloudClient; sessionToken: string; projectId: string; activityId: string; botId?: string; callerPhone?: string };
export type PipelineSendResult = { ok: true; status: "sent" | "in_progress"; message: string } | { ok: false; error: string };
export type PipelineRefreshInput = { client: OriginCloudClient; sessionToken: string; projectId: string; leadId: string; activityId: string; botId?: string };

export interface PipelineSender {
  send(input: PipelineSendInput): Promise<PipelineSendResult>;
  refresh(input: PipelineRefreshInput): Promise<{ status: "in_progress" | "done" | "failed"; summary?: string }>;
  channels(): Record<PipelineChannel, boolean>;
}

const record = (value: unknown): Args => (value && typeof value === "object" && !Array.isArray(value) ? value as Args : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const PROVIDER_TIMEOUT_MS = 20_000;
const SUMMARY_TRANSCRIPT_CHARS = 60_000;

class ProviderError extends Error {}

export const defaultPipelineKeys: PipelineProviderKeys = {
  brevo: () => integrationKey("brevo"),
  twilio: () => integrationKey("twilio"),
  elevenlabs: () => integrationKey("elevenlabs"),
};

/** Security: the override only ever points at this computer, so a fixture can never redirect real keys elsewhere. */
export function loopbackProviderOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && url.pathname === "/" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function providerMessage(status: number, body: unknown, provider: string): string {
  const value = record(body);
  const detail = record(value.detail);
  const reason = text(value.message) || text(detail.message) || text(value.detail) || text(value.error_message) || text(value.code);
  return `${provider} refused the request (HTTP ${status})${reason ? `: ${reason.slice(0, 300)}` : ""}`;
}

function senderName(name: string | undefined, email: string) {
  return { email, ...(name?.trim() ? { name: name.trim().slice(0, 70) } : {}) };
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function transcriptOf(raw: unknown, leadName: string): string {
  const turns = Array.isArray(raw) ? raw.map(record) : [];
  return turns.map((turn) => {
    const message = text(turn.message).trim();
    if (!message) return "";
    const at = Number(turn.time_in_call_secs);
    const stamp = Number.isFinite(at) ? `[${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, "0")}] ` : "";
    return `${stamp}${turn.role === "agent" ? "Agent" : leadName}: ${message}`;
  }).filter(Boolean).join("\n");
}

export function summaryText(summary: CallSummary): string {
  const section = (title: string, items: readonly string[]) => (items.length ? `${title}\n${items.map((item) => `- ${item}`).join("\n")}` : "");
  return [
    section("Key points", summary.keyPoints),
    section("Decisions", summary.decisions),
    section("Next steps", summary.actionItems.map((item) => (item.owner ? `${item.title} (${item.owner})` : item.title))),
  ].filter(Boolean).join("\n\n");
}

export function createPipelineSender(deps: PipelineSenderDeps = {}): PipelineSender {
  const keys = deps.keys ?? defaultPipelineKeys;
  const doFetch = deps.fetch ?? fetch;
  const origin = (real: string) => deps.providerOrigin ?? real;
  const pollMs = deps.pollMs ?? 30_000;
  const pollTries = deps.pollTries ?? 40;

  async function call(provider: string, url: string, init: RequestInit): Promise<Args> {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    } catch (error) {
      throw new ProviderError(`${provider} could not be reached${error instanceof Error && error.name === "TimeoutError" ? " in time" : ""}`);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ProviderError(providerMessage(response.status, body, provider));
    return record(body);
  }

  const twilioAuth = (twilio: NonNullable<ReturnType<PipelineProviderKeys["twilio"]>>) =>
    `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64")}`;

  async function email(activity: Args, lead: Args, replyTo: string): Promise<string> {
    const brevo = keys.brevo() ?? (() => { throw new ProviderError("Connect Brevo under Settings > Integrations to send email"); })();
    const result = await call("Brevo", `${origin("https://api.brevo.com")}/v3/smtp/email`, {
      method: "POST",
      headers: { "api-key": brevo.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: senderName(brevo.senderName, brevo.senderEmail),
        to: [{ email: text(lead.email), ...(text(lead.name) ? { name: text(lead.name).slice(0, 70) } : {}) }],
        subject: text(activity.subject), textContent: text(activity.body),
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      }),
    });
    return text(result.messageId);
  }

  async function textMessage(activity: Args, lead: Args, whatsapp: boolean, statusCallback: string): Promise<string> {
    const twilio = keys.twilio() ?? (() => { throw new ProviderError("Connect Twilio under Settings > Integrations to send messages"); })();
    const prefix = whatsapp ? "whatsapp:" : "";
    const result = await call("Twilio", `${origin("https://api.twilio.com")}/2010-04-01/Accounts/${encodeURIComponent(twilio.accountSid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: twilioAuth(twilio), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: `${prefix}${text(lead.phone)}`, From: `${prefix}${twilio.fromNumber}`, Body: text(activity.body), ...(statusCallback ? { StatusCallback: statusCallback } : {}) }).toString(),
    });
    return text(result.sid);
  }

  async function bridge(lead: Args, callerPhone: string | undefined, statusCallback: string): Promise<string> {
    const twilio = keys.twilio() ?? (() => { throw new ProviderError("Connect Twilio under Settings > Integrations to place calls"); })();
    const member = normalizeLeadPhone(callerPhone) ?? (() => { throw new ProviderError("Enter your own phone number, with its country code, so Twilio can ring you first"); })();
    const twiml = `<Response><Say>Connecting you to ${escapeXml(text(lead.name).slice(0, 80))}.</Say><Dial callerId="${escapeXml(twilio.fromNumber)}"><Number>${escapeXml(text(lead.phone))}</Number></Dial></Response>`;
    const result = await call("Twilio", `${origin("https://api.twilio.com")}/2010-04-01/Accounts/${encodeURIComponent(twilio.accountSid)}/Calls.json`, {
      method: "POST",
      headers: { Authorization: twilioAuth(twilio), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: member, From: twilio.fromNumber, Twiml: twiml, ...(statusCallback ? { StatusCallback: statusCallback } : {}) }).toString(),
    });
    return text(result.sid);
  }

  async function aiCall(activity: Args, lead: Args, ai: Args): Promise<string> {
    const eleven = keys.elevenlabs() ?? (() => { throw new ProviderError("Connect ElevenLabs under Settings > Integrations to place AI calls"); })();
    const agentId = text(ai.agentId);
    const phoneId = text(ai.phoneNumberId);
    if (!agentId || !phoneId) throw new ProviderError("Set the ElevenLabs agent and phone number ids in Pipeline settings first");
    const goal = text(activity.goal);
    const result = await call("ElevenLabs", `${origin("https://api.elevenlabs.io")}/v1/convai/twilio/outbound-call`, {
      method: "POST",
      headers: { "xi-api-key": eleven.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId, agent_phone_number_id: phoneId, to_number: text(lead.phone),
        conversation_initiation_client_data: {
          dynamic_variables: { lead_name: text(lead.name), lead_company: text(lead.company), call_goal: goal },
          conversation_config_override: { agent: { prompt: { prompt: goal } } },
        },
      }),
    });
    if (result.success === false) throw new ProviderError(`ElevenLabs could not start the call${text(result.message) ? `: ${text(result.message).slice(0, 300)}` : ""}`);
    const conversation = text(result.conversation_id);
    if (!conversation) throw new ProviderError("ElevenLabs started no conversation");
    return conversation;
  }

  async function summarize(transcript: string, leadName: string, botId: string | undefined, fallback: string): Promise<string> {
    if (deps.summarize && botId && transcript) {
      try {
        const raw = await deps.summarize({ botId, prompt: summaryPrompt({ callName: `AI sales call with ${leadName}`, chief: "the project's Chief", transcript: transcript.slice(-SUMMARY_TRANSCRIPT_CHARS) }) });
        const written = summaryText(parseSummary(raw));
        if (written) return written;
      } catch (error) {
        deps.log?.(`pipeline: the call summary failed (${error instanceof Error ? error.message : "unknown"})`);
      }
    }
    return fallback;
  }

  async function refresh(input: PipelineRefreshInput & { leadName?: string; conversationId?: string }) {
    const base = { sessionToken: input.sessionToken, projectId: input.projectId };
    let leadName = input.leadName;
    let conversationId = input.conversationId;
    if (!leadName || !conversationId) {
      const detail = record(await input.client.query("pipeline:lead", { ...base, leadId: input.leadId }));
      const activity = (Array.isArray(detail.activities) ? detail.activities.map(record) : []).find((row) => row._id === input.activityId);
      if (!activity || activity.kind !== "ai_call") throw new ProviderError("No such AI call");
      if (activity.status !== "in_progress") return { status: activity.status === "failed" ? "failed" as const : "done" as const, ...(text(activity.summary) ? { summary: text(activity.summary) } : {}) };
      leadName = text(record(detail.lead).name) || "Lead";
      conversationId = text(activity.providerId);
    }
    const eleven = keys.elevenlabs() ?? (() => { throw new ProviderError("Connect ElevenLabs under Settings > Integrations"); })();
    const conversation = await call("ElevenLabs", `${origin("https://api.elevenlabs.io")}/v1/convai/conversations/${encodeURIComponent(conversationId)}`, {
      headers: { "xi-api-key": eleven.apiKey },
    });
    const status = text(conversation.status);
    if (status !== "done" && status !== "failed") return { status: "in_progress" as const };
    const transcript = transcriptOf(conversation.transcript, leadName);
    const fallback = text(record(conversation.analysis).transcript_summary);
    const summary = status === "done" ? await summarize(transcript, leadName, input.botId, fallback) : fallback;
    await input.client.mutation("pipeline:finishContact", {
      ...base, activityId: input.activityId, status: status === "done" ? "done" : "failed",
      ...(transcript ? { transcript } : {}), ...(summary ? { summary } : {}), ...(status === "failed" ? { error: "The call did not connect or ended with an error" } : {}),
    });
    return { status: status === "done" ? "done" as const : "failed" as const, ...(summary ? { summary } : {}) };
  }

  function follow(input: PipelineRefreshInput & { leadName: string; conversationId: string }, tries = 0) {
    if (tries >= pollTries) return;
    const timer = setTimeout(() => {
      refresh(input).then((result) => {
        if (result.status === "in_progress") follow(input, tries + 1);
      }, (error: unknown) => {
        deps.log?.(`pipeline: checking an AI call failed (${error instanceof Error ? error.message : "unknown"})`);
        follow(input, tries + 1);
      });
    }, pollMs);
    timer.unref?.();
  }

  return {
    channels: () => {
      const twilio = Boolean(keys.twilio());
      return { email: Boolean(keys.brevo()), sms: twilio, whatsapp: twilio, call: twilio, ai_call: Boolean(keys.elevenlabs()) };
    },
    refresh: (input) => refresh(input),
    async send(input) {
      const base = { sessionToken: input.sessionToken, projectId: input.projectId };
      const claimed = record(await input.client.mutation("pipeline:claimContact", { ...base, activityId: input.activityId }));
      const activity = record(claimed.activity);
      const lead = record(claimed.lead);
      const kind = text(activity.kind);
      const statusCallback = text(claimed.statusCallback);
      try {
        const providerId = kind === "email" ? await email(activity, lead, text(claimed.replyTo))
          : kind === "sms" || kind === "whatsapp" ? await textMessage(activity, lead, kind === "whatsapp", statusCallback)
          : kind === "call" ? await bridge(lead, input.callerPhone, statusCallback)
          : kind === "ai_call" ? await aiCall(activity, lead, record(claimed.ai))
          : (() => { throw new ProviderError(`A ${kind} cannot be sent`); })();
        const status = kind === "ai_call" ? "in_progress" as const : "sent" as const;
        await input.client.mutation("pipeline:finishContact", { ...base, activityId: input.activityId, status, ...(providerId ? { providerId } : {}) });
        if (kind === "ai_call") follow({ ...input, leadId: text(lead._id), leadName: text(lead.name) || "Lead", conversationId: providerId });
        const name = text(lead.name);
        const outcome = kind === "email" ? `Emailed ${name}.` : kind === "call" ? `Calling you now; Twilio connects you to ${name} when you answer.`
          : kind === "ai_call" ? `The AI agent is calling ${name}. Its transcript and summary land in the timeline when the call ends.` : `Sent the ${kind === "whatsapp" ? "WhatsApp message" : "text"} to ${name}.`;
        return { ok: true, status, message: outcome };
      } catch (error) {
        const reason = error instanceof ProviderError ? error.message : "The contact could not be sent";
        await input.client.mutation("pipeline:finishContact", { ...base, activityId: input.activityId, status: "failed", error: reason }).catch(() => undefined);
        return { ok: false, error: reason };
      }
    },
  };
}

const CONVEX_ID = /^[A-Za-z0-9]{10,64}$/;

function convexMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /Uncaught Error: ([^\n]+)/.exec(message)?.[1]?.trim() || (error instanceof ProviderError || error instanceof SalesError ? message : "Origin refused the request");
}

export interface PipelineRouteDeps {
  sender: PipelineSender;
  convex?: () => OriginCloudClient | null;
  sales?: SalesService;
  /** For the default Sales service: the quick-call model that suggests replies, and the loopback Stripe of a fixture. */
  generate?(input: { botId: string; prompt: string }): Promise<string>;
  providerOrigin?: string | undefined;
}

const SALES_PATHS = new Set(["/api/origin/pipeline/send", "/api/origin/pipeline/refresh", "/api/origin/pipeline/suggest", "/api/origin/pipeline/quote", "/api/origin/pipeline/quote/check"]);

/** The renderer's Sales calls; each carries the person's own Origin session, so Convex checks their project role. */
export function createPipelineRoutes(deps: PipelineRouteDeps): RouteHandler {
  const convex = deps.convex ?? connectedConvex;
  const sales = deps.sales ?? createSalesService({ ...(deps.generate ? { generate: deps.generate } : {}), providerOrigin: deps.providerOrigin });
  return async ({ req, res, path, method, json, readBody }) => {
    if (!path.startsWith("/api/origin/pipeline/")) return PASS;
    if (path === "/api/origin/pipeline/channels" && method === "GET") return json(res, 200, { channels: deps.sender.channels(), stripe: sales.stripeConnected() });
    if (method !== "POST" || !SALES_PATHS.has(path)) return PASS;
    const body = record(await readBody(req));
    const sessionToken = originSessionToken(req, body);
    const client = convex();
    if (!sessionToken || !client) return json(res, 401, { error: "Sign in to Origin first" });
    const action = path.slice("/api/origin/pipeline/".length);
    const keys = ["projectId", ...(action === "suggest" ? ["leadId"] : action.startsWith("quote") ? ["dealId"] : ["activityId", ...(action === "refresh" ? ["leadId"] : [])])];
    const ids = Object.fromEntries(keys.map((key) => [key, text(body[key])]));
    if (Object.values(ids).some((id) => !CONVEX_ID.test(id))) return json(res, 400, { error: `${keys.join(", ")} must be Origin ids` });
    const scope = { client, sessionToken, projectId: ids.projectId! };
    const botId = text(body.botId).slice(0, 120) || undefined;
    try {
      if (action === "send") {
        const result = await deps.sender.send({ ...scope, activityId: ids.activityId!, ...(botId ? { botId } : {}), ...(text(body.callerPhone) ? { callerPhone: text(body.callerPhone) } : {}) });
        return json(res, result.ok ? 200 : 502, result);
      }
      if (action === "refresh") return json(res, 200, await deps.sender.refresh({ ...scope, activityId: ids.activityId!, leadId: ids.leadId!, ...(botId ? { botId } : {}) }));
      if (action === "quote") return json(res, 200, await sales.quote({ ...scope, dealId: ids.dealId! }));
      if (action === "quote/check") return json(res, 200, await sales.checkPayment({ ...scope, dealId: ids.dealId! }));
      const channel = text(body.channel) as SalesReplyChannel;
      if (!SALES_REPLY_CHANNELS.includes(channel)) return json(res, 400, { error: `channel must be one of ${SALES_REPLY_CHANNELS.join(", ")}` });
      if (!botId) return json(res, 400, { error: "Name the agent whose model suggests the reply" });
      return json(res, 200, await sales.suggest({ ...scope, leadId: ids.leadId!, channel, botId, projectName: text(body.projectName).slice(0, 120) || "this project" }));
    } catch (error) {
      return json(res, error instanceof SalesError ? 502 : 400, { ok: false, error: convexMessage(error) });
    }
  };
}
