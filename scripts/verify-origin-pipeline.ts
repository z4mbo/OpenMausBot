import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;
type Fetching = { fetch(path: string, init: RequestInit): Promise<Response> };

const SITE = "https://fixture.convex.site";
// Synthetic test values: the Twilio auth token only signs this fixture's own webhook requests, and the provider keys
// below only ever reach the loopback provider, never Brevo or Twilio.
const TWILIO_AUTH = "FixtureTwilioAuthToken0000000000";
const STRIPE_SIGNING = "whsec_fixtureSigningSecret0000000000";
const SEALING_KEY = "0f".repeat(32);
const DAY = 86_400_000;

const read = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

/** Stands in for Brevo, Twilio and Stripe on 127.0.0.1 and remembers every request the app server made. */
async function startProviders() {
  const requests: { path: string; body: string }[] = [];
  const stripe = { paid: 0, lastLink: "" };
  const server = createServer(async (req, res) => {
    const body = await read(req);
    requests.push({ path: req.url ?? "", body });
    const n = requests.length;
    const url = req.url ?? "";
    const answer = url.includes("/smtp/email") ? { messageId: `<fixture-${n}@smtp-relay.mailin.fr>` } : url.includes("/Calls.json") ? { sid: `CAfixture${n}` }
      : url.startsWith("/v1/prices") ? { id: `price_fixture${n}` }
      : url.startsWith("/v1/payment_links") ? { id: (stripe.lastLink = `plink_fixture${n}`), url: `https://buy.stripe.com/test_fixture${n}` }
      : url.startsWith("/v1/checkout/sessions") ? { data: stripe.paid ? [{ id: "cs_fixture", amount_total: stripe.paid, currency: "eur" }] : [] }
      : { sid: `SMfixture${n}` };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake providers have no port");
  return { origin: `http://127.0.0.1:${address.port}`, requests, stripe, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const user = (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0], email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await user("ada@fixture.test");
  const sam = await user("sam@fixture.test");
  const viewer = await user("vic@fixture.test");
  const o = { query: (name: string, args: Json) => t.query(ref(name), { sessionToken: owner.token, ...args }), mutation: (name: string, args: Json) => t.mutation(ref(name), { sessionToken: owner.token, ...args }) };
  const { teamId } = await o.mutation("workspaces:create", { name: "Fixture" }) as { teamId: string };
  const projectId = String(await o.mutation("projects:create", { teamId, name: "Fixture project" }));
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("teamMembers", { teamId, userId: sam.userId, email: "sam@fixture.test", name: "sam", role: "member", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("members", { projectId, userId: sam.userId, email: "sam@fixture.test", name: "sam", role: "member", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("teamMembers", { teamId, userId: viewer.userId, email: "vic@fixture.test", name: "vic", role: "viewer", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("members", { projectId, userId: viewer.userId, email: "vic@fixture.test", name: "vic", role: "viewer", status: "active", createdAt: now, updatedAt: now });
  });
  await o.mutation("pipeline:configure", { projectId, inboundEnabled: true, twilioAuthToken: TWILIO_AUTH, replyToEmail: "replies@in.fixture.test", currency: "EUR", captureEnabled: true });
  await t.action(ref("pipelineStripe:configure"), { sessionToken: owner.token, projectId, enabled: true, signingSecret: STRIPE_SIGNING });
  await o.mutation("brand:update", { projectId, kit: { name: "Fixture", voice: { adjectives: ["warm", "plain-spoken"], do: ["answer the question first"], dont: ["use jargon"] } } });

  const lead = async (fields: Json, ageDays = 0) => {
    const { leadId } = await o.mutation("pipeline:upsertLead", { projectId, ...fields }) as { leadId: string };
    if (ageDays) await t.run((ctx) => ctx.db.patch(leadId, { stageChangedAt: Date.now() - ageDays * DAY, lastActivityAt: Date.now() - ageDays * DAY, createdAt: Date.now() - ageDays * DAY }));
    return leadId;
  };
  const samOwner = { kind: "member", name: "sam", id: sam.userId };
  const grace = await lead({ name: "Grace Hopper", company: "Navy", email: "grace@navy.test", phone: "+15550001001", value: 12000, stage: "Proposal", owner: samOwner, nextStep: "Send the annual plan" }, 20);
  const alan = await lead({ name: "Alan Turing", company: "Bletchley", email: "alan@bletchley.test", phone: "+447700900111", value: 4000, stage: "Qualified" }, 3);
  const linus = await lead({ name: "Linus Torvalds", company: "Kernel", email: "linus@kernel.test", value: 800, source: "landing" });
  const margaret = await lead({ name: "Margaret Hamilton", company: "MIT", phone: "+16175550123", value: 2500, stage: "Contacted" }, 10);
  await lead({ name: "Katherine Johnson", company: "NASA", email: "katherine@nasa.test", value: 9000, stage: "Won" });
  await lead({ name: "Barbara Liskov", stage: "Qualified", nextStep: "Find her email", nextDue: new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10) }, 1);
  await o.mutation("pipeline:importLeads", { projectId, source: "conference", rows: [{ name: "G. Hopper", phone: "+1 555 000 1001", company: "US Navy", tags: ["conference"] }] });
  await o.mutation("pipelineDeals:upsert", { projectId, leadId: grace, title: "Navy annual plan", value: 12000, closeDate: "2026-12-15" });
  await o.mutation("pipelineDeals:upsert", { projectId, leadId: margaret, title: "MIT lab licence", value: 2500, currency: "USD", closeDate: "2026-10-10" });
  const alanDeal = await o.mutation("pipelineDeals:upsert", { projectId, leadId: alan, title: "Bletchley pilot", lineItems: [{ name: "Pilot seats", quantity: 4, unitPrice: 1000 }] });
  await o.mutation("pipelineDeals:closeDeal", { projectId, dealId: alanDeal, outcome: "won", amount: 4000, reason: "Signed the pilot", agent: { name: "Atlas", id: "fixture-chief" } });
  await o.mutation("pipelineInbox:saveTemplate", { projectId, name: "Numbers follow-up", channel: "email", subject: "The numbers for {company}", body: "Hi {first_name},\n\nHere are the numbers we discussed." });
  await o.mutation("pipeline:draftContact", { projectId, leadId: alan, channel: "email", agent: { name: "Atlas", id: "fixture-chief" }, subject: "Bletchley follow-up", body: "Hi Alan,\n\nThanks for the call. Here is the plan we discussed." });
  await o.mutation("pipelineSequences:start", { projectId, leadId: linus, agent: { name: "Atlas", id: "fixture-chief" }, steps: [
    { day: 0, channel: "email", subject: "A quick idea for {company}", body: "Hi {first_name}, could we help {company} ship faster?" },
    { day: 3, channel: "call_task", body: "Call {name}" },
    { day: 7, channel: "email", subject: "Last note, {first_name}", body: "Should I close your file?" },
  ] });

  for (let index = 0; index < 36; index++) {
    const older = await lead({ name: `Prospect ${String(index + 1).padStart(2, "0")}`, company: `Firm ${index + 1}`, email: `prospect${index + 1}@firms.test`, source: "conference" }, 30 + index);
    await o.mutation("pipeline:logActivity", { projectId, leadId: older, kind: "email", subject: "Following up", body: `Following up on the conference, note ${index + 1}.` });
    const at = Date.now() - (30 + index) * DAY;
    await t.run(async (ctx) => {
      const rows = await (ctx.db.query("pipelineActivities") as unknown as { collect(): Promise<{ _id: string; leadId: string; kind: string }[]> }).collect();
      for (const row of rows) if (row.leadId === older && row.kind === "email") await ctx.db.patch(row._id, { createdAt: at, updatedAt: at });
      await ctx.db.patch(older, { inboxAt: at });
    });
  }
  const settings = (await o.query("pipeline:board", { projectId }) as { settings: { inbound: { twilioUrl: string; brevoUrl: string; brevoSecret: string } } }).settings.inbound;
  const captureUrl = (await o.query("pipeline:board", { projectId }) as { settings: { captureUrl: string } }).settings.captureUrl;
  const stripeUrl = (await o.query("pipeline:board", { projectId }) as { settings: { stripeWebhook: { url: string } } }).settings.stripeWebhook.url;
  await t.run(async (ctx) => {
    const row = await (ctx.db.query("pipelineSettings") as unknown as { first(): Promise<{ _id: string } | null> }).first();
    if (row) await ctx.db.patch(row._id, { inboxIndexed: undefined });
  });
  return { ownerToken: owner.token, samToken: sam.token, viewerToken: viewer.token, projectId, teamId, inbound: settings, captureUrl, stripeUrl, leads: { grace, alan, linus } };
}

const twilioSignature = async (convex: FakeConvex, url: string, params: URLSearchParams) => {
  const { twilioSignature: sign } = await convex.load<{ twilioSignature(token: string, url: string, params: Iterable<[string, string]>): Promise<string> }>("convex/pipelineInbound.ts");
  return sign(TWILIO_AUTH, url, params);
};

/** Delivers a lead's message the way Twilio or Brevo would: to the real HTTP action, signed or with the secret. */
async function deliver(convex: FakeConvex, inbound: { twilioUrl: string; brevoUrl: string; brevoSecret: string }, message: { kind: "sms" | "whatsapp" | "email"; from: string; name?: string; subject?: string; body: string }) {
  const http = convex.t as unknown as Fetching;
  if (message.kind === "email") {
    const response = await http.fetch(inbound.brevoUrl.replace(SITE, ""), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${inbound.brevoSecret}` },
      body: JSON.stringify({ items: [{ From: { Name: message.name ?? "", Address: message.from }, Subject: message.subject ?? "", ExtractedMarkdownMessage: message.body }] }),
    });
    return response.status;
  }
  const params = new URLSearchParams({ MessageSid: `SMin${Date.now()}`, SmsStatus: "received", From: message.kind === "whatsapp" ? `whatsapp:${message.from}` : message.from, To: "+15550000000", Body: message.body });
  const response = await http.fetch(inbound.twilioUrl.replace(SITE, ""), {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": await twilioSignature(convex, inbound.twilioUrl, params) }, body: params.toString(),
  });
  return response.status;
}

/** Posts a completed checkout to the real Stripe webhook action, signed the way Stripe signs it. */
async function payCheckout(convex: FakeConvex, url: string, linkId: string, amountTotal: number) {
  const { stripeSignature } = await convex.load<{ stripeSignature(secret: string, timestamp: string, payload: string): Promise<string> }>("convex/pipelineStripe.ts");
  const at = String(Math.floor(Date.now() / 1000));
  const payload = JSON.stringify({ id: `evt_${at}`, type: "checkout.session.completed", data: { object: { id: `cs_${at}`, payment_link: linkId, amount_total: amountTotal, currency: "eur", payment_status: "paid" } } });
  const response = await (convex.t as unknown as Fetching).fetch(url.replace(SITE, ""), {
    method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${at},v1=${await stripeSignature(STRIPE_SIGNING, at, payload)}` }, body: payload,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

process.env.CONVEX_SITE_URL = SITE;
process.env.ORIGIN_SEALING_KEY = SEALING_KEY;
const providers = await startProviders();
process.env.OMB_PIPELINE_PROVIDER_URL = providers.origin;
const convex = await startFakeConvex();
const seeded = await seed(convex);
await deliver(convex, seeded.inbound, { kind: "sms", from: "+15550001001", body: "Grace here. Can we move the call to Thursday?" });
await deliver(convex, seeded.inbound, { kind: "email", from: "alan@bletchley.test", name: "Alan Turing", subject: "Re: our call", body: "Sounds good. Send me the numbers first." });
const captured = await (convex.t as unknown as Fetching).fetch(seeded.captureUrl.replace(SITE, ""), {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Ada Lovelace", email: "ada@engines.test", message: "Signed up in the app", source: "fixture-app" }),
});
if (captured.status !== 200) throw new Error(`The capture endpoint answered ${captured.status}`);
const scratch = mkdtempSync(join(tmpdir(), "origin-sales-fixture-"));
process.env.FAKE_CLAUDE_TEXT_FILE = join(scratch, "suggestion.txt");
process.env.FAKE_CLAUDE_TEXT_LOG = join(scratch, "prompts.jsonl");
writeFileSync(process.env.FAKE_CLAUDE_TEXT_FILE, JSON.stringify({ subject: "Re: our call", body: "Hi Alan, the numbers are attached. Shall we start the pilot on Monday?" }));
const fixture = await launchVerificationServer();
const fixtureCall = async (path: string, body: object) => {
  const response = await fetch(new URL(path, fixture.info.url), { method: "POST", headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Synthetic setup failed: POST ${path} ${response.status}`);
  return response.json() as Promise<{ bot: { id: string; name: string } }>;
};
const chiefBot = (await fixtureCall("/api/bots", { name: "Atlas" })).bot;
writeFileSync(join(fixture.info.dataDir, "integration-keys.json"), JSON.stringify({
  brevo: { apiKey: "fixture-brevo-key", senderEmail: "sales@fixture.test", senderName: "Fixture Sales" },
  twilio: { accountSid: "ACfixture", authToken: "fixture-twilio-key", fromNumber: "+15550000000" },
  stripe: { secretKey: "rk_test_fixture" },
}), { mode: 0o600 });
writeFileSync(join(fixture.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.ownerToken, projects: {} }), { mode: 0o600 });
const cloud = fileURLToPath(new URL("./testing/origin-campaigns-cloud.ts", import.meta.url));
const json = (res: import("node:http").ServerResponse, value: unknown) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-pipeline-preview.tsx", route: "/__origin-pipeline.html", title: "Isolated Origin Pipeline",
    extraRoutes: [
      { path: "/__origin-campaigns.json", handler: (_req, res) => json(res, { url: convex.url, token: seeded.ownerToken, viewerToken: seeded.viewerToken, projectId: seeded.projectId, chiefId: chiefBot.id }) },
      { path: "/__origin-pipeline-prompts.json", handler: (_req, res) => {
        let lines: string[] = [];
        try { lines = readFileSync(process.env.FAKE_CLAUDE_TEXT_LOG!, "utf8").split("\n").filter(Boolean); } catch { lines = []; }
        json(res, lines.map((line) => JSON.parse(line)));
      } },
      { path: "/__origin-pipeline-pay", method: "POST", handler: async (req, res) => {
        const amount = Number(JSON.parse(await read(req)).amount) || 0;
        providers.stripe.paid = amount;
        json(res, await payCheckout(convex, seeded.stripeUrl, providers.stripe.lastLink, amount));
      } },
      { path: "/__origin-pipeline-model", method: "POST", handler: async (req, res) => { writeFileSync(process.env.FAKE_CLAUDE_TEXT_FILE!, JSON.parse(await read(req)).text); json(res, { ok: true }); } },
      { path: "/__origin-pipeline-providers.json", handler: (_req, res) => json(res, providers.requests) },
      { path: "/__origin-pipeline-inbound", method: "POST", handler: async (req, res) => json(res, { status: await deliver(convex, seeded.inbound, JSON.parse(await read(req))) }) },
      { path: "/__origin-pipeline-notifications.json", handler: async (_req, res) => json(res, await convex.t.query(convex.ref("notifications:list"), { sessionToken: seeded.samToken, teamId: seeded.teamId, unreadOnly: false, paginationOpts: { numItems: 20, cursor: null } })) },
      { path: "/__origin-pipeline-tick", method: "POST", handler: async (_req, res) => {
        await convex.t.run(async (ctx) => {
          const sequence = await (ctx.db.query("pipelineSequences") as unknown as { first(): Promise<{ _id: string; startedAt: number; nextDueAt?: number } | null> }).first();
          if (sequence) await ctx.db.patch(sequence._id, { startedAt: sequence.startedAt - 3 * DAY, ...(sequence.nextDueAt ? { nextDueAt: sequence.nextDueAt - 3 * DAY } : {}) });
        });
        json(res, { drafted: await convex.t.mutation(convex.ref("pipelineSequences:tick"), {}) });
      } },
    ],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, convexUrl: convex.url, providers: providers.origin }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); await convex.close(); await providers.close(); }
