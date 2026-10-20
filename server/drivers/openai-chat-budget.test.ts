import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderInstance, RuntimeEvent } from "../contracts.ts";
import { createApiRequestBudget, createDailyApiBudget, type DailyApiBudget, type DailyApiBudgetPolicy } from "../daily-api-budget.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const answer = (usage: boolean = true) => json({ choices: [{ message: { content: "Done." }, finish_reason: "stop" }], ...(usage ? { usage: { prompt_tokens: 10, completion_tokens: 2 } } : {}) });
const quota = () => json({ error: { code: "usage_limit_reached", message: "Synthetic quota exhausted" } }, 429);

describe("per-request API budget enforcement", () => {
  let home: string;
  let budget: DailyApiBudget;
  const instances: ProviderInstance[] = [];
  const policy: DailyApiBudgetPolicy = { limitUsd: 1, timeZone: "UTC" };
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "origin-api-runtime-budget-")); budget = createDailyApiBudget({ file: join(home, "budget.sqlite") }); });
  afterEach(async () => { for (const instance of instances.splice(0)) await instance.dispose(); budget.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); await removeTempDir(home); });
  const engine = (apiUrl = "https://api.openai.com/v1", retryScale?: number) => {
    const instance = createOpenAIChatRuntime({
      input: { instanceId: "api", displayName: "Synthetic API", enabled: true, config: {}, environment: {} },
      driverKind: "fixture-api", apiKey: "synthetic-key", apiUrl, models: () => ({ default: "known", options: [{ id: "known", label: "Known", contextWindow: 1000 }] }),
      requestBody: (model, messages, stream) => ({ model, messages, stream }), httpErrorLabel: "Synthetic", missingKeyError: "Missing fixture key", unavailableReason: "Synthetic unavailable", timeoutMs: 5000,
      billing: "metered", includeUsageInCompleted: true, ...(retryScale === undefined ? {} : { retryScale }),
      nativeLog: { source: "synthetic.budget", outgoing: () => ({}), incoming: () => ({}) },
    });
    instances.push(instance);
    return instance;
  };
  const hook = (botId: string, configured: DailyApiBudgetPolicy | (() => DailyApiBudgetPolicy) = policy) => createApiRequestBudget({ budget, botId, policy: configured, priceFor: model => model === "known" ? { inputPerMillion: 1, outputPerMillion: 2 } : null });
  const events = (instance: ProviderInstance) => { const observed: RuntimeEvent[] = []; instance.adapter.onEvent(event => observed.push(event)); return observed; };
  const completed = async (observed: RuntimeEvent[]) => { await vi.waitFor(() => expect(observed.some(event => event.type === "turn.completed")).toBe(true)); return observed.find(event => event.type === "turn.completed") as Extract<RuntimeEvent, { type: "turn.completed" }>; };

  it("sets the provider output bound and settles actual helper usage against its agent", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return answer(); }));
    const instance = engine();
    expect(instance.adapter.capabilities.apiRequestBudget).toBe(true);
    await expect(instance.generateText!("Synthetic summary", { apiBudget: hook("a") })).resolves.toBe("Done.");
    expect(bodies[0]).toMatchObject({ max_completion_tokens: 4096, service_tier: "default" });
    expect(budget.status(policy)).toMatchObject({ spentUsd: 0.000014, reservedUsd: 0, agents: [expect.objectContaining({ botId: "a", spentUsd: 0.000014 })] });
  });

  it("admits only one concurrent agent when their combined reservations exceed the remaining cap", async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const calls = vi.fn(async () => { await gate; return answer(); });
    vi.stubGlobal("fetch", calls);
    const instance = engine();
    const small = { limitUsd: 0.01, timeZone: "UTC" };
    const first = instance.generateText!("First", { apiBudget: hook("a", small) });
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    try {
      await expect(instance.generateText!("Second", { apiBudget: hook("b", small) })).rejects.toThrow(/insufficient room/);
      expect(calls).toHaveBeenCalledTimes(1);
    } finally { finish(); }
    await first;
    expect(budget.status(small).reservedUsd).toBe(0);
  });

  it("leaves uncertain requests reserved after a provider response omits usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(false)));
    await expect(engine().generateText!("No usage", { apiBudget: hook("a") })).resolves.toBe("Done.");
    expect(budget.status(policy)).toMatchObject({ spentUsd: 0, reservedUsd: 0.009192, unknownCost: true });
  });

  it("retains the full hold when an incomplete stream reported only interim usage", async () => {
    const encoder = new TextEncoder();
    let sent = false;
    const calls = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        if (sent) { controller.error(new Error("Synthetic connection dropped")); return; }
        sent = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Partial work" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\n`));
      },
    }), { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", calls);
    const instance = engine("https://api.openai.com/v1", 0), observed = events(instance);
    const small = { limitUsd: 0.01, timeZone: "UTC" };
    await instance.adapter.sendTurn({ threadId: "partial-usage", text: "Synthetic stream", apiBudget: hook("a", small) });
    expect((await completed(observed)).ok).toBe(false);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(budget.status(small)).toMatchObject({ spentUsd: 0, reservedUsd: 0.009192, unknownCost: true });
  });

  it("settles a completed stream only after final usage arrives", async () => {
    const frames = [
      { choices: [{ delta: { content: "Done." } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } },
    ];
    const body = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-type": "text/event-stream" } })));
    const instance = engine(), observed = events(instance);
    await instance.adapter.sendTurn({ threadId: "final-usage", text: "Synthetic complete stream", apiBudget: hook("a") });
    expect((await completed(observed)).ok).toBe(true);
    expect(budget.status(policy)).toMatchObject({ spentUsd: 0.000014, reservedUsd: 0, unknownCost: false });
  });

  it("never dispatches unknown-price, unsupported-endpoint or already-aborted calls", async () => {
    const calls = vi.fn(async () => answer()); vi.stubGlobal("fetch", calls);
    await expect(engine().generateText!("Unknown", { model: "unlisted", apiBudget: hook("a") })).rejects.toThrow(/known price/);
    const unsupported = engine("https://api.example.test/v1");
    expect(unsupported.adapter.capabilities.apiRequestBudget).toBeUndefined();
    await expect(unsupported.generateText!("Unsupported", { apiBudget: hook("a") })).rejects.toThrow(/cannot enforce/);
    const signal = AbortSignal.abort();
    await expect(engine().generateText!("Cancelled", { signal, apiBudget: hook("a") })).rejects.toThrow();
    expect(calls).not.toHaveBeenCalled();
    expect(budget.status(policy)).toMatchObject({ spentUsd: 0, reservedUsd: 0 });
  });

  it("releases a reservation if cancellation wins before the request is dispatched", async () => {
    const abort = new AbortController(), real = hook("a");
    vi.stubGlobal("fetch", vi.fn(async () => answer()));
    await expect(engine().generateText!("Cancelled after admission", { signal: abort.signal, apiBudget: { begin(input) { const lease = real.begin(input); abort.abort(); return lease; } } })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(budget.status(policy)).toMatchObject({ spentUsd: 0, reservedUsd: 0 });
  });

  it("checks every tool-loop round and observes a cap lowered after the first request", async () => {
    let configured = policy;
    const calls = vi.fn(async () => {
      configured = { limitUsd: 0, timeZone: "UTC" };
      return json({ choices: [{ message: { content: null, tool_calls: [{ id: "one", type: "function", function: { name: "unavailable_fixture_tool", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
    });
    vi.stubGlobal("fetch", calls);
    const instance = engine(), observed = events(instance);
    await instance.adapter.sendTurn({ botId: "a", threadId: "round-cap", text: "Synthetic tool loop", approvalMode: "full", apiBudget: hook("a", () => configured) });
    expect((await completed(observed)).ok).toBe(false);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(observed.some(event => event.type === "runtime.error" && /daily API budget/.test(event.message))).toBe(true);
    expect(budget.status(policy).reservedUsd).toBe(0);
  });

  it("activates a lazy policy on the next request of a turn that started uncapped", async () => {
    let configured: DailyApiBudgetPolicy = { timeZone: "UTC" };
    const bodies: Record<string, unknown>[] = [];
    const calls = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      configured = { limitUsd: 0, timeZone: "UTC" };
      return json({ choices: [{ message: { content: null, tool_calls: [{ id: "one", type: "function", function: { name: "unavailable_fixture_tool", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
    });
    vi.stubGlobal("fetch", calls);
    const instance = engine(), observed = events(instance);
    await instance.adapter.sendTurn({ threadId: "new-cap", text: "Synthetic tool loop", apiBudget: hook("a", () => configured) });
    expect((await completed(observed)).ok).toBe(false);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(bodies[0].max_completion_tokens).toBeUndefined();
    expect(budget.status(policy)).toMatchObject({ spentUsd: 0, reservedUsd: 0 });
  });

  it("applies admission to all 64 bounded tool rounds without rebooking the whole turn", async () => {
    let count = 0;
    const calls = vi.fn(async () => json({ choices: [{ message: { content: null, tool_calls: [{ id: `call-${++count}`, type: "function", function: { name: "unavailable_fixture_tool", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    vi.stubGlobal("fetch", calls);
    const instance = engine(), observed = events(instance), apiBudget = hook("a");
    const begin = vi.spyOn(apiBudget, "begin");
    await instance.adapter.sendTurn({ botId: "a", threadId: "all-rounds", text: "Synthetic bounded loop", approvalMode: "full", apiBudget });
    expect((await completed(observed)).ok).toBe(false);
    expect(calls).toHaveBeenCalledTimes(64);
    expect(begin).toHaveBeenCalledTimes(64);
    expect(budget.status(policy)).toMatchObject({ spentUsd: 0.000896, reservedUsd: 0, unknownCost: false });
  });

  it("emits a safe typed quota refusal only for the very first request with no work", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => quota()));
    const instance = engine(), observed = events(instance);
    await instance.adapter.sendTurn({ threadId: "quota-first", text: "Synthetic request" });
    expect((await completed(observed)).refusal).toEqual({ kind: "quota_exhausted", scope: "account", retry: "safe_initial_refusal" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never marks quota refusal safe after a previous request had an uncertain outcome", async () => {
    let count = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ++count === 1 ? json({ error: { message: "Synthetic outage" } }, 500) : quota()));
    const instance = engine("https://api.openai.com/v1", 0), observed = events(instance);
    await instance.adapter.sendTurn({ threadId: "quota-after-outage", text: "Synthetic request" });
    expect((await completed(observed)).refusal).toEqual({ kind: "quota_exhausted", scope: "account", retry: "manual" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not turn generic rate limits, authentication or insufficient API credit into quota fallback", async () => {
    for (const [status, code] of [[429, "rate_limit_exceeded"], [429, "insufficient_quota"], [401, "usage_limit_reached"]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code } }, status)));
      const instance = engine(), observed = events(instance);
      await instance.adapter.sendTurn({ threadId: `not-quota-${code}`, text: "Synthetic request" });
      expect((await completed(observed)).refusal).toBeUndefined();
    }
  });
});
