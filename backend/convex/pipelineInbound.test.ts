/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";
import { twilioSignature } from "./pipelineInbound";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => { vi.unstubAllEnvs(); });

const SITE = "https://fixture.convex.site";
const AUTH_TOKEN = "a".repeat(32);

async function fixture() {
  vi.stubEnv("CONVEX_SITE_URL", SITE);
  const t = convexTest(schema, modules);
  const people = await t.run(async ctx => {
    const make = async (name: string) => {
      const id = await ctx.db.insert("users", { name, email: `${name}@pipeline.test`, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
      return { id, email: `${name}@pipeline.test`, token: await createSession(ctx, id) };
    };
    return { owner: await make("owner"), member: await make("member") };
  });
  const sessionToken = people.owner.token;
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Sales" });
  await t.run(ctx => ctx.db.insert("teamMembers", { teamId, userId: people.member.id, email: people.member.email, name: "member", role: "member", status: "active", createdAt: 1, updatedAt: 1 }));
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Launch" });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken, projectId, email: people.member.email, role: "member" });
  return { t, people, teamId, scope: { sessionToken, projectId } };
}

async function inbound(f: Awaited<ReturnType<typeof fixture>>) {
  await f.t.mutation(api.pipeline.configure, { ...f.scope, inboundEnabled: true, twilioAuthToken: AUTH_TOKEN, replyToEmail: "replies@in.example.com" });
  const settings = (await f.t.query(api.pipeline.board, f.scope)).settings;
  return settings.inbound!;
}

async function twilio(f: Awaited<ReturnType<typeof fixture>>, url: string, fields: Record<string, string>, token = AUTH_TOKEN) {
  const params = new URLSearchParams(fields);
  const signature = await twilioSignature(token, url, params);
  return f.t.fetch(url.replace(SITE, ""), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature }, body: params.toString() });
}

test("only admins turn on inbound webhooks, and only editors see their addresses", async () => {
  const f = await fixture();
  await expect(f.t.mutation(api.pipeline.configure, { ...f.scope, sessionToken: f.people.member.token, inboundEnabled: true })).rejects.toThrow("Admin role required");
  await expect(f.t.mutation(api.pipeline.configure, { ...f.scope, twilioAuthToken: "short" })).rejects.toThrow("32 letters");
  const view = await inbound(f);
  expect(view.twilioUrl).toMatch(/^https:\/\/fixture\.convex\.site\/pipeline\/twilio\?token=[a-f0-9]{48}$/);
  expect(view.brevoUrl).toMatch(/^https:\/\/fixture\.convex\.site\/pipeline\/brevo\?token=[a-f0-9]{48}$/);
  expect(view).toMatchObject({ twilioSigning: true, replyToEmail: "replies@in.example.com" });
  expect(JSON.stringify(await f.t.query(api.pipeline.board, f.scope))).not.toContain(AUTH_TOKEN);
});

test("Twilio replies need a valid signature, land on the lead's timeline unread, and tell its owner", async () => {
  const f = await fixture();
  const view = await inbound(f);
  const { leadId } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "Ada", phone: "+39 333 123 4567", owner: { kind: "member", name: "member", id: f.people.member.id } });
  const message = { MessageSid: "SM1", SmsStatus: "received", From: "+393331234567", To: "+15550000000", Body: "Yes, call me tomorrow" };

  const unsigned = await f.t.fetch(view.twilioUrl.replace(SITE, ""), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(message).toString() });
  expect(unsigned.status).toBe(403);
  expect((await twilio(f, view.twilioUrl, message, "b".repeat(32))).status).toBe(403);
  expect((await twilio(f, `${SITE}/pipeline/twilio?token=${"0".repeat(48)}`, message)).status).toBe(404);

  const ok = await twilio(f, view.twilioUrl, message);
  expect(ok.status).toBe(200);
  expect(await ok.text()).toContain("<Response>");
  const lead = await f.t.query(api.pipeline.lead, { ...f.scope, leadId });
  expect(lead?.lead.unreadReplies).toBe(1);
  expect(lead?.activities[0]).toMatchObject({ kind: "sms", status: "received", body: "Yes, call me tomorrow", actor: { kind: "system", name: "Ada" } });
  const notes = await f.t.run(ctx => ctx.db.query("notifications").collect());
  expect(notes).toMatchObject([{ userId: f.people.member.id, kind: "lead", leadId, preview: "Ada: Yes, call me tomorrow" }]);
  const listed = await f.t.query(api.notifications.list, { sessionToken: f.people.member.token, teamId: f.teamId, unreadOnly: true, paginationOpts: { numItems: 10, cursor: null } });
  expect(listed.page[0]).toMatchObject({ kind: "lead", leadId, actorName: "Ada", available: true });

  await f.t.mutation(api.pipeline.markRead, { ...f.scope, leadId });
  expect((await f.t.query(api.pipeline.lead, { ...f.scope, leadId }))?.lead.unreadReplies).toBeUndefined();

  await twilio(f, view.twilioUrl, { MessageSid: "SM2", SmsStatus: "received", From: "whatsapp:+447700900123", ProfileName: "Bea", Body: "Hi" });
  const bea = (await f.t.query(api.pipeline.board, f.scope)).leads.find(row => row.name === "Bea");
  expect(bea).toMatchObject({ phone: "+447700900123", source: "whatsapp", stage: "New", unreadReplies: 1 });
});

test("Twilio status callbacks mark undelivered texts and finished calls", async () => {
  const f = await fixture();
  const view = await inbound(f);
  const { leadId } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "Cy", phone: "+15550001111" });
  const text = await f.t.mutation(api.pipeline.draftContact, { ...f.scope, leadId, channel: "sms", body: "Hello" });
  const claimed = await f.t.mutation(api.pipeline.claimContact, { ...f.scope, activityId: text.activityId });
  expect(claimed.statusCallback).toBe(view.twilioUrl);
  await f.t.mutation(api.pipeline.finishContact, { ...f.scope, activityId: text.activityId, status: "sent", providerId: "SMtext" });
  const call = await f.t.mutation(api.pipeline.draftContact, { ...f.scope, leadId, channel: "call" });
  await f.t.mutation(api.pipeline.claimContact, { ...f.scope, activityId: call.activityId });
  await f.t.mutation(api.pipeline.finishContact, { ...f.scope, activityId: call.activityId, status: "sent", providerId: "CAcall" });

  await twilio(f, view.twilioUrl, { MessageSid: "SMtext", MessageStatus: "undelivered", SmsStatus: "undelivered", ErrorCode: "30003" });
  await twilio(f, view.twilioUrl, { CallSid: "CAcall", CallStatus: "completed", CallDuration: "125", Direction: "outbound-api" });
  const rows = (await f.t.query(api.pipeline.lead, { ...f.scope, leadId }))!.activities;
  expect(rows.find(row => row._id === text.activityId)).toMatchObject({ status: "failed", error: "Twilio could not deliver it (error 30003)" });
  expect(rows.find(row => row._id === call.activityId)).toMatchObject({ status: "done", summary: "Call lasted 2m 5s" });
});

test("Brevo replies and bounces need the webhook secret", async () => {
  const f = await fixture();
  const view = await inbound(f);
  const { leadId } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "Dee", email: "dee@example.com" });
  const email = await f.t.mutation(api.pipeline.draftContact, { ...f.scope, leadId, channel: "email", subject: "Intro", body: "Hello" });
  const claimed = await f.t.mutation(api.pipeline.claimContact, { ...f.scope, activityId: email.activityId });
  expect(claimed.replyTo).toBe("replies@in.example.com");
  await f.t.mutation(api.pipeline.finishContact, { ...f.scope, activityId: email.activityId, status: "sent", providerId: "<m1@smtp-relay.mailin.fr>" });
  const path = view.brevoUrl.replace(SITE, "");
  const reply = { items: [{ From: { Name: "Dee", Address: "DEE@example.com" }, Subject: "Re: Intro", ExtractedMarkdownMessage: "Sounds good", RawTextBody: "Sounds good\n> quoted" }] };

  expect((await f.t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reply) })).status).toBe(401);
  expect((await f.t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" }, body: JSON.stringify(reply) })).status).toBe(401);
  const ok = await f.t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${view.brevoSecret}` }, body: JSON.stringify(reply) });
  expect(ok.status).toBe(200);
  const basic = await f.t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa(`origin:${view.brevoSecret}`)}` },
    body: JSON.stringify({ event: "hard_bounce", email: "dee@example.com", "message-id": "<m1@smtp-relay.mailin.fr>", reason: "mailbox full" }) });
  expect(basic.status).toBe(200);

  const rows = (await f.t.query(api.pipeline.lead, { ...f.scope, leadId }))!;
  expect(rows.lead.unreadReplies).toBe(1);
  expect(rows.activities.find(row => row.status === "received")).toMatchObject({ kind: "email", subject: "Re: Intro", body: "Sounds good" });
  expect(rows.activities.find(row => row._id === email.activityId)).toMatchObject({ status: "failed", error: "The address bounced: mailbox full" });
});

test("stages are renamed, added, reordered and removed with their leads reassigned", async () => {
  const f = await fixture();
  const { leadId } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "Eve", stage: "Proposal" });
  const { leadId: qualified } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "Fay", stage: "Qualified" });
  const keep = (name: string, was = name) => ({ name, was });
  await expect(f.t.mutation(api.pipeline.setStages, { ...f.scope, stages: [keep("New"), keep("Contacted"), keep("Won")] })).rejects.toThrow("Lost stays");
  await expect(f.t.mutation(api.pipeline.setStages, { ...f.scope, stages: [keep("New"), { name: "new" }, keep("Won"), keep("Lost")] })).rejects.toThrow("different");
  await expect(f.t.mutation(api.pipeline.setStages, { ...f.scope, stages: [keep("New"), keep("Won", "Won"), keep("Winners", "Lost")] })).rejects.toThrow("Lost stays");

  const result = await f.t.mutation(api.pipeline.setStages, {
    ...f.scope, moveTo: "Discovery",
    stages: [keep("New"), { name: "Demo" }, keep("Discovery", "Qualified"), keep("Contacted"), keep("Won"), keep("Lost")],
  });
  expect(result).toEqual({ moved: 1 });
  const board = await f.t.query(api.pipeline.board, f.scope);
  expect(board.stages).toEqual(["New", "Demo", "Discovery", "Contacted", "Won", "Lost"]);
  expect(board.leads.find(lead => lead._id === leadId)?.stage).toBe("Discovery");
  expect(board.leads.find(lead => lead._id === qualified)?.stage).toBe("Discovery");
  const timeline = await f.t.query(api.pipeline.lead, { ...f.scope, leadId });
  expect(timeline?.activities[0]).toMatchObject({ kind: "stage", subject: "Proposal", body: "Discovery" });
});

test("a sequence drafts its steps when due, for approval, and stops when the lead replies or closes", async () => {
  const f = await fixture();
  const view = await inbound(f);
  const { leadId } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "Gus Grant", email: "gus@example.com", phone: "+15550002222", company: "Grant Co" });
  const steps = [
    { day: 0, channel: "email" as const, subject: "Hello {first_name}", body: "A note for {company}" },
    { day: 3, channel: "sms" as const, body: "Did you see my email, {first_name}?" },
    { day: 7, channel: "call_task" as const, body: "Call {name}" },
  ];
  await expect(f.t.mutation(api.pipelineSequences.start, { ...f.scope, leadId, steps: [{ day: 3, channel: "sms", body: "x" }, { day: 1, channel: "sms", body: "y" }] })).rejects.toThrow("day order");
  const started = await f.t.mutation(api.pipelineSequences.start, { ...f.scope, leadId, steps, agent: { name: "Chief", id: "chief" } });
  expect(started.drafted).toBe(1);
  let board = await f.t.query(api.pipeline.board, f.scope);
  expect(board.pending).toMatchObject([{ kind: "email", status: "pending", subject: "Hello Gus", body: "A note for Grant Co", actor: { kind: "agent", name: "Chief" }, sequenceId: started.sequenceId }]);

  const rewind = async (days: number) => f.t.run(async ctx => {
    const row = (await ctx.db.get(started.sequenceId))!;
    await ctx.db.patch(row._id, { startedAt: row.startedAt - days * 86_400_000, ...(row.nextDueAt ? { nextDueAt: row.nextDueAt - days * 86_400_000 } : {}) });
  });
  expect(await f.t.mutation(internal.pipelineSequences.tick, {})).toBe(0);
  await rewind(3);
  expect(await f.t.mutation(internal.pipelineSequences.tick, {})).toBe(1);
  board = await f.t.query(api.pipeline.board, f.scope);
  expect(board.pending.map(row => row.kind).sort()).toEqual(["email", "sms"]);

  expect(await f.t.mutation(api.pipelineSequences.control, { ...f.scope, leadId, action: "pause" })).toBe("paused");
  await rewind(10);
  expect(await f.t.mutation(internal.pipelineSequences.tick, {})).toBe(0);
  expect(await f.t.mutation(api.pipelineSequences.control, { ...f.scope, leadId, action: "resume" })).toBe("active");

  await twilio(f, view.twilioUrl, { MessageSid: "SMr", SmsStatus: "received", From: "+15550002222", Body: "Not now" });
  const sequence = await f.t.query(api.pipelineSequences.forLead, { ...f.scope, leadId });
  expect(sequence).toMatchObject({ status: "stopped", stopReason: "The lead replied" });
  expect(sequence?.steps.map(step => step.state)).toEqual(["drafted", "drafted", "skipped"]);
  expect((await f.t.query(api.pipeline.board, f.scope)).pending).toEqual([]);

  await f.t.mutation(api.pipelineSequences.start, { ...f.scope, leadId, steps: [{ day: 2, channel: "call_task" }] });
  await f.t.mutation(api.pipeline.moveLead, { ...f.scope, leadId, stage: "Won" });
  expect(await f.t.query(api.pipelineSequences.forLead, { ...f.scope, leadId })).toMatchObject({ status: "stopped", stopReason: "Moved to Won" });
  await expect(f.t.mutation(api.pipelineSequences.start, { ...f.scope, leadId, steps })).rejects.toThrow("Won");
});

test("a due call task becomes the lead's next step", async () => {
  const f = await fixture();
  const { leadId } = await f.t.mutation(api.pipeline.upsertLead, { ...f.scope, name: "Hal" });
  await f.t.mutation(api.pipelineSequences.start, { ...f.scope, leadId, steps: [{ day: 0, channel: "call_task" }] });
  const lead = await f.t.query(api.pipeline.lead, { ...f.scope, leadId });
  expect(lead?.lead).toMatchObject({ nextStep: "Call Hal", nextDue: new Date().toISOString().slice(0, 10) });
  expect(await f.t.query(api.pipelineSequences.forLead, { ...f.scope, leadId })).toMatchObject({ status: "done" });
});
