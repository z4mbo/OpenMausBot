/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => { vi.unstubAllEnvs(); });

async function fixture() {
  vi.stubEnv("CONVEX_SITE_URL", "https://fixture.convex.site");
  const t = convexTest(schema, modules);
  const people = await t.run(async ctx => {
    const make = async (name: string) => {
      const id = await ctx.db.insert("users", { name, email: `${name}@pipeline.test`, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
      return { id, email: `${name}@pipeline.test`, token: await createSession(ctx, id) };
    };
    return { owner: await make("owner"), member: await make("member"), viewer: await make("viewer"), outsider: await make("outsider") };
  });
  const sessionToken = people.owner.token;
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Sales" });
  for (const [person, role] of [[people.member, "member"], [people.viewer, "viewer"]] as const) {
    await t.run(ctx => ctx.db.insert("teamMembers", { teamId, userId: person.id, email: person.email, name: role, role, status: "active", createdAt: 1, updatedAt: 1 }));
  }
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Launch" });
  for (const person of [people.member, people.viewer]) await t.mutation(api.members.addWorkspaceMember, { sessionToken, projectId, email: person.email, role: "member" });
  return { t, people, scope: { sessionToken, projectId } };
}

test("leads move through the stages with a timeline and per-stage order", async () => {
  const { t, scope } = await fixture();
  const ada = await t.mutation(api.pipeline.upsertLead, { ...scope, name: "Ada", email: " ADA@Example.com ", value: 1200, tags: ["warm", "warm"] });
  const bob = await t.mutation(api.pipeline.upsertLead, { ...scope, name: "Bob", phone: "+39 333 123 4567" });
  expect(ada.created).toBe(true);
  const again = await t.mutation(api.pipeline.upsertLead, { ...scope, email: "ada@example.com", company: "Analytical" });
  expect(again).toEqual({ leadId: ada.leadId, created: false });

  let board = await t.query(api.pipeline.board, scope);
  expect(board.stages).toEqual(["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"]);
  expect(board.leads.map(lead => lead.name)).toEqual(["Bob", "Ada"]);
  expect(board.leads.find(lead => lead.name === "Ada")).toMatchObject({ email: "ada@example.com", company: "Analytical", tags: ["warm"], value: 1200, source: "manual" });
  expect(board.leads.find(lead => lead.name === "Bob")?.phone).toBe("+393331234567");

  await t.mutation(api.pipeline.moveLead, { ...scope, leadId: ada.leadId, stage: "qualified" });
  await t.mutation(api.pipeline.moveLead, { ...scope, leadId: bob.leadId, stage: "Qualified", beforeLeadId: ada.leadId });
  board = await t.query(api.pipeline.board, scope);
  expect(board.leads.filter(lead => lead.stage === "Qualified").map(lead => lead.name)).toEqual(["Bob", "Ada"]);
  const detail = await t.query(api.pipeline.lead, { ...scope, leadId: ada.leadId });
  expect(detail?.activities[0]).toMatchObject({ kind: "stage", subject: "New", body: "Qualified", actor: { kind: "member", name: "owner" } });

  await expect(t.mutation(api.pipeline.upsertLead, { ...scope, name: "Bad", email: "not-an-email" })).rejects.toThrow("valid email");
  await expect(t.mutation(api.pipeline.moveLead, { ...scope, leadId: ada.leadId, stage: "Nowhere" })).rejects.toThrow("Unknown stage");
  await t.mutation(api.pipeline.removeLead, { ...scope, leadId: bob.leadId });
  expect((await t.query(api.pipeline.board, scope)).leads).toHaveLength(1);
});

test("viewers and outsiders cannot change leads", async () => {
  const { t, people, scope } = await fixture();
  await expect(t.mutation(api.pipeline.upsertLead, { ...scope, sessionToken: people.viewer.token, name: "Nope" })).rejects.toThrow("Edit role required");
  await expect(t.query(api.pipeline.board, { ...scope, sessionToken: people.outsider.token })).rejects.toThrow();
  await t.mutation(api.pipeline.configure, { ...scope, captureEnabled: true });
  const asViewer = await t.query(api.pipeline.board, { ...scope, sessionToken: people.viewer.token });
  expect(asViewer.settings.captureEnabled).toBe(true);
  expect(asViewer.settings.captureUrl).toBeUndefined();
});

test("an agent's contact waits for a person unless the project turned on auto-send", async () => {
  const { t, scope } = await fixture();
  const { leadId } = await t.mutation(api.pipeline.upsertLead, { ...scope, name: "Cy", email: "cy@example.com", phone: "+15550001111", agent: { name: "Scout", id: "bot1" } });
  const lead = await t.query(api.pipeline.lead, { ...scope, leadId });
  expect(lead?.lead.source).toBe("agent research");
  expect(lead?.activities[0]).toMatchObject({ kind: "note", actor: { kind: "agent", name: "Scout", id: "bot1" } });

  const drafted = await t.mutation(api.pipeline.draftContact, { ...scope, leadId, agent: { name: "Scout" }, channel: "email", subject: "Hello", body: "Intro" });
  expect(drafted.status).toBe("pending");
  await expect(t.mutation(api.pipeline.claimContact, { ...scope, activityId: drafted.activityId })).rejects.toThrow("approve");
  expect((await t.query(api.pipeline.board, scope)).pending).toMatchObject([{ _id: drafted.activityId, leadName: "Cy", subject: "Hello" }]);

  await t.mutation(api.pipeline.reviewContact, { ...scope, activityId: drafted.activityId, approve: true, body: "Edited intro" });
  const claimed = await t.mutation(api.pipeline.claimContact, { ...scope, activityId: drafted.activityId });
  expect(claimed.activity).toMatchObject({ status: "sending", body: "Edited intro", approvedBy: "owner" });
  expect(claimed.lead.email).toBe("cy@example.com");
  await expect(t.mutation(api.pipeline.claimContact, { ...scope, activityId: drafted.activityId })).rejects.toThrow("already handled");
  await t.mutation(api.pipeline.finishContact, { ...scope, activityId: drafted.activityId, status: "sent", providerId: "msg-1" });
  const after = await t.query(api.pipeline.lead, { ...scope, leadId });
  expect(after?.lead.stage).toBe("Contacted");
  expect(after?.activities.find(row => row._id === drafted.activityId)).toMatchObject({ status: "sent", providerId: "msg-1" });

  await t.mutation(api.pipeline.configure, { ...scope, autoSend: true });
  const auto = await t.mutation(api.pipeline.draftContact, { ...scope, leadId, agent: { name: "Scout" }, channel: "ai_call", goal: "Book a demo" });
  expect(auto.status).toBe("approved");
  const human = await t.mutation(api.pipeline.draftContact, { ...scope, leadId, channel: "sms", body: "Hi" });
  expect(human.status).toBe("approved");
  await expect(t.mutation(api.pipeline.draftContact, { ...scope, leadId, channel: "ai_call" })).rejects.toThrow("goal");
});

test("only admins turn on auto-send", async () => {
  const { t, people, scope } = await fixture();
  await t.mutation(api.pipeline.configure, { ...scope, sessionToken: people.member.token, captureEnabled: true });
  await expect(t.mutation(api.pipeline.configure, { ...scope, sessionToken: people.member.token, autoSend: true })).rejects.toThrow("Admin role required");
  expect((await t.query(api.pipeline.board, scope)).settings.autoSend).toBe(false);
});

test("CSV rows import once, updating leads that share an email", async () => {
  const { t, scope } = await fixture();
  await t.mutation(api.pipeline.upsertLead, { ...scope, name: "Existing", email: "dup@example.com" });
  const result = await t.mutation(api.pipeline.importLeads, {
    ...scope, source: "csv",
    rows: [{ name: "Dup", email: "dup@example.com", company: "New Co" }, { name: "Eve", phone: "+44 20 7946 0958", stage: "Proposal", value: 50 }, { name: "Bad", email: "nope" }],
  });
  expect(result).toEqual({ created: 2, updated: 1, skipped: 0 });
  const board = await t.query(api.pipeline.board, scope);
  expect(board.leads.find(lead => lead.email === "dup@example.com")).toMatchObject({ name: "Existing", company: "New Co" });
  expect(board.leads.find(lead => lead.name === "Eve")).toMatchObject({ stage: "Proposal", value: 50, source: "csv" });
});

test("the public capture endpoint needs the project's token, files leads and is rate limited", async () => {
  const { t, scope } = await fixture();
  await t.mutation(api.pipeline.configure, { ...scope, captureEnabled: true });
  const url = (await t.query(api.pipeline.board, scope)).settings.captureUrl!;
  expect(url).toMatch(/^https:\/\/fixture\.convex\.site\/pipeline\/capture\?token=[a-f0-9]{48}$/);
  const path = url.replace("https://fixture.convex.site", "");

  const unknown = await t.fetch("/pipeline/capture?token=" + "0".repeat(48), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X", email: "x@example.com" }) });
  expect(unknown.status).toBe(404);
  const json = await t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Dana", email: "dana@example.com", message: "Pricing?", source: "landing" }) });
  expect(json.status).toBe(200);
  expect(json.headers.get("access-control-allow-origin")).toBe("*");
  const form = await t.fetch(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "Dana", email: "dana@example.com", phone: "+33 1 23 45 67 89", redirect: "https://landing.example/thanks" }).toString() });
  expect(form.status).toBe(303);
  expect(form.headers.get("location")).toBe("https://landing.example/thanks");
  const bot = await t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Spam", email: "spam@example.com", website: "http://spam" }) });
  expect(bot.status).toBe(200);
  const empty = await t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "No contact" }) });
  expect(empty.status).toBe(400);

  const board = await t.query(api.pipeline.board, scope);
  expect(board.leads).toHaveLength(1);
  expect(board.leads[0]).toMatchObject({ name: "Dana", email: "dana@example.com", phone: "+33123456789", source: "landing", stage: "New" });
  const detail = await t.query(api.pipeline.lead, { ...scope, leadId: board.leads[0]!._id });
  expect(detail?.activities.filter(row => row.kind === "capture").map(row => row.body)).toEqual([undefined, "Pricing?"]);

  for (let index = 0; index < 28; index++) {
    await t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `p${index}@example.com` }) });
  }
  const limited = await t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "late@example.com" }) });
  expect(limited.status).toBe(429);

  await t.mutation(api.pipeline.configure, { ...scope, rotateToken: true });
  const old = await t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "old@example.com" }) });
  expect(old.status).toBe(404);
});
