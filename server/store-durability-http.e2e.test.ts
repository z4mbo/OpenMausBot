import { mkdirSync, readFileSync, renameSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { WireBot, WireMessage } from "../shared/wire.ts";

interface ApiBody { bot?: WireBot; bots?: WireBot[]; messages?: WireMessage[]; error?: string }

describe("registered task routes with an unwritable bots.json", () => {
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>>;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url, connection: "close" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as ApiBody };
  };
  const bots = async () => (await api("GET", "/api/bots?messages=0")).body.bots as WireBot[];
  const newBot = async () => (await api("POST", "/api/bots", {})).body.bot as WireBot;
  const messages = async (thread: string) => (await api("GET", `/api/threads/${thread}/messages?limit=50`)).body.messages as WireMessage[];
  async function blockedSave<T>(operation: () => Promise<T>): Promise<T> {
    const file = join(fixture.info.dataDir, "bots.json"), backup = file + ".fixture-before";
    const original = readFileSync(file);
    renameSync(file, backup);
    mkdirSync(file);
    try { return await operation(); }
    finally {
      rmdirSync(file); renameSync(backup, file);
      expect(readFileSync(file)).toEqual(original);
    }
  }
  beforeAll(async () => { fixture = await launchVerificationServer({}); }, 40_000);
  afterAll(async () => { await fixture?.close(); }, 40_000);

  it("rejects a rename without publishing it", async () => {
    const bot = await newBot(), path = `/api/bots/${bot.id}/tasks/${bot.threadId}`;
    const title = (await bots()).find(entry => entry.id === bot.id)!.tasks![0]!.title;
    const result = await blockedSave(() => api("PATCH", path, { title: "Unsaved HTTP rename" }));
    expect(result.status).toBe(500);
    expect((await bots()).find(entry => entry.id === bot.id)!.tasks![0]!.title).toBe(title);
    expect(result.body.error).toContain("Couldn't save the conversation change");
    expect(result.body.error).not.toContain(fixture.info.dataDir);
  });

  it("rejects new conversations without exposing an unsaved task", async () => {
    const bot = await newBot(), path = `/api/bots/${bot.id}/tasks`;
    const original = (await bots()).find(entry => entry.id === bot.id)!;
    expect((await blockedSave(() => api("POST", path, { title: "Unsaved HTTP thread" }))).status).toBe(500);
    const current = (await bots()).find(entry => entry.id === bot.id)!;
    expect(current.threadId).toBe(original.threadId);
    expect(current.tasks).toEqual(original.tasks);
  });

  it("cannot activate Full access after reporting that its save failed", async () => {
    const bot = await newBot(), path = `/api/bots/${bot.id}/tasks/${bot.threadId}`;
    expect((await api("PATCH", path, { approvalMode: "ask" })).status).toBe(200);
    expect((await blockedSave(() => api("PATCH", path, { approvalMode: "full" }))).status).toBe(500);
    expect((await bots()).find(entry => entry.id === bot.id)!.tasks![0]!.approvalMode).toBe("ask");
  });

  it("retains a real fake-engine conversation after a failed delete, then permits a successful retry", async () => {
    const bot = await newBot(), path = `/api/bots/${bot.id}/tasks/${bot.threadId}`;
    const cli = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
    await cli("send", "--bot", bot.id, "--task", bot.threadId, "--text", "Retain this isolated conversation");
    expect(await cli("wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "25")).toMatchObject({ status: "settled" });
    const original = await messages(bot.threadId);
    expect(original.some(message => message.role === "user" && message.text === "Retain this isolated conversation")).toBe(true);
    expect(original.some(message => message.role === "bot" && message.kind === "text")).toBe(true);
    expect((await blockedSave(() => api("DELETE", path))).status).toBe(500);
    expect(await messages(bot.threadId)).toEqual(original);
    expect((await bots()).find(entry => entry.id === bot.id)!.tasks!.some(task => task.threadId === bot.threadId)).toBe(true);
    expect((await api("DELETE", path)).status).toBe(200);
    expect((await bots()).find(entry => entry.id === bot.id)!.tasks!.some(task => task.threadId === bot.threadId)).toBe(false);
    expect((await api("GET", `/api/threads/${bot.threadId}/messages?limit=50`)).status).toBe(404);
  }, 40_000);
});
