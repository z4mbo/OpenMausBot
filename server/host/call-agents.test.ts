import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";
import type { ApiRequestBudget, ProviderInstance } from "../contracts.ts";
import type { BotRecord, Store } from "../store.ts";
import { createCallAgentHost } from "./call-agents.ts";
import { DEFAULT_CALL_AGENT_SETTINGS, type CallAgentSettings } from "../origin-call-agent.ts";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const bot = { id: "chief", modelSelection: { instanceId: "api", model: "chosen" } } as BotRecord;
  const generateText = vi.fn(async () => "summary");
  const instance = { id: "api", enabled: true, generateText } as unknown as ProviderInstance;
  const budget = {} as ApiRequestBudget;
  const apiBudget = vi.fn(async () => budget);
  const host = createCallAgentHost({
    file: new URL("./nonexistent-summary-settings.json", import.meta.url).pathname,
    store: { bot: () => bot } as unknown as Store,
    cfg: {} as AppConfig,
    instance: () => instance,
    providerRefusal: () => undefined,
    hostedModels: () => null,
    visible: () => true,
    project: () => null,
    send: async () => {},
    assertBudget: () => {},
    unpricedApiBudget: () => {},
    apiBudget,
  });
  return { host, bot, instance, generateText, apiBudget, budget };
}

describe("call and Pipeline summaries share the model budget gate", () => {
  it("passes the exact prepared budget to the selected provider", async () => {
    const f = fixture();
    await expect(f.host.summarize({ botId: "chief", prompt: "synthetic transcript" })).resolves.toBe("summary");
    expect(f.apiBudget).toHaveBeenCalledWith(f.instance, "chief", undefined);
    expect(f.generateText).toHaveBeenCalledWith("synthetic transcript", { apiBudget: f.budget, timeoutMs: 180_000 });
  });

  it("does not dispatch a summary when its budget is refused", async () => {
    const f = fixture();
    f.apiBudget.mockRejectedValue(new Error("Daily API limit reached"));
    await expect(f.host.summarize({ botId: "chief", prompt: "synthetic transcript" })).rejects.toThrow("Daily API limit reached");
    expect(f.generateText).not.toHaveBeenCalled();
  });
});

describe("call transcription budget admission", () => {
  const auth = { kind: "loopback", scopes: ["admin", "client"] } as const;
  const scope = { teamId: "team", room: "project", name: "Project", user: { userId: "person", name: "Person" } };
  async function transcriptionFixture(transcription: CallAgentSettings["transcription"]) {
    const dir = mkdtempSync(join(tmpdir(), "origin-call-budget-")); dirs.push(dir);
    const file = join(dir, "call-agent.json");
    writeFileSync(file, JSON.stringify({ ...DEFAULT_CALL_AGENT_SETTINGS, transcription }));
    const bot = { id: "chief", name: "Chief", chiefOfStaff: true, modelSelection: { instanceId: "api", model: "chosen" } } as BotRecord;
    const unpricedApiBudget = vi.fn<(botId: string, service: string) => void>(() => {});
    const fetch = vi.fn(async () => Response.json({ text: "A meeting note" }));
    vi.stubGlobal("fetch", fetch);
    const host = createCallAgentHost({ file, store: { bot: (id: string) => id === "chief" ? bot : null } as unknown as Store,
      cfg: { groq: { key: "synthetic-groq" }, openai: { key: "synthetic-openai" } } as AppConfig,
      instance: () => null, providerRefusal: () => undefined, hostedModels: () => null, visible: () => true,
      project: () => "project", send: async () => {}, assertBudget: () => {}, apiBudget: async () => undefined, unpricedApiBudget });
    await host.callAgents.join(scope, auth, "chief", [scope.user.userId]);
    const audio = () => host.callAgents.audio(scope, auth, new Uint8Array([1, 2]), "audio/webm", [scope.user.userId]);
    return { audio, unpricedApiBudget, fetch };
  }

  it.each([
    { engine: "openai", baseUrl: "http://127.0.0.1:8000/v1", model: "" },
    { engine: "groq", baseUrl: "http://127.0.0.1:8000/v1", model: "" },
    { engine: "local", baseUrl: "https://transcribe.example.test/v1", model: "" },
    { engine: "local", baseUrl: "http://127.0.0.1.example.test/v1", model: "" },
  ] satisfies CallAgentSettings["transcription"][])("refuses capped $engine transcription before its audio POST", async transcription => {
    const f = await transcriptionFixture(transcription);
    f.unpricedApiBudget.mockImplementation(() => { throw new Error("Daily API budget cannot bound transcription"); });
    await expect(f.audio()).rejects.toThrow(/Daily API budget/);
    expect(f.unpricedApiBudget).toHaveBeenCalledWith("chief", expect.stringMatching(/transcription/i));
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each(["http://127.0.0.1:8000/v1", "http://localhost:8000/v1", "http://[::1]:8000/v1"])("keeps loopback transcription available at %s", async baseUrl => {
    const f = await transcriptionFixture({ engine: "local", baseUrl, model: "" });
    f.unpricedApiBudget.mockImplementation(() => { throw new Error("Daily API limit reached"); });
    await expect(f.audio()).resolves.toMatchObject({ line: { text: "A meeting note" } });
    expect(f.unpricedApiBudget).not.toHaveBeenCalled();
    expect(f.fetch).toHaveBeenCalledOnce();
  });

  it("rechecks the exact call agent when a cap changes between audio requests", async () => {
    const f = await transcriptionFixture({ engine: "openai", baseUrl: "http://127.0.0.1:8000/v1", model: "" });
    await f.audio();
    f.unpricedApiBudget.mockImplementation(() => { throw new Error("Daily API budget cannot bound transcription"); });
    await expect(f.audio()).rejects.toThrow(/Daily API budget/);
    expect(f.unpricedApiBudget).toHaveBeenCalledTimes(2);
    expect(f.fetch).toHaveBeenCalledOnce();
  });
});
