import { brandVoiceGuide, type BrandKit } from "../shared/brand-kit.ts";
import type { PipelineActivity, PipelineLead } from "../shared/origin-pipeline.ts";
import {
  dealCoachPrompt, majorUnits, minorUnits, parseDealCoach, parseSuggestedReply, reachableChannels, suggestReplyPrompt, type DealCoach, type SalesDeal, type SalesReplyChannel,
} from "../shared/origin-sales.ts";
import type { OriginCloudClient } from "./origin-cloud.ts";
import { projectIntegrationKey } from "./integration-keys.ts";

type Args = Record<string, unknown>;
const record = (value: unknown): Args => (value && typeof value === "object" && !Array.isArray(value) ? value as Args : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const PROVIDER_TIMEOUT_MS = 20_000;

export { majorUnits, minorUnits };

export class SalesError extends Error {}

export interface SalesKeys {
  stripe(projectId?: string): { secretKey: string } | null;
}

export interface SalesServiceDeps {
  keys?: SalesKeys;
  fetch?: typeof fetch;
  /** Test hook: every Stripe request goes to this loopback origin instead. */
  providerOrigin?: string | undefined;
  /** The cheap quick-call model, the one call summaries use. */
  generate?(input: { botId: string; prompt: string }): Promise<string>;
}

type Scope = { client: OriginCloudClient; sessionToken: string; projectId: string };

export interface SalesService {
  stripeConnected(projectId?: string): boolean;
  quote(input: Scope & { dealId: string }): Promise<{ url: string; amount: number }>;
  checkPayment(input: Scope & { dealId: string }): Promise<{ paid: boolean; amount?: number }>;
  suggest(input: Scope & { leadId: string; channel: SalesReplyChannel; botId: string; projectName: string }): Promise<{ subject?: string; body: string }>;
  coach(input: CoachInput): Promise<DealCoach>;
}

type Generate = (input: { botId: string; prompt: string }) => Promise<string>;
export type CoachInput = Scope & { dealId: string; botId: string; projectName: string; agent?: { name: string; id?: string } };

/** Reads the deal, its contact's timeline and the brand voice, asks the cheap model, and keeps its answer on the deal. */
export async function coachDeal(input: CoachInput, generate: Generate): Promise<DealCoach> {
  const base = { sessionToken: input.sessionToken, projectId: input.projectId };
  const found = record(await input.client.query("pipelineDeals:get", { ...base, dealId: input.dealId }));
  if (!found.deal) throw new SalesError("No such deal");
  const deal = found.deal as SalesDeal;
  const lead = found.lead as PipelineLead;
  const detail = record(await input.client.query("pipeline:lead", { ...base, leadId: lead._id }));
  const kit = await input.client.query("brand:get", base).catch(() => null) as Pick<BrandKit, "name" | "tagline" | "voice"> | null;
  const channels = reachableChannels(lead);
  const prompt = dealCoachPrompt({
    projectName: input.projectName, today: new Date().toISOString().slice(0, 10), voice: kit?.voice ? brandVoiceGuide(kit) : "", channels, deal, lead,
    activities: (Array.isArray(detail.activities) ? detail.activities : []) as PipelineActivity[],
  });
  let coach: Omit<DealCoach, "by" | "at">;
  try {
    coach = parseDealCoach(await generate({ botId: input.botId, prompt }), channels);
  } catch (error) {
    throw new SalesError(error instanceof Error ? error.message : "The model could not coach this deal");
  }
  await input.client.mutation("pipelineDeals:saveCoach", { ...base, dealId: deal._id, coach, ...(input.agent ? { agent: input.agent } : {}) });
  const saved = record(await input.client.query("pipelineDeals:get", { ...base, dealId: deal._id }));
  return (record(saved.deal).coach as DealCoach | undefined) ?? { ...coach, by: input.agent?.name ?? "", at: Date.now() };
}

/** Stripe prices take whole quantities only, so a fractional line becomes one price for the whole deal. */
export function stripeLines(deal: Pick<SalesDeal, "title" | "value" | "currency" | "lineItems">): { name: string; unitAmount: number; quantity: number }[] {
  const whole = deal.lineItems.length > 0 && deal.lineItems.every((item) => Number.isInteger(item.quantity));
  const lines = whole
    ? deal.lineItems.map((item) => ({ name: item.name, unitAmount: minorUnits(item.unitPrice, deal.currency), quantity: item.quantity }))
    : [{ name: deal.title, unitAmount: minorUnits(deal.value, deal.currency), quantity: 1 }];
  if (!lines.some((line) => line.unitAmount > 0)) throw new SalesError("Give the deal a value before asking for payment");
  return lines.filter((line) => line.unitAmount > 0);
}

export function createSalesService(deps: SalesServiceDeps = {}): SalesService {
  const keys = deps.keys ?? { stripe: (projectId) => projectIntegrationKey("stripe", projectId) };
  const doFetch = deps.fetch ?? fetch;
  const stripeBase = deps.providerOrigin ?? "https://api.stripe.com";

  async function stripe(projectId: string, path: string, form?: URLSearchParams): Promise<Args> {
    const key = keys.stripe(projectId)?.secretKey ?? (() => { throw new SalesError("Connect Stripe under Settings > Integrations to send payment links"); })();
    let response: Response;
    try {
      response = await doFetch(`${stripeBase}${path}`, {
        method: form ? "POST" : "GET",
        headers: { Authorization: `Bearer ${key}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        ...(form ? { body: form.toString() } : {}),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      throw new SalesError(`Stripe could not be reached${error instanceof Error && error.name === "TimeoutError" ? " in time" : ""}`);
    }
    const body = record(await response.json().catch(() => ({})));
    if (!response.ok) throw new SalesError(`Stripe refused the request (HTTP ${response.status})${text(record(body.error).message) ? `: ${text(record(body.error).message).slice(0, 300)}` : ""}`);
    return body;
  }

  async function dealOf(input: Scope & { dealId: string }) {
    const found = record(await input.client.query("pipelineDeals:get", { sessionToken: input.sessionToken, projectId: input.projectId, dealId: input.dealId }));
    if (!found.deal) throw new SalesError("No such deal");
    return { deal: found.deal as SalesDeal, lead: found.lead as PipelineLead };
  }

  return {
    stripeConnected: (projectId) => Boolean(keys.stripe(projectId)),

    async quote(input) {
      const { deal } = await dealOf(input);
      if (deal.stage === "Won" || deal.stage === "Lost") throw new SalesError(`${deal.title} is already ${deal.stage}`);
      const currency = deal.currency.toLowerCase();
      const form = new URLSearchParams();
      for (const [index, line] of stripeLines(deal).entries()) {
        const price = await stripe(input.projectId, "/v1/prices", new URLSearchParams({ currency, unit_amount: String(line.unitAmount), "product_data[name]": line.name.slice(0, 250) }));
        form.set(`line_items[${index}][price]`, text(price.id));
        form.set(`line_items[${index}][quantity]`, String(line.quantity));
      }
      form.set("metadata[origin_deal]", deal._id);
      form.set("metadata[origin_project]", input.projectId);
      const link = await stripe(input.projectId, "/v1/payment_links", form);
      const url = text(link.url);
      const linkId = text(link.id);
      if (!url || !linkId) throw new SalesError("Stripe made no payment link");
      await input.client.mutation("pipelineDeals:setPayment", { sessionToken: input.sessionToken, projectId: input.projectId, dealId: deal._id, url, linkId, amount: deal.value });
      return { url, amount: deal.value };
    },

    async checkPayment(input) {
      const { deal } = await dealOf(input);
      const payment = deal.payment ?? (() => { throw new SalesError("This deal has no payment link yet"); })();
      if (payment.paidAt) return { paid: true, amount: payment.paidAmount ?? payment.amount };
      const query = new URLSearchParams({ payment_link: payment.linkId, status: "complete", limit: "1" });
      const sessions = await stripe(input.projectId, `/v1/checkout/sessions?${query.toString()}`);
      const session = record(Array.isArray(sessions.data) ? sessions.data[0] : undefined);
      if (!text(session.id)) return { paid: false };
      const amount = majorUnits(Number(session.amount_total) || 0, text(session.currency) || deal.currency);
      await input.client.mutation("pipelineDeals:recordPayment", { sessionToken: input.sessionToken, projectId: input.projectId, dealId: deal._id, linkId: payment.linkId, paidAmount: amount });
      return { paid: true, amount };
    },

    async coach(input) {
      if (!deps.generate) throw new SalesError("The deal coach needs a model; choose one under Settings");
      return coachDeal(input, deps.generate);
    },

    async suggest(input) {
      if (!deps.generate) throw new SalesError("Suggestions need a model; choose one under Settings");
      const base = { sessionToken: input.sessionToken, projectId: input.projectId };
      const detail = record(await input.client.query("pipeline:lead", { ...base, leadId: input.leadId }));
      if (!detail.lead) throw new SalesError("No such contact");
      const kit = await input.client.query("brand:get", base).catch(() => null) as Pick<BrandKit, "name" | "tagline" | "voice"> | null;
      const prompt = suggestReplyPrompt({
        projectName: input.projectName, lead: detail.lead as PipelineLead, activities: (Array.isArray(detail.activities) ? detail.activities : []) as PipelineActivity[],
        channel: input.channel, voice: kit?.voice ? brandVoiceGuide(kit) : "",
      });
      try {
        return parseSuggestedReply(await deps.generate({ botId: input.botId, prompt }), input.channel);
      } catch (error) {
        throw new SalesError(error instanceof Error ? error.message : "The model could not suggest a reply");
      }
    },
  };
}
