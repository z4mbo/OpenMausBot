import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember, touchProject } from "./lib/permissions";
import { cleanText, validDay } from "./lib/features";
import { actorOf, addActivity, leadOf, requireEditor, settingsOf, stagesOf, type PipelineActorValue as Actor } from "./lib/pipelineCore";
import { dealCoachAdvice, salesLineItem } from "./pipelineTables";
import { moveTo, topOrder } from "./pipeline";
import { CLOSED_STAGES, formatLeadValue } from "../../shared/origin-pipeline";
import { SALES_LINE_ITEMS_MAX, dealTotal, type SalesCurrencyTotals } from "../../shared/origin-sales";

const scope = { projectId: v.id("projects"), sessionToken: v.string() };
const agentArg = v.optional(v.object({ name: v.string(), id: v.optional(v.string()) }));
const DEALS_PER_LEAD = 100;
const DEALS_MAX = 500;
const AMOUNT_MAX = 1e12;

type Deal = Doc<"pipelineDeals">;

function amount(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > AMOUNT_MAX) throw new Error(`${label} must be a positive amount`);
  return Math.round(value * 100) / 100;
}

function cleanItems(items: readonly { name: string; quantity: number; unitPrice: number }[]) {
  if (items.length > SALES_LINE_ITEMS_MAX) throw new Error(`A deal has at most ${SALES_LINE_ITEMS_MAX} line items`);
  return items.map((item, index) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1e6) throw new Error(`Line ${index + 1}: the quantity must be above 0`);
    return { name: cleanText(item.name, 120, `Line ${index + 1} name`), quantity: Math.round(item.quantity * 1000) / 1000, unitPrice: amount(item.unitPrice, `Line ${index + 1} price`) };
  });
}

function currencyOf(value: string | undefined, fallback: string) {
  const code = (value ?? fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Currency must be a three-letter code like EUR");
  return code;
}

async function dealOf(ctx: MutationCtx, projectId: Id<"projects">, dealId: Id<"pipelineDeals">) {
  const deal = await ctx.db.get(dealId);
  if (!deal || deal.projectId !== projectId) throw new Error("Deal not found");
  return deal;
}

const money = (deal: Pick<Deal, "currency">, value: number) => formatLeadValue(value, deal.currency);

async function syncLead(ctx: MutationCtx, leadId: Id<"pipelineLeads">, actor: Actor) {
  const lead = await ctx.db.get(leadId);
  if (!lead) return;
  const settings = await settingsOf(ctx, lead.projectId);
  const currency = settings?.currency ?? "EUR";
  const deals = (await ctx.db.query("pipelineDeals").withIndex("by_leadId", (q) => q.eq("leadId", leadId)).take(DEALS_PER_LEAD)).filter((deal) => deal.currency === currency);
  if (!deals.length) return;
  const open = deals.filter((deal) => !CLOSED_STAGES.includes(deal.stage));
  const won = deals.filter((deal) => deal.stage === "Won");
  const sum = (rows: readonly Deal[], pick: (deal: Deal) => number) => Math.round(rows.reduce((total, deal) => total + pick(deal), 0) * 100) / 100;
  const value = open.length ? sum(open, (deal) => deal.value) : won.length ? sum(won, (deal) => deal.wonAmount ?? deal.value) : lead.value;
  if (value !== lead.value) await ctx.db.patch(lead._id, { value, updatedAt: Date.now() });
  const stages = stagesOf(settings);
  const furthest = open.map((deal) => deal.stage).sort((a, b) => stages.indexOf(b) - stages.indexOf(a))[0];
  const target = open.length ? (CLOSED_STAGES.includes(lead.stage) ? furthest : undefined) : won.length ? "Won" : "Lost";
  if (target && target !== lead.stage && stages.includes(target)) await moveTo(ctx, { ...lead, value }, target, await topOrder(ctx, lead.projectId, target), actor);
}

async function close(ctx: MutationCtx, deal: Deal, outcome: "won" | "lost", fields: { amount?: number; reason?: string }, actor: Actor) {
  const now = Date.now();
  const wonAmount = outcome === "won" ? amount(fields.amount ?? deal.value, "The amount won") : undefined;
  await ctx.db.patch(deal._id, {
    stage: outcome === "won" ? "Won" : "Lost", wonAmount, reason: fields.reason, closedAt: now, closedBy: actor, wonRequest: undefined, updatedAt: now,
  });
  const lead = await ctx.db.get(deal.leadId);
  if (lead) {
    await addActivity(ctx, lead, {
      kind: "deal", status: "logged", actor, subject: deal.title,
      body: outcome === "won" ? `Won ${money(deal, wonAmount!)}${fields.reason ? `: ${fields.reason}` : ""}` : `Lost${fields.reason ? `: ${fields.reason}` : ""}`,
    });
  }
  await syncLead(ctx, deal.leadId, actor);
}

const reasonOf = (value: string | undefined) => value?.trim().slice(0, 300) || undefined;

function currencyTotals(rows: readonly Deal[], currency: string): SalesCurrencyTotals {
  const month = new Date();
  const monthStart = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1);
  const same = rows.filter((deal) => deal.currency === currency);
  const won = same.filter((deal) => deal.stage === "Won");
  const open = same.filter((deal) => !CLOSED_STAGES.includes(deal.stage));
  const total = (list: readonly Deal[], pick: (deal: Deal) => number) => Math.round(list.reduce((sum, deal) => sum + pick(deal), 0) * 100) / 100;
  return {
    currency, openValue: total(open, (deal) => deal.value), openCount: open.length,
    wonMonth: total(won.filter((deal) => (deal.closedAt ?? 0) >= monthStart), (deal) => deal.wonAmount ?? deal.value),
    wonTotal: total(won, (deal) => deal.wonAmount ?? deal.value), wonCount: won.length, lostCount: same.filter((deal) => deal.stage === "Lost").length,
  };
}

/** Stripe's word that the link was paid closes the deal as won for what was paid; a second word about the same link changes nothing. */
export async function markPaid(ctx: MutationCtx, deal: Deal, paid: { amount: number; currency: string; checkoutId?: string }) {
  if (!deal.payment || deal.payment.paidAt) return false;
  const paidAmount = amount(paid.amount, "The amount paid");
  const foreign = paid.currency.toUpperCase() !== deal.currency;
  await ctx.db.patch(deal._id, {
    payment: { ...deal.payment, paidAt: Date.now(), paidAmount, ...(foreign ? { paidCurrency: paid.currency.toUpperCase() } : {}), ...(paid.checkoutId ? { checkoutId: paid.checkoutId.slice(0, 100) } : {}) },
  });
  if (deal.stage !== "Won") {
    const fresh = (await ctx.db.get(deal._id))!;
    await close(ctx, fresh, "won", { amount: foreign ? deal.payment.amount : paidAmount, reason: "Paid through Stripe" }, { kind: "system", name: "Stripe" });
  }
  await touchProject(ctx, deal.projectId);
  return true;
}

export const forLead = query({
  args: { ...scope, leadId: v.id("pipelineLeads") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const rows = await ctx.db.query("pipelineDeals").withIndex("by_leadId", (q) => q.eq("leadId", args.leadId)).take(DEALS_PER_LEAD);
    return rows.filter((deal) => deal.projectId === args.projectId).sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const get = query({
  args: { ...scope, dealId: v.id("pipelineDeals") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const deal = await ctx.db.get(args.dealId);
    if (!deal || deal.projectId !== args.projectId) return null;
    const lead = await ctx.db.get(deal.leadId);
    return lead ? { deal, lead } : null;
  },
});

export const list = query({
  args: scope,
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const settings = await settingsOf(ctx, args.projectId);
    const currency = settings?.currency ?? "EUR";
    const deals = await ctx.db.query("pipelineDeals").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(DEALS_MAX);
    const leads = new Map<Id<"pipelineLeads">, Doc<"pipelineLeads"> | null>();
    const rows: (Deal & { leadName: string; leadCompany?: string })[] = [];
    for (const deal of deals) {
      if (!leads.has(deal.leadId)) leads.set(deal.leadId, await ctx.db.get(deal.leadId));
      const lead = leads.get(deal.leadId);
      if (lead) rows.push({ ...deal, leadName: lead.name, ...(lead.company ? { leadCompany: lead.company } : {}) });
    }
    const others = [...new Set(rows.map((deal) => deal.currency).filter((code) => code !== currency))].sort();
    return {
      deals: rows,
      totals: {
        ...currencyTotals(rows, currency), awaitingConfirmation: rows.filter((deal) => deal.wonRequest).length,
        others: others.map((code) => currencyTotals(rows, code)),
      },
    };
  },
});

export const upsert = mutation({
  args: {
    ...scope, dealId: v.optional(v.id("pipelineDeals")), leadId: v.optional(v.id("pipelineLeads")), agent: agentArg,
    title: v.optional(v.string()), value: v.optional(v.number()), currency: v.optional(v.string()), stage: v.optional(v.string()),
    closeDate: v.optional(v.string()), lineItems: v.optional(v.array(salesLineItem)), notes: v.optional(v.string()),
  },
  returns: v.id("pipelineDeals"),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const actor = actorOf(user, args.agent);
    const settings = await settingsOf(ctx, args.projectId);
    const stages = stagesOf(settings);
    const existing = args.dealId ? await dealOf(ctx, args.projectId, args.dealId) : null;
    const lead = await leadOf(ctx, args.projectId, existing?.leadId ?? args.leadId ?? (() => { throw new Error("Choose the contact this deal is with"); })());
    const stage = args.stage === undefined ? undefined : stages.find((name) => name.toLowerCase() === args.stage!.trim().toLowerCase()) ?? (() => { throw new Error(`Stage must be one of ${stages.join(", ")}`); })();
    if (stage && CLOSED_STAGES.includes(stage)) throw new Error(`Mark the deal won or lost to move it to ${stage}`);
    const lineItems = args.lineItems === undefined ? undefined : cleanItems(args.lineItems);
    const value = lineItems?.length ? dealTotal(lineItems) : args.value === undefined ? undefined : amount(args.value, "The value");
    const now = Date.now();
    const fields = {
      ...(args.title !== undefined ? { title: cleanText(args.title, 200, "Deal name") } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(args.currency !== undefined ? { currency: currencyOf(args.currency, "EUR") } : {}),
      ...(stage ? { stage } : {}),
      ...(args.closeDate !== undefined ? { closeDate: args.closeDate.trim() ? validDay(args.closeDate.trim()) : undefined } : {}),
      ...(lineItems ? { lineItems } : {}),
      ...(args.notes !== undefined ? { notes: args.notes.trim().slice(0, 8000) || undefined } : {}),
    };
    if (existing) {
      const reopened = stage && CLOSED_STAGES.includes(existing.stage);
      await ctx.db.patch(existing._id, { ...fields, ...(reopened ? { wonAmount: undefined, reason: undefined, closedAt: undefined, closedBy: undefined } : {}), updatedAt: now });
      if (stage && stage !== existing.stage) await addActivity(ctx, lead, { kind: "deal", status: "logged", actor, subject: existing.title, body: `Moved from ${existing.stage} to ${stage}` });
      await syncLead(ctx, lead._id, actor);
      await touchProject(ctx, args.projectId);
      return existing._id;
    }
    const title = fields.title ?? (lead.company ? `${lead.company} deal` : `${lead.name} deal`);
    const openStage = CLOSED_STAGES.includes(lead.stage) ? stages.find((name) => !CLOSED_STAGES.includes(name))! : lead.stage;
    const dealId = await ctx.db.insert("pipelineDeals", {
      projectId: args.projectId, leadId: lead._id, title, value: fields.value ?? lead.value ?? 0, currency: fields.currency ?? settings?.currency ?? "EUR",
      stage: fields.stage ?? openStage, lineItems: fields.lineItems ?? [], createdBy: actor, createdAt: now, updatedAt: now,
      ...(fields.closeDate ? { closeDate: fields.closeDate } : {}), ...(fields.notes ? { notes: fields.notes } : {}),
    });
    const deal = (await ctx.db.get(dealId))!;
    await addActivity(ctx, lead, { kind: "deal", status: "logged", actor, subject: title, body: `Opened at ${money(deal, deal.value)}` });
    await syncLead(ctx, lead._id, actor);
    await touchProject(ctx, args.projectId);
    return dealId;
  },
});

/** A person closes a deal at once; an agent's "won" only asks, and waits for a person to confirm it. */
export const closeDeal = mutation({
  args: { ...scope, dealId: v.id("pipelineDeals"), outcome: v.union(v.literal("won"), v.literal("lost")), amount: v.optional(v.number()), reason: v.optional(v.string()), agent: agentArg },
  returns: v.union(v.literal("won"), v.literal("lost"), v.literal("requested")),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const deal = await dealOf(ctx, args.projectId, args.dealId);
    if (CLOSED_STAGES.includes(deal.stage)) throw new Error(`${deal.title} is already ${deal.stage}`);
    const actor = actorOf(user, args.agent);
    const reason = reasonOf(args.reason);
    if (args.outcome === "won" && args.agent) {
      const asked = amount(args.amount ?? deal.value, "The amount won");
      await ctx.db.patch(deal._id, { wonRequest: { amount: asked, ...(reason ? { reason } : {}), by: actor, at: Date.now() }, updatedAt: Date.now() });
      const lead = await ctx.db.get(deal.leadId);
      if (lead) await addActivity(ctx, lead, { kind: "deal", status: "logged", actor, subject: deal.title, body: `Asks a person to confirm it was won for ${money(deal, asked)}${reason ? `: ${reason}` : ""}` });
      return "requested";
    }
    await close(ctx, deal, args.outcome, { ...(args.amount !== undefined ? { amount: args.amount } : {}), ...(reason ? { reason } : {}) }, actor);
    await touchProject(ctx, args.projectId);
    return args.outcome;
  },
});

export const confirmWon = mutation({
  args: { ...scope, dealId: v.id("pipelineDeals"), confirm: v.boolean(), amount: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const deal = await dealOf(ctx, args.projectId, args.dealId);
    const request = deal.wonRequest ?? (() => { throw new Error("Nobody asked to mark this deal won"); })();
    if (!args.confirm) {
      await ctx.db.patch(deal._id, { wonRequest: undefined, updatedAt: Date.now() });
      return null;
    }
    await close(ctx, deal, "won", { amount: args.amount ?? request.amount, ...(request.reason ? { reason: request.reason } : {}) }, actorOf(user));
    await touchProject(ctx, args.projectId);
    return null;
  },
});

export const remove = mutation({
  args: { ...scope, dealId: v.id("pipelineDeals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const deal = await dealOf(ctx, args.projectId, args.dealId);
    await ctx.db.delete(deal._id);
    await syncLead(ctx, deal.leadId, actorOf(user));
    return null;
  },
});

export const setPayment = mutation({
  args: { ...scope, dealId: v.id("pipelineDeals"), url: v.string(), linkId: v.string(), amount: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const deal = await dealOf(ctx, args.projectId, args.dealId);
    if (!/^https:\/\/[^\s]{1,500}$/.test(args.url) || !/^plink_[A-Za-z0-9]{1,100}$/.test(args.linkId)) throw new Error("That is not a Stripe payment link");
    const now = Date.now();
    await ctx.db.patch(deal._id, { payment: { url: args.url, linkId: args.linkId, amount: amount(args.amount, "The amount"), createdAt: now }, updatedAt: now });
    const lead = await ctx.db.get(deal.leadId);
    if (lead) await addActivity(ctx, lead, { kind: "deal", status: "logged", actor: actorOf(user), subject: deal.title, body: `Payment link for ${money(deal, args.amount)}: ${args.url}` });
    return null;
  },
});

export const recordPayment = mutation({
  args: { ...scope, dealId: v.id("pipelineDeals"), linkId: v.string(), paidAmount: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const deal = await dealOf(ctx, args.projectId, args.dealId);
    if (!deal.payment || deal.payment.linkId !== args.linkId) throw new Error("That payment link is not this deal's");
    await markPaid(ctx, deal, { amount: args.paidAmount, currency: deal.currency });
    return null;
  },
});

export const saveCoach = mutation({
  args: { ...scope, dealId: v.id("pipelineDeals"), agent: agentArg, coach: dealCoachAdvice },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const deal = await dealOf(ctx, args.projectId, args.dealId);
    const { coach } = args;
    const clip = (value: string, max: number) => value.trim().slice(0, max);
    await ctx.db.patch(deal._id, {
      coach: {
        nextAction: cleanText(coach.nextAction, 300, "Next action"), risk: coach.risk, riskReason: clip(coach.riskReason, 400),
        followUp: { channel: coach.followUp.channel, body: cleanText(coach.followUp.body, 4_000, "Follow-up"), ...(coach.followUp.subject?.trim() ? { subject: clip(coach.followUp.subject, 300) } : {}) },
        by: actorOf(user, args.agent).name, at: Date.now(),
      },
    });
    return null;
  },
});
