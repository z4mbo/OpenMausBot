import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiBudgetContextWindow, apiBudgetModelBound, boundedApiRequestBody, closeDailyApiBudgets, createApiRequestBudget, createDailyApiBudget, dailyApiBudgetDay, dailyApiBudgetEnabled, dailyApiBudgetForDataDir, quoteApiBudgetRequest, supportsApiRequestBudget, type DailyApiBudget } from "./daily-api-budget.ts";
import { removeTempDir } from "./testing/cleanup.ts";

describe("durable daily API reservations", () => {
  let home: string;
  let at: number;
  const handles: DailyApiBudget[] = [];
  const open = () => { const budget = createDailyApiBudget({ file: join(home, "budget.sqlite"), now: () => at }); handles.push(budget); return budget; };
  const policy = { limitUsd: 1, timeZone: "UTC" };
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "origin-daily-api-")); at = Date.parse("2026-10-19T12:00:00Z"); });
  afterEach(async () => { for (const budget of handles.splice(0)) budget.close(); closeDailyApiBudgets(); await removeTempDir(home); });

  it("checks global and agent balances together, including in-flight requests", () => {
    const budget = open();
    const first = budget.reserve({ requestId: "first", botId: "a", policy: { ...policy, agentLimitUsd: 0.7 }, maximumUsd: 0.6 });
    expect(() => budget.reserve({ requestId: "second", botId: "b", policy, maximumUsd: 0.5 })).toThrow(/total daily/);
    expect(() => budget.reserve({ requestId: "third", botId: "a", policy: { ...policy, agentLimitUsd: 0.7 }, maximumUsd: 0.2 })).toThrow(/agent's daily/);
    first.settle(0.1);
    const second = budget.reserve({ requestId: "second", botId: "b", policy, maximumUsd: 0.5 });
    expect(budget.status(policy, [{ botId: "a", limitUsd: 0.7 }])).toMatchObject({ spentUsd: 0.1, reservedUsd: 0.5, global: { remainingUsd: 0.4 }, agents: [expect.objectContaining({ botId: "a", spentUsd: 0.1, remainingUsd: 0.6 }) , expect.objectContaining({ botId: "b", reservedUsd: 0.5 })] });
    second.notDispatched();
    expect(budget.status(policy).reservedUsd).toBe(0);
  });

  it("denies zero global or agent caps even when a requested reserve rounds to zero", () => {
    const budget = open();
    for (const zero of [{ limitUsd: 0, timeZone: "UTC" }, { agentLimitUsd: 0, timeZone: "UTC" }]) {
      expect(() => budget.reserve({ requestId: "zero", botId: "a", policy: zero, maximumUsd: 0 })).toThrow(/daily API budget/);
    }
    expect(dailyApiBudgetEnabled({ timeZone: "UTC" })).toBe(false);
    expect(dailyApiBudgetEnabled({ timeZone: "UTC", agentLimitUsd: 0 })).toBe(true);
  });

  it("rounds reservations up to integer microdollars without rounding the cap up", () => {
    const budget = open();
    const small = { limitUsd: 0.000001, timeZone: "UTC" };
    budget.reserve({ requestId: "one", botId: "a", policy: small, maximumUsd: 0.0000001 });
    expect(budget.status(small).reservedUsd).toBe(0.000001);
    expect(() => budget.reserve({ requestId: "two", botId: "b", policy: small, maximumUsd: 0.0000001 })).toThrow(/insufficient/);
  });

  it("settles once, retains uncertain costs, and never admits a duplicate request ID", () => {
    const budget = open();
    const lease = budget.reserve({ requestId: "one", botId: "a", policy, maximumUsd: 0.5 });
    lease.settle(null);
    lease.settle(null);
    expect(budget.status(policy)).toMatchObject({ reservedUsd: 0.5, spentUsd: 0, unknownCost: true });
    lease.settle(0.2);
    lease.settle(0.2);
    expect(budget.status(policy)).toMatchObject({ reservedUsd: 0, spentUsd: 0.2, unknownCost: false });
    expect(() => lease.notDispatched()).toThrow(/different outcome/);
    expect(() => budget.reserve({ requestId: "one", botId: "a", policy, maximumUsd: 0.1 })).toThrow(/already/);
  });

  it("keeps unresolved reservations across restart rather than refunding uncertain provider work", () => {
    const first = open();
    first.reserve({ requestId: "pending", botId: "a", policy, maximumUsd: 0.8 });
    first.close();
    const resumed = open();
    expect(resumed.status(policy)).toMatchObject({ reservedUsd: 0.8, unknownCost: true });
    expect(() => resumed.reserve({ requestId: "new", botId: "b", policy, maximumUsd: 0.3 })).toThrow(/insufficient/);
  });

  it("keeps settlement in its request day when completion crosses midnight", () => {
    const budget = open();
    at = Date.parse("2026-10-19T23:59:59Z");
    const lease = budget.reserve({ requestId: "late", botId: "a", policy, maximumUsd: 0.9 });
    at = Date.parse("2026-10-20T00:00:01Z");
    lease.settle(0.4);
    expect(budget.status(policy)).toMatchObject({ day: "2026-10-20", spentUsd: 0, reservedUsd: 0 });
    at = Date.parse("2026-10-19T23:59:59Z");
    expect(budget.status(policy)).toMatchObject({ spentUsd: 0.4 });
  });

  it("uses the saved timezone through DST folds and reports the actual next local midnight", () => {
    const budget = open();
    at = Date.parse("2026-10-24T22:00:00Z");
    expect(budget.status({ ...policy, timeZone: "Europe/Rome" })).toMatchObject({ day: "2026-10-25", resetsAt: "2026-10-25T23:00:00.000Z" });
    expect(dailyApiBudgetDay(Date.parse("2026-10-25T00:59:59Z"), "Europe/Rome")).toBe(dailyApiBudgetDay(Date.parse("2026-10-25T01:00:00Z"), "Europe/Rome"));
    at = Date.parse("2026-03-28T23:00:00Z");
    expect(budget.status({ ...policy, timeZone: "Europe/Rome" }).resetsAt).toBe("2026-03-29T22:00:00.000Z");
    expect(() => budget.status({ ...policy, timeZone: "Unknown/Fixture" })).toThrow(/timezone/);
  });

  it("keeps earlier costs and holds visible after disabling or changing the policy timezone", () => {
    const budget = open();
    budget.reserve({ requestId: "spent", botId: "a", policy, maximumUsd: 0.5 }).settle(0.4);
    budget.reserve({ requestId: "held", botId: "b", policy, maximumUsd: 0.5 }).settle(null);
    expect(budget.status({ timeZone: "Europe/Rome" })).toMatchObject({ spentUsd: 0.4, reservedUsd: 0.5, unknownCost: true });
    const changed = { limitUsd: 1, timeZone: "Europe/Rome" };
    expect(() => budget.reserve({ requestId: "over", botId: "a", policy: changed, maximumUsd: 0.2 })).toThrow(/insufficient/);
    expect(budget.status(changed, [{ botId: "a", limitUsd: 0.6 }])).toMatchObject({ global: { remainingUsd: 0.1 }, agents: [expect.objectContaining({ botId: "a", spentUsd: 0.4, remainingUsd: 0.2 }), expect.objectContaining({ botId: "b", reservedUsd: 0.5 })] });
  });

  it("prevents timezone cycling from resetting recent persisted spend or uncertain work", () => {
    const budget = open();
    budget.reserve({ requestId: "spent", botId: "a", policy, maximumUsd: 0.5 }).settle(0.4);
    budget.reserve({ requestId: "released", botId: "b", policy: { ...policy, timeZone: "Europe/Rome" }, maximumUsd: 0.1 }).notDispatched();
    expect(budget.timeZoneChangeAllowed("UTC")).toBe(true);
    expect(budget.timeZoneChangeAllowed("Europe/Rome")).toBe(false);
    budget.close();
    const resumed = open();
    expect(resumed.timeZoneChangeAllowed("Europe/Rome")).toBe(false);
    at += 36 * 3600_000 + 1;
    expect(resumed.timeZoneChangeAllowed("Europe/Rome")).toBe(true);
    resumed.reserve({ requestId: "uncertain", botId: "a", policy, maximumUsd: 0.2 }).settle(null);
    expect(resumed.timeZoneChangeAllowed("Europe/Rome")).toBe(false);
  });

  it("uses one manager for status reads without marking active reservations uncertain", () => {
    const first = dailyApiBudgetForDataDir(home), second = dailyApiBudgetForDataDir(home);
    expect(first).toBe(second);
    const lease = first.reserve({ requestId: "active", botId: "a", policy, maximumUsd: 0.2 });
    expect(second.status(policy)).toMatchObject({ reservedUsd: 0.2, unknownCost: false });
    lease.notDispatched();
    closeDailyApiBudgets(home);
    expect(dailyApiBudgetForDataDir(home)).not.toBe(first);
  });

  it("refuses damaged accounting storage instead of resetting the allowance", () => {
    writeFileSync(join(home, "budget.sqlite"), "synthetic corrupted database");
    expect(open).toThrow();
  });

  it("serializes real concurrent SQLite writers so only one agent reserves the final balance", async () => {
    const file = join(home, "budget.sqlite");
    const seed = open(); seed.close();
    const source = new URL("./daily-api-budget.ts", import.meta.url).href;
    const workers = ["a", "b"].map(botId => new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      import(workerData.source).then(({createDailyApiBudget})=>{
        const budget=createDailyApiBudget({file:workerData.file,now:()=>workerData.at});
        parentPort.on('message',()=>{
          try { budget.reserve({requestId:workerData.botId,botId:workerData.botId,policy:{limitUsd:1,timeZone:'UTC'},maximumUsd:0.75}); parentPort.postMessage({ok:true}); }
          catch(error) { parentPort.postMessage({ok:false,code:error.code}); }
          finally { budget.close(); parentPort.close(); }
        }); parentPort.postMessage({ready:true});
      }).catch(error=>{throw error});`, { eval: true, workerData: { source, file, botId, at }, execArgv: ["--experimental-strip-types"] }));
    try {
      await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => { worker.once("message", value => value.ready ? resolve() : reject(new Error("worker not ready"))); worker.once("error", reject); })));
      const results = workers.map(worker => new Promise<{ ok: boolean; code?: string }>((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); }));
      for (const worker of workers) worker.postMessage("reserve");
      const outcomes = await Promise.all(results);
      expect(outcomes.filter(value => value.ok)).toHaveLength(1);
      expect(outcomes.filter(value => !value.ok)).toEqual([{ ok: false, code: "daily_api_budget" }]);
      expect(open().status(policy).reservedUsd).toBe(0.75);
    } finally { await Promise.all(workers.map(worker => worker.terminate())); }
  });

  it("keeps unknown pricing explicit and snapshots known rates for settlement", () => {
    const budget = open();
    const price = { inputPerMillion: 1, outputPerMillion: 2 };
    let activePolicy = policy;
    const hook = createApiRequestBudget({ budget, botId: "a", policy: () => activePolicy, priceFor: model => model === "known" ? price : null });
    expect(() => hook.begin({ model: "unknown", contextWindow: 1000, maxOutputTokens: 10 })).toThrow(/known price/);
    expect(() => hook.begin({ model: "known", contextWindow: undefined, maxOutputTokens: 10 })).toThrow(/known price/);
    const lease = hook.begin({ model: "known", contextWindow: 1000, maxOutputTokens: 10 });
    price.inputPerMillion = 100;
    lease.settle({ input: 100, output: 10 });
    expect(budget.status(policy).spentUsd).toBe(0.00012);
    activePolicy = { limitUsd: 0, timeZone: "UTC" };
    expect(() => hook.begin({ model: "known", contextWindow: 1000, maxOutputTokens: 10 })).toThrow(/insufficient/);
  });

  it("retains the maximum reservation when provider usage is absent or malformed", () => {
    const budget = open();
    const hook = createApiRequestBudget({ budget, botId: "a", policy, priceFor: () => ({ inputPerMillion: 1, outputPerMillion: 2 }) });
    hook.begin({ model: "known", contextWindow: 1000, maxOutputTokens: 10 }).settle({ input: Number.NaN, output: 2 });
    expect(budget.status(policy)).toMatchObject({ spentUsd: 0, reservedUsd: 0.00102, unknownCost: true });
  });

  it("preflights the reviewed full-context price without reserving or trusting a smaller display limit", () => {
    const budget = open();
    const quote = quoteApiBudgetRequest({ model: "gpt-5.4", contextWindow: 272000, maxOutputTokens: 4096 });
    expect(quote).toMatchObject({ contextWindow: 1050000, price: { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 22.5 } });
    expect(quote.maximumUsd).toBeCloseTo(5.34216);
    expect(quoteApiBudgetRequest({ model: "openai/gpt-5.4-mini", contextWindow: undefined, maxOutputTokens: 4096 }).maximumUsd).toBeCloseTo(0.318432);
    expect(() => quoteApiBudgetRequest({ model: "unlisted", contextWindow: 1000, maxOutputTokens: 4096 })).toThrow(/known price/);
    expect(budget.status(policy)).toMatchObject({ spentUsd: 0, reservedUsd: 0 });
  });

  it("keeps long-context cached input at the conservative captured rate on settlement", () => {
    const budget = open(), generous = { ...policy, limitUsd: 10 };
    const hook = createApiRequestBudget({ budget, botId: "a", policy: generous });
    hook.begin({ model: "gpt-5.4", contextWindow: 272000, maxOutputTokens: 4096 }).settle({ input: 500000, cachedInput: 500000, output: 2 });
    expect(budget.status(generous)).toMatchObject({ spentUsd: 0.250045, reservedUsd: 0, unknownCost: false });
  });

  it("records a provider cost overrun and refuses subsequent work rather than hiding the excess", () => {
    const budget = open();
    const capped = { limitUsd: 0.002, timeZone: "UTC" };
    const hook = createApiRequestBudget({ budget, botId: "a", policy: capped, priceFor: () => ({ inputPerMillion: 1, outputPerMillion: 2 }) });
    const lease = hook.begin({ model: "known", contextWindow: 1000, maxOutputTokens: 10 });
    expect(() => lease.settle({ input: 10, output: 2, costUsd: 0.003 })).toThrow(/exceeded its reserved/);
    expect(budget.status(capped)).toMatchObject({ spentUsd: 0.003, reservedUsd: 0, global: { exceeded: true, remainingUsd: 0 } });
    expect(() => hook.begin({ model: "known", contextWindow: 1000, maxOutputTokens: 10 })).toThrow(/insufficient/);
  });

  it("bounds recognized OpenAI/OpenRouter requests and refuses unknown endpoints and price-changing options", () => {
    const lease = { maxOutputTokens: 100, price: { inputPerMillion: 1, outputPerMillion: 2 }, settle: () => {}, notDispatched: () => {} };
    expect(boundedApiRequestBody("https://api.openai.com/v1", { model: "known", max_tokens: 999 }, lease)).toEqual({ model: "known", max_completion_tokens: 100, service_tier: "default" });
    expect(boundedApiRequestBody("https://openrouter.ai/api/v1", { provider: { order: ["fixture"], allow_fallbacks: false } }, lease)).toMatchObject({ provider: { order: ["fixture"], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 1, completion: 2, request: 0, image: 0 } } });
    for (const url of ["https://api.openai.com.evil.test/v1", "http://api.openai.com/v1", "https://api.x.ai/v1", "http://127.0.0.1:1234/v1", "https://api.openai.com/v1?proxy=1"]) expect(supportsApiRequestBudget(url)).toBe(false);
    for (const body of [{ n: 2 }, { models: ["other"] }, { plugins: [] }, { modalities: ["audio"] }, { service_tier: "priority" }]) expect(() => boundedApiRequestBody("https://api.openai.com/v1", body, lease)).toThrow(/pricing/);
    expect(apiBudgetContextWindow("openai/gpt-5.4", 272000)).toBe(1050000);
    expect(apiBudgetContextWindow("gpt-5.4-mini")).toBe(400000);
    expect(apiBudgetModelBound("gpt-6-astra")).toMatchObject({ contextWindow: 1050000, inputMultiplier: 2.5, outputMultiplier: 1.5, reviewedAt: "2026-10-19" });
    expect(apiBudgetContextWindow("unknown")).toBeUndefined();
  });
});
