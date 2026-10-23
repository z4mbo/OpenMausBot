/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const people = await t.run(async (ctx) => {
    const now = Date.now();
    const out: Record<string, { id: Id<"users">; email: string; token: string }> = {};
    for (const name of ["Owner", "Member", "Bystander", "Outsider"]) {
      const email = `${name.toLowerCase()}@example.test`;
      const id = await ctx.db.insert("users", { name: `${name} Person`, username: name.toLowerCase(), email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: now, updatedAt: now });
      out[name.toLowerCase()] = { id, email, token: await createSession(ctx, id) };
    }
    return out as Record<"owner" | "member" | "bystander" | "outsider", { id: Id<"users">; email: string; token: string }>;
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: people.owner.token, name: "Team" });
  await t.run(async (ctx) => {
    for (const person of [people.member, people.bystander]) {
      await ctx.db.insert("teamMembers", { teamId, userId: person.id, email: person.email, name: "x", role: "member", status: "active", createdAt: Date.now(), updatedAt: Date.now() });
    }
  });
  const projectId = await t.mutation(api.projects.create, { sessionToken: people.owner.token, teamId, name: "App" });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken: people.owner.token, projectId, email: people.member.email, role: "member" });
  return { t, ...people, teamId, projectId, conversation: `project:${projectId}` };
}

describe("shared team chat", () => {
  test("every project member reads the same conversation; people outside it cannot", async () => {
    const f = await fixture();
    const scope = (person: { token: string }) => ({ sessionToken: person.token, teamId: f.teamId, conversation: f.conversation });
    await f.t.mutation(api.realtime.send, { ...scope(f.member), body: "Survey is late" });
    await f.t.mutation(api.realtime.send, { ...scope(f.owner), body: "@Chief what now?", asAgent: undefined });
    const reply = await f.t.mutation(api.realtime.send, { ...scope(f.owner), body: "Book the surveyor.", asAgent: { id: "agent:chief", name: "Chief" } });
    expect(reply).toMatchObject({ authorUserId: "agent:chief", authorName: "Chief" });
    const seen = await f.t.query(api.realtime.messages, scope(f.member));
    expect(seen.map((message) => message.body)).toEqual(["Survey is late", "@Chief what now?", "Book the surveyor."]);
    await expect(f.t.query(api.realtime.messages, scope(f.bystander))).rejects.toThrow("Conversation not found");
    await expect(f.t.query(api.realtime.messages, scope(f.outsider))).rejects.toThrow("Workspace access required");
  });

  test("direct conversations stay between their two people", async () => {
    const f = await fixture();
    const conversation = await f.t.mutation(api.realtime.openDirect, { sessionToken: f.owner.token, teamId: f.teamId, recipientId: f.member.id });
    await f.t.mutation(api.realtime.send, { sessionToken: f.owner.token, teamId: f.teamId, conversation, body: "hi" });
    const inbox = await f.t.query(api.realtime.directConversations, { sessionToken: f.member.token, teamId: f.teamId });
    expect(inbox).toMatchObject([{ id: conversation, otherUserId: f.owner.id, unread: 1 }]);
    await expect(f.t.query(api.realtime.messages, { sessionToken: f.bystander.token, teamId: f.teamId, conversation })).rejects.toThrow("Conversation not found");
  });
});

describe("shared calls", () => {
  test("members on different apps see each other and exchange signals", async () => {
    const f = await fixture();
    const room = (person: { token: string }) => ({ sessionToken: person.token, teamId: f.teamId, room: f.projectId as string });
    const media = { audioEnabled: true, videoEnabled: false, screenSharing: false };
    const owner = await f.t.mutation(api.realtime.presence, { ...room(f.owner), action: "join", ...media });
    const member = await f.t.mutation(api.realtime.presence, { ...room(f.member), action: "join", ...media });
    expect((await f.t.query(api.realtime.participants, room(f.member))).map((person) => person.userId)).toEqual([f.owner.id, f.member.id]);
    await f.t.mutation(api.realtime.sendSignal, { ...room(f.owner), toUserId: f.member.id, kind: "offer", payload: "sdp", sessionId: owner.sessionId, toSessionId: member.sessionId });
    const signals = await f.t.query(api.realtime.signals, { ...room(f.member), sessionId: member.sessionId });
    expect(signals).toMatchObject([{ fromUserId: f.owner.id, kind: "offer", payload: "sdp" }]);
    await expect(f.t.query(api.realtime.participants, room(f.bystander))).rejects.toThrow("Conversation not found");
  });

  test("the call's agent and captions are shared, and only while an agent is in the call", async () => {
    const f = await fixture();
    const room = (person: { token: string }) => ({ sessionToken: person.token, teamId: f.teamId, room: f.projectId as string });
    await expect(f.t.mutation(api.realtime.addCallLine, { ...room(f.member), payload: "{}" })).rejects.toThrow("No agent is in this call");
    const set = await f.t.mutation(api.realtime.setCallAgent, { ...room(f.owner), payload: JSON.stringify({ name: "Chief" }), expected: null });
    expect(set.changed).toBe(true);
    expect((await f.t.mutation(api.realtime.setCallAgent, { ...room(f.member), payload: "{}", expected: null })).changed).toBe(false);
    await f.t.mutation(api.realtime.addCallLine, { ...room(f.member), payload: JSON.stringify({ speaker: "member", text: "hey Chief" }) });
    const state = await f.t.query(api.realtime.callAgent, { ...room(f.owner), after: 0 });
    expect(JSON.parse(state.agent!.payload)).toEqual({ name: "Chief" });
    expect(state.lines.map((line) => line.lineId)).toEqual([1]);
    await f.t.mutation(api.realtime.setCallAgent, { ...room(f.owner), payload: null });
    expect((await f.t.query(api.realtime.callAgent, { ...room(f.owner), after: 0 })).lines).toEqual([]);
  });
});
