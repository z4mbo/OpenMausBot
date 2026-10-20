/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => { vi.unstubAllEnvs(); });

async function fixture() {
  vi.stubEnv("CONVEX_SITE_URL", "https://fixture.convex.site");
  const t = convexTest(schema, modules);
  const people = await t.run(async ctx => {
    const make = async (name: string) => {
      const id = await ctx.db.insert("users", { name, email: `${name}@sales.test`, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
      return { id, email: `${name}@sales.test`, token: await createSession(ctx, id) };
    };
    return { owner: await make("owner"), outsider: await make("outsider") };
  });
  const sessionToken = people.owner.token;
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Sales" });
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Launch" });
  return { t, people, scope: { sessionToken, projectId } };
}

const agent = { name: "Atlas", id: "bot-atlas" };

test("one contact per email or phone: capture matches by phone, keeps every source, and duplicates merge with their history", async () => {
  const { t, scope } = await fixture();
  await t.mutation(api.pipeline.configure, { ...scope, captureEnabled: true });
  const board = await t.query(api.pipeline.board, scope);
  const token = board.settings.captureUrl!.split("token=")[1]!;
  const { leadId: ada } = await t.mutation(api.pipeline.upsertLead, { ...scope, name: "Ada", phone: "+39 333 000 1111", source: "event" });
  expect(await t.mutation(internal.pipeline.capture, { token, name: "Ada L", email: "ada@x.test", phone: "+393330001111", source: "app" })).toBe("ok");
  const merged = (await t.query(api.pipeline.board, scope)).leads;
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ _id: ada, email: "ada@x.test", source: "event", sources: ["app"] });

  const { leadId: twin } = await t.mutation(api.pipeline.upsertLead, { ...scope, name: "Ada Lovelace", company: "Engines", email: "ada2@x.test", tags: ["vip"], source: "import" });
  await t.mutation(api.pipeline.draftContact, { ...scope, leadId: twin, channel: "email", subject: "Hi", body: "Hello" });
  await t.mutation(api.pipelineDeals.upsert, { ...scope, leadId: twin, title: "Engine", value: 500 });
  await expect(t.mutation(api.pipelineContacts.merge, { ...scope, sessionToken: "nope", primaryId: ada, otherIds: [twin] })).rejects.toThrow();
  expect(await t.mutation(api.pipelineContacts.merge, { ...scope, primaryId: ada, otherIds: [twin, ada] })).toEqual({ merged: 1 });
  const detail = await t.query(api.pipeline.lead, { ...scope, leadId: ada });
  expect(detail?.lead).toMatchObject({ company: "Engines", tags: ["vip"], sources: ["app", "import"] });
  expect(detail?.activities.map(row => row.kind)).toEqual(expect.arrayContaining(["email", "capture", "note", "deal"]));
  expect(await t.query(api.pipelineDeals.forLead, { ...scope, leadId: ada })).toHaveLength(1);
  expect((await t.query(api.pipeline.board, scope)).leads).toHaveLength(1);
});

test("bulk actions, saved views, templates and capture health", async () => {
  const { t, people, scope } = await fixture();
  const ids = [];
  for (const name of ["A", "B", "C"]) ids.push((await t.mutation(api.pipeline.upsertLead, { ...scope, name, email: `${name.toLowerCase()}@x.test` })).leadId);
  const owner = { kind: "member" as const, name: "owner", id: people.owner.id };
  expect(await t.mutation(api.pipelineContacts.bulkUpdate, { ...scope, leadIds: ids.slice(0, 2), owner, addTags: ["warm", " warm "], stage: "qualified" })).toEqual({ updated: 2 });
  const leads = (await t.query(api.pipeline.board, scope)).leads;
  expect(leads.filter(lead => lead.stage === "Qualified").map(lead => [lead.name, lead.tags, lead.owner?.name]).sort()).toEqual([["A", ["warm"], "owner"], ["B", ["warm"], "owner"]]);
  await expect(t.mutation(api.pipelineContacts.bulkUpdate, { ...scope, leadIds: ids, stage: "Nowhere" })).rejects.toThrow("Stage must be one of");

  await expect(t.mutation(api.pipelineContacts.saveView, { ...scope, name: "Empty", filters: { query: "  " } })).rejects.toThrow("Set a search");
  const viewId = await t.mutation(api.pipelineContacts.saveView, { ...scope, name: "Warm", filters: { tag: "warm", unread: false, reach: "email" } });
  expect(await t.query(api.pipelineContacts.views, scope)).toEqual([expect.objectContaining({ _id: viewId, name: "Warm", filters: { tag: "warm", reach: "email" } })]);
  await t.mutation(api.pipelineContacts.removeView, { ...scope, viewId });
  expect(await t.query(api.pipelineContacts.views, scope)).toEqual([]);

  const templateId = await t.mutation(api.pipelineInbox.saveTemplate, { ...scope, name: "Follow up", channel: "sms", subject: "ignored", body: "Hi {first_name}" });
  expect(await t.query(api.pipelineInbox.templates, scope)).toEqual([expect.objectContaining({ _id: templateId, channel: "sms", body: "Hi {first_name}" })]);
  expect((await t.query(api.pipelineInbox.templates, scope))[0]).not.toHaveProperty("subject");

  await t.mutation(api.pipeline.configure, { ...scope, captureEnabled: true });
  const token = (await t.query(api.pipeline.board, scope)).settings.captureUrl!.split("token=")[1]!;
  await t.mutation(internal.pipeline.capture, { token, email: "new@x.test", source: "my-app" });
  const health = await t.query(api.pipelineContacts.captureHealth, scope);
  expect(health).toMatchObject({ last24h: 1, last30d: 1, sources: [expect.objectContaining({ source: "my-app", count: 1 })] });
  expect(health.lastCaptureAt).toBeTypeOf("number");
});

test("the inbox lists conversations with unread replies and drafts waiting for approval", async () => {
  const { t, scope } = await fixture();
  const { leadId: quiet } = await t.mutation(api.pipeline.upsertLead, { ...scope, name: "Quiet", email: "q@x.test" });
  const { leadId: talky } = await t.mutation(api.pipeline.upsertLead, { ...scope, name: "Talky", email: "t@x.test", phone: "+15550001111" });
  await t.mutation(api.pipeline.draftContact, { ...scope, leadId: talky, channel: "sms", body: "Agent draft", agent });
  await t.mutation(api.pipeline.logActivity, { ...scope, leadId: talky, kind: "email", subject: "Old", body: "Earlier email" });
  await t.run(async ctx => {
    await ctx.db.insert("pipelineActivities", { projectId: scope.projectId, leadId: talky, kind: "whatsapp", status: "received", actor: { kind: "system", name: "Talky" }, body: "Any news?", createdAt: Date.now() + 1, updatedAt: Date.now() + 1 });
    await ctx.db.patch(talky, { unreadReplies: 1 });
  });
  const threads = await t.query(api.pipelineInbox.threads, scope);
  expect(threads.map(row => row.name)).toEqual(["Talky"]);
  expect(threads[0]).toMatchObject({ leadId: talky, unread: 1, pending: 1, wonRequest: false, last: { kind: "whatsapp", inbound: true, preview: "Any news?" } });
  expect(threads.some(row => row.leadId === quiet)).toBe(false);
});

test("deals keep the contact's value, close with a reason, and an agent's won waits for a person", async () => {
  const { t, scope } = await fixture();
  const { leadId } = await t.mutation(api.pipeline.upsertLead, { ...scope, name: "Grace", email: "g@x.test", stage: "Qualified" });
  await expect(t.mutation(api.pipelineDeals.upsert, { ...scope, leadId, stage: "Won" })).rejects.toThrow("Mark the deal won or lost");
  const dealId = await t.mutation(api.pipelineDeals.upsert, {
    ...scope, leadId, title: "Annual plan", closeDate: "2026-12-01", lineItems: [{ name: "Seat", quantity: 3, unitPrice: 100 }, { name: "Setup", quantity: 1, unitPrice: 50.5 }], value: 9,
  });
  let deal = (await t.query(api.pipelineDeals.forLead, { ...scope, leadId }))[0]!;
  expect(deal).toMatchObject({ title: "Annual plan", value: 350.5, currency: "EUR", stage: "Qualified", closeDate: "2026-12-01" });
  expect((await t.query(api.pipeline.lead, { ...scope, leadId }))?.lead.value).toBe(350.5);
  await expect(t.mutation(api.pipelineDeals.upsert, { ...scope, dealId, closeDate: "2026-02-30" })).rejects.toThrow("valid date");

  expect(await t.mutation(api.pipelineDeals.closeDeal, { ...scope, dealId, outcome: "won", amount: 300, reason: "Signed", agent })).toBe("requested");
  deal = (await t.query(api.pipelineDeals.forLead, { ...scope, leadId }))[0]!;
  expect(deal).toMatchObject({ stage: "Qualified", wonRequest: { amount: 300, reason: "Signed", by: { kind: "agent", name: "Atlas" } } });
  expect((await t.query(api.pipelineInbox.threads, scope))[0]).toMatchObject({ leadId, wonRequest: true });
  expect((await t.query(api.pipelineDeals.list, scope)).totals.awaitingConfirmation).toBe(1);

  await t.mutation(api.pipelineDeals.confirmWon, { ...scope, dealId, confirm: true });
  deal = (await t.query(api.pipelineDeals.forLead, { ...scope, leadId }))[0]!;
  expect(deal).toMatchObject({ stage: "Won", wonAmount: 300, reason: "Signed", closedBy: { kind: "member", name: "owner" } });
  expect(deal.wonRequest).toBeUndefined();
  const lead = (await t.query(api.pipeline.lead, { ...scope, leadId }))!.lead;
  expect(lead).toMatchObject({ stage: "Won", value: 300 });
  const { totals } = await t.query(api.pipelineDeals.list, scope);
  expect(totals).toMatchObject({ wonTotal: 300, wonMonth: 300, wonCount: 1, openValue: 0, awaitingConfirmation: 0 });
  await expect(t.mutation(api.pipelineDeals.closeDeal, { ...scope, dealId, outcome: "lost" })).rejects.toThrow("already Won");

  const pulse = await t.query(api.pulse.project, { ...scope, range: 7 });
  expect(pulse.grow.revenue.value).toBe(300);

  await t.mutation(api.pipelineDeals.upsert, { ...scope, dealId, stage: "Proposal" });
  deal = (await t.query(api.pipelineDeals.forLead, { ...scope, leadId }))[0]!;
  expect(deal).toMatchObject({ stage: "Proposal" });
  expect(deal.wonAmount).toBeUndefined();
  expect((await t.query(api.pipeline.lead, { ...scope, leadId }))?.lead.stage).toBe("Proposal");
  await t.mutation(api.pipelineDeals.closeDeal, { ...scope, dealId, outcome: "lost", reason: "No budget", agent });
  expect((await t.query(api.pipeline.lead, { ...scope, leadId }))?.lead.stage).toBe("Lost");
});

test("a Stripe payment link is recorded once and a completed payment wins the deal for what was paid", async () => {
  const { t, people, scope } = await fixture();
  const { leadId } = await t.mutation(api.pipeline.upsertLead, { ...scope, name: "Linus", email: "l@x.test" });
  const dealId = await t.mutation(api.pipelineDeals.upsert, { ...scope, leadId, value: 120 });
  await expect(t.mutation(api.pipelineDeals.setPayment, { ...scope, dealId, url: "javascript:alert(1)", linkId: "plink_1", amount: 120 })).rejects.toThrow("not a Stripe payment link");
  await t.mutation(api.pipelineDeals.setPayment, { ...scope, dealId, url: "https://buy.stripe.com/test_1", linkId: "plink_1", amount: 120 });
  await expect(t.mutation(api.pipelineDeals.recordPayment, { ...scope, dealId, linkId: "plink_other", paidAmount: 120 })).rejects.toThrow("not this deal's");
  await expect(t.mutation(api.pipelineDeals.recordPayment, { ...scope, sessionToken: people.outsider.token, dealId, linkId: "plink_1", paidAmount: 120 })).rejects.toThrow();
  await t.mutation(api.pipelineDeals.recordPayment, { ...scope, dealId, linkId: "plink_1", paidAmount: 118 });
  await t.mutation(api.pipelineDeals.recordPayment, { ...scope, dealId, linkId: "plink_1", paidAmount: 1 });
  const deal = (await t.query(api.pipelineDeals.forLead, { ...scope, leadId }))[0]!;
  expect(deal).toMatchObject({ stage: "Won", wonAmount: 118, reason: "Paid through Stripe", closedBy: { kind: "system", name: "Stripe" }, payment: { paidAmount: 118 } });
  expect((await t.query(api.pipeline.lead, { ...scope, leadId }))?.lead).toMatchObject({ stage: "Won", value: 118 });
});
