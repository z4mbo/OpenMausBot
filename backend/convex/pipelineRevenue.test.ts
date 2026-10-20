/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { createSession } from "./lib/auth";
import { stripeSignature, verifyStripeSignature } from "./pipelineStripe";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

const SITE = "https://fixture.convex.site";
// Synthetic test values: a sealing key and a Stripe signing secret that only this in-memory backend ever sees.
const SEALING_KEY = "0f".repeat(32);
const SIGNING_SECRET = "whsec_fixtureSigningSecret0000000000";

async function fixture() {
  vi.stubEnv("CONVEX_SITE_URL", SITE);
  vi.stubEnv("ORIGIN_SEALING_KEY", SEALING_KEY);
  const t = convexTest(schema, modules);
  const people = await t.run(async ctx => {
    const make = async (name: string) => {
      const id = await ctx.db.insert("users", { name, email: `${name}@revenue.test`, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
      return { id, email: `${name}@revenue.test`, token: await createSession(ctx, id) };
    };
    return { owner: await make("owner"), member: await make("member") };
  });
  const sessionToken = people.owner.token;
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Revenue" });
  await t.run(ctx => ctx.db.insert("teamMembers", { teamId, userId: people.member.id, email: people.member.email, name: "member", role: "member", status: "active", createdAt: 1, updatedAt: 1 }));
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Launch" });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken, projectId, email: people.member.email, role: "member" });
  return { t, people, teamId, scope: { sessionToken, projectId } };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function stripeEvent(f: Fixture, url: string, event: object, secret = SIGNING_SECRET, at = Math.floor(Date.now() / 1000)) {
  const payload = JSON.stringify(event);
  const signature = await stripeSignature(secret, String(at), payload);
  return f.t.fetch(url.replace(SITE, ""), { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${at},v1=${signature}` }, body: payload });
}

const checkout = (linkId: string, amountTotal: number, type = "checkout.session.completed") => ({
  id: "evt_fixture", type, data: { object: { id: "cs_fixture", payment_link: linkId, amount_total: amountTotal, currency: "eur", payment_status: "paid" } },
});

test("Stripe signatures need the right secret, a v1 entry and a fresh timestamp", async () => {
  const now = Date.UTC(2026, 9, 20) / 1000;
  const good = await stripeSignature(SIGNING_SECRET, String(now), "{}");
  expect(await verifyStripeSignature(SIGNING_SECRET, `t=${now},v0=abc,v1=${good}`, "{}", now * 1000)).toBe(true);
  expect(await verifyStripeSignature(SIGNING_SECRET, `t=${now},v1=${good}`, "{ }", now * 1000)).toBe(false);
  expect(await verifyStripeSignature("whsec_other000000000000000", `t=${now},v1=${good}`, "{}", now * 1000)).toBe(false);
  expect(await verifyStripeSignature(SIGNING_SECRET, `t=${now},v1=${good}`, "{}", (now + 301) * 1000)).toBe(false);
  expect(await verifyStripeSignature(SIGNING_SECRET, `t=${now}`, "{}", now * 1000)).toBe(false);
});

test("a signed Stripe checkout marks the deal won live, once; the secret is sealed and never returned", async () => {
  const f = await fixture();
  await expect(f.t.action(api.pipelineStripe.configure, { ...f.scope, sessionToken: f.people.member.token, enabled: true })).rejects.toThrow("Admin role required");
  await expect(f.t.action(api.pipelineStripe.configure, { ...f.scope, enabled: true, signingSecret: "sk_live_nope" })).rejects.toThrow("whsec_");
  await f.t.action(api.pipelineStripe.configure, { ...f.scope, enabled: true });
  const pending = (await f.t.query(api.pipeline.board, f.scope)).settings.stripeWebhook!;
  expect(pending).toMatchObject({ url: expect.stringMatching(/^https:\/\/fixture\.convex\.site\/pipeline\/stripe\?token=[a-f0-9]{48}$/), signing: false });
  expect((await stripeEvent(f, pending.url, checkout("plink_1", 100))).status).toBe(403);

  await f.t.action(api.pipelineStripe.configure, { ...f.scope, enabled: true, signingSecret: SIGNING_SECRET });
  const view = (await f.t.query(api.pipeline.board, f.scope)).settings.stripeWebhook!;
  expect(view).toEqual({ url: pending.url, signing: true });
  const stored = await f.t.run(ctx => ctx.db.query("pipelineSettings").first());
  expect(stored?.stripeSecret).toBeTruthy();
  expect(stored?.stripeSecret).not.toContain("fixtureSigningSecret");
  expect(JSON.stringify(await f.t.query(api.pipeline.board, f.scope))).not.toContain(stored!.stripeSecret!);

  const { leadId } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "Ada", email: "ada@x.test" });
  const dealId = await f.t.mutation(api.pipelineDeals.upsert, { ...f.scope, leadId, title: "Annual", value: 900 });
  await f.t.mutation(api.pipelineDeals.setPayment, { ...f.scope, dealId, url: "https://buy.stripe.com/test_1", linkId: "plink_fixture1", amount: 900 });

  expect((await stripeEvent(f, view.url, checkout("plink_fixture1", 90000), "whsec_wrongSecret00000000000")).status).toBe(400);
  expect((await stripeEvent(f, view.url, checkout("plink_fixture1", 90000), SIGNING_SECRET, Math.floor(Date.now() / 1000) - 3_600)).status).toBe(400);
  expect((await stripeEvent(f, `${SITE}/pipeline/stripe?token=${"0".repeat(48)}`, checkout("plink_fixture1", 90000))).status).toBe(404);
  const unpaid = await stripeEvent(f, view.url, { ...checkout("plink_fixture1", 90000), data: { object: { ...checkout("plink_fixture1", 90000).data.object, payment_status: "unpaid" } } });
  expect(await unpaid.json()).toMatchObject({ outcome: "ignored" });
  expect((await f.t.query(api.pipelineDeals.forLead, { ...f.scope, leadId }))[0]?.stage).not.toBe("Won");

  const won = await stripeEvent(f, view.url, checkout("plink_fixture1", 90000));
  expect(won.status).toBe(200);
  expect(await won.json()).toEqual({ received: true, outcome: "won" });
  const [deal] = await f.t.query(api.pipelineDeals.forLead, { ...f.scope, leadId });
  expect(deal).toMatchObject({ stage: "Won", wonAmount: 900, reason: "Paid through Stripe", closedBy: { kind: "system", name: "Stripe" }, payment: { paidAmount: 900, checkoutId: "cs_fixture" } });
  expect(await (await stripeEvent(f, view.url, checkout("plink_fixture1", 90000, "checkout.session.async_payment_succeeded"))).json()).toMatchObject({ outcome: "duplicate" });
  expect(await (await stripeEvent(f, view.url, checkout("plink_unknown", 100))).json()).toMatchObject({ outcome: "unknown" });

  await f.t.action(api.pipelineStripe.configure, { ...f.scope, enabled: false });
  expect((await f.t.query(api.pipeline.board, f.scope)).settings.stripeWebhook).toBeUndefined();
  expect((await stripeEvent(f, view.url, checkout("plink_fixture1", 90000))).status).toBe(404);
});

test("merging contacts moves their notifications and campaign links to the one that stays", async () => {
  const f = await fixture();
  const { leadId: keep } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "Grace", phone: "+15550001001" });
  const { leadId: twin } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "G. Hopper", email: "grace@navy.test" });
  const { teamId, projectId } = { teamId: f.teamId, projectId: f.scope.projectId };
  await f.t.run(async ctx => {
    await ctx.db.insert("notifications", { teamId, userId: f.people.member.id, actorId: f.people.member.id, kind: "lead", eventId: "pipeline-reply:x", projectId, leadId: twin, preview: "G. Hopper: hello", read: false, createdAt: 1 });
    await ctx.db.insert("campaigns", { projectId, name: "Launch", slug: "launch", goal: "", audience: "", channels: [], status: "running", postIds: [], generationIds: [], leadIds: [keep, twin], taskIds: [], metrics: [], createdBy: f.people.owner.id, createdAt: 1, updatedAt: 1 });
  });
  await f.t.mutation(api.pipelineContacts.merge, { ...f.scope, primaryId: keep, otherIds: [twin] });
  const notes = await f.t.run(ctx => ctx.db.query("notifications").collect());
  expect(notes.map(note => note.leadId)).toEqual([keep]);
  const listed = await f.t.query(api.notifications.list, { sessionToken: f.people.member.token, teamId, unreadOnly: true, paginationOpts: { numItems: 10, cursor: null } });
  expect(listed.page[0]).toMatchObject({ leadId: keep, available: true });
  expect((await f.t.run(ctx => ctx.db.query("campaigns").first()))?.leadIds).toEqual([keep]);
});

test("deal totals keep other currencies apart instead of mixing them in", async () => {
  const f = await fixture();
  const { leadId } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "Ada" });
  await f.t.mutation(api.pipelineDeals.upsert, { ...f.scope, leadId, title: "EU", value: 1000 });
  await f.t.mutation(api.pipelineDeals.upsert, { ...f.scope, leadId, title: "US", value: 300, currency: "usd" });
  const gb = await f.t.mutation(api.pipelineDeals.upsert, { ...f.scope, leadId, title: "UK", value: 200, currency: "GBP" });
  await f.t.mutation(api.pipelineDeals.closeDeal, { ...f.scope, dealId: gb, outcome: "won", amount: 250 });
  const { totals } = await f.t.query(api.pipelineDeals.list, f.scope);
  expect(totals).toMatchObject({ currency: "EUR", openValue: 1000, openCount: 1, wonTotal: 0 });
  expect(totals.others).toEqual([
    { currency: "GBP", openValue: 0, openCount: 0, wonMonth: 250, wonTotal: 250, wonCount: 1, lostCount: 0 },
    { currency: "USD", openValue: 300, openCount: 1, wonMonth: 0, wonTotal: 0, wonCount: 0, lostCount: 0 },
  ]);
});

test("the inbox pages past its first screen, files older contacts once, and archive or snooze hide a conversation until the contact writes again", async () => {
  const f = await fixture();
  const ids: Id<"pipelineLeads">[] = [];
  for (let index = 0; index < 35; index++) {
    const { leadId } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: `Lead ${index}`, email: `lead${index}@x.test` });
    await f.t.mutation(api.pipeline.logActivity, { ...f.scope, leadId, kind: "email", subject: `Hello ${index}`, body: `Message ${index}` });
    ids.push(leadId);
  }
  await f.t.run(async ctx => { for (const lead of await ctx.db.query("pipelineLeads").collect()) await ctx.db.patch(lead._id, { inbox: undefined, inboxAt: undefined }); });
  const legacy = await f.t.query(api.pipelineInbox.page, { ...f.scope, folder: "open" });
  expect(legacy).toMatchObject({ indexed: false, isDone: true });
  expect(legacy.threads).toHaveLength(35);

  let cursor: string | null = null;
  for (let round = 0; round < 5; round++) {
    const step: { done: boolean; cursor: string } = await f.t.mutation(api.pipelineInbox.index, { ...f.scope, cursor });
    if (step.done) break;
    cursor = step.cursor;
  }
  const first = await f.t.query(api.pipelineInbox.page, { ...f.scope, folder: "open" });
  expect(first).toMatchObject({ indexed: true, isDone: false });
  expect(first.threads).toHaveLength(30);
  expect(first.threads[0]?.name).toBe("Lead 34");
  const second = await f.t.query(api.pipelineInbox.page, { ...f.scope, folder: "open", cursor: first.cursor });
  expect(second.isDone).toBe(true);
  expect(new Set([...first.threads, ...second.threads].map(row => row.leadId)).size).toBe(35);

  await expect(f.t.mutation(api.pipelineInbox.setState, { ...f.scope, leadIds: [ids[34]!], state: "snoozed", until: Date.now() - 1 })).rejects.toThrow("Snooze until");
  await f.t.mutation(api.pipelineInbox.setState, { ...f.scope, leadIds: [ids[34]!], state: "archived" });
  await f.t.mutation(api.pipelineInbox.setState, { ...f.scope, leadIds: [ids[33]!], state: "snoozed", until: Date.now() + 3_600_000 });
  const open = await f.t.query(api.pipelineInbox.page, { ...f.scope, folder: "open" });
  expect(open.threads.map(row => row.name)).not.toEqual(expect.arrayContaining(["Lead 34", "Lead 33"]));
  expect((await f.t.query(api.pipelineInbox.page, { ...f.scope, folder: "archived" })).threads.map(row => row.name)).toEqual(["Lead 34"]);
  expect((await f.t.query(api.pipelineInbox.page, { ...f.scope, folder: "snoozed" })).threads[0]).toMatchObject({ name: "Lead 33", inbox: "snoozed" });

  await f.t.mutation(api.pipeline.logActivity, { ...f.scope, leadId: ids[34]!, kind: "email", body: "We wrote back" });
  expect((await f.t.query(api.pipelineInbox.page, { ...f.scope, folder: "archived" })).threads.map(row => row.name)).toEqual(["Lead 34"]);
  await f.t.run(async ctx => {
    const lead = (await ctx.db.get(ids[34]!))!;
    const { addActivity } = await import("./lib/pipelineCore");
    await addActivity(ctx, lead, { kind: "email", status: "received", actor: { kind: "system", name: "Lead 34" }, body: "Any news?" });
  });
  const back = await f.t.query(api.pipelineInbox.page, { ...f.scope, folder: "open" });
  expect(back.threads[0]).toMatchObject({ name: "Lead 34", inbox: "open", last: { inbound: true, preview: "Any news?" } });
});
