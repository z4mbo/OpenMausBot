import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chatTranscript, createChatAgent, tagsAgent } from "./origin-chat-agent.ts";
import { localRealtimeBackend, type TokenChat } from "./origin-realtime-backend.ts";
import { openRealtimeStore } from "./origin-realtime-store.ts";
import type { RequestAuth } from "./request-auth.ts";

const AUTH: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function room() {
  const dir = mkdtempSync(join(tmpdir(), "chat-agent-"));
  dirs.push(dir);
  const store = openRealtimeStore(join(dir, "rt.sqlite"));
  const backend = localRealtimeBackend(() => store, { id: () => "f", write: () => undefined, read: () => new Uint8Array() });
  const scope = (userId: string, name: string, role = "member"): TokenChat => ({
    user: { userId, name, email: `${name}@x.dev`, teamId: "team1", role }, conversation: "project:kaiproject01", token: "t",
  });
  return { store, backend, scope };
}

const settle = async () => { for (let pass = 0; pass < 5; pass++) await new Promise((done) => setTimeout(done, 0)); };

describe("tagsAgent", () => {
  it("matches @name as the chat renders it", () => {
    expect(tagsAgent("@Chief what's next?", "Chief")).toBe(true);
    expect(tagsAgent("ok (@chief) check this", "Chief")).toBe(true);
    expect(tagsAgent("mail me at x@chief.dev", "Chief")).toBe(false);
    expect(tagsAgent("@Chiefly", "Chief")).toBe(false);
    expect(tagsAgent("Chief, hi", "Chief")).toBe(false);
  });
});

describe("chatTranscript", () => {
  it("keeps the newest messages when the conversation is long", () => {
    const messages = [1, 2, 3].map((n) => ({ authorName: `P${n}`, body: `message ${n}`, createdAt: Date.UTC(2026, 9, 23, 10, n) }));
    expect(chatTranscript(messages, 10_000)).toBe("[2026-10-23 10:01] P1: message 1\n[2026-10-23 10:02] P2: message 2\n[2026-10-23 10:03] P3: message 3");
    expect(chatTranscript(messages, 40)).toBe("[2026-10-23 10:03] P3: message 3");
  });
});

describe("the project agent in team chat", () => {
  it("answers when tagged, with the whole conversation, as a reply under its own name", async () => {
    const { store, backend, scope } = room();
    const prompts: string[] = [];
    const agent = createChatAgent({
      find: ({ projectId }) => (projectId === "kaiproject01" ? { id: "chief", name: "Chief" } : null),
      ask: async ({ prompt }) => { prompts.push(prompt); return "Ship on **Friday**."; },
    });
    try {
      await backend.send(scope("u2", "Bo"), "We could ship on Friday");
      const ask = await backend.send(scope("u1", "Ana"), "@Chief what do you think?");
      expect(agent.heard({ backend, scope: scope("u1", "Ana"), auth: AUTH, projectId: "kaiproject01", projectName: "Kai", message: ask })).toBe(true);
      expect(agent.thinking(scope("u1", "Ana"))).toEqual({ botId: "chief", name: "Chief" });
      await settle();
      expect(prompts[0]).toContain("The whole team chat so far");
      expect(prompts[0]).toContain("Bo: We could ship on Friday");
      expect(prompts[0]).toContain("Ana wrote: @Chief what do you think?");
      const latest = await backend.messages(scope("u2", "Bo"), {});
      expect(latest.at(-1)).toMatchObject({ authorUserId: "agent:chief", authorName: "Chief", body: "Ship on **Friday**.", replyTo: ask.id });
      expect(agent.thinking(scope("u1", "Ana"))).toBeNull();
    } finally {
      store.close();
    }
  });

  it("stays quiet when nobody tagged it, for viewers, and outside project chats", async () => {
    const { store, backend, scope } = room();
    const agent = createChatAgent({ find: () => ({ id: "chief", name: "Chief" }), ask: async () => "no" });
    try {
      const plain = await backend.send(scope("u1", "Ana"), "lunch?");
      expect(agent.heard({ backend, scope: scope("u1", "Ana"), auth: AUTH, projectId: "kaiproject01", projectName: "Kai", message: plain })).toBe(false);
      const tagged = await backend.send(scope("u1", "Ana"), "@Chief hi");
      expect(agent.heard({ backend, scope: scope("u3", "Cy", "viewer"), auth: AUTH, projectId: "kaiproject01", projectName: "Kai", message: tagged })).toBe(false);
      expect(agent.heard({ backend, scope: { ...scope("u1", "Ana"), conversation: "dm:u1:u2" }, auth: AUTH, projectId: "kaiproject01", projectName: "Kai", message: tagged })).toBe(false);
    } finally {
      store.close();
    }
  });

  it("says so in the chat when its turn fails", async () => {
    const { store, backend, scope } = room();
    const agent = createChatAgent({ find: () => ({ id: "chief", name: "Chief" }), ask: async () => { throw new Error("no engine connected"); } });
    try {
      const ask = await backend.send(scope("u1", "Ana"), "@Chief status?");
      agent.heard({ backend, scope: scope("u1", "Ana"), auth: AUTH, projectId: "kaiproject01", projectName: "Kai", message: ask });
      await settle();
      expect((await backend.messages(scope("u1", "Ana"), {})).at(-1)?.body).toBe("I couldn't answer that (no engine connected).");
    } finally {
      store.close();
    }
  });
});
