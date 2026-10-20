import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "../scripts/control-omb.ts";
import { clientBotPatchViolation, requiredScope } from "./request-auth.ts";
import { createDailyApiBudget } from "./daily-api-budget.ts";

describe("daily API settings and ranked fallback through an isolated server", () => {
  let fixture: VerificationServer;
  let botId: string;
  let models: string[];
  const api = async (method: string, path: string, body?: unknown, status = 200): Promise<any> => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { origin: fixture.info.url, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };

  beforeAll(async () => {
    fixture = await launchVerificationServer();
    const fleet = await api("GET", "/api/instances");
    models = fleet.instances.find((instance: any) => instance.instanceId === "claude").models.options.map((model: any) => model.id);
    expect(models.length).toBeGreaterThanOrEqual(2);
    const created = await api("POST", "/api/bots", { name: "Synthetic fallback agent", modelSelection: { instanceId: "claude", model: models[0] } }, 201);
    botId = created.bot.id;
  });

  afterAll(async () => { await fixture?.close(); });

  it("keeps daily accounting and execution changes on the admin surface", () => {
    expect(requiredScope("GET", "/api/daily-api-budget")).toBe("admin");
    expect(clientBotPatchViolation({ quotaFallback: true })).toBe("quotaFallback");
    expect(clientBotPatchViolation({ fallbackApiAllowed: true })).toBe("fallbackApiAllowed");
    expect(clientBotPatchViolation({ dailyApiBudgetUsd: null })).toBe("dailyApiBudgetUsd");
  });

  it("round-trips a zero global cap and clears its live policy explicitly", async () => {
    const dailyApiBudget = { limitUsd: 0, timeZone: "Europe/Rome" };
    const config = await api("PUT", "/api/config", { dailyApiBudget });
    expect(config.dailyApiBudget).toEqual(dailyApiBudget);
    const report = await api("GET", "/api/daily-api-budget");
    expect(report).toMatchObject({ timeZone: "Europe/Rome", global: { limitUsd: 0, remainingUsd: 0, exceeded: true } });
    expect(Number.isFinite(Date.parse(report.resetsAt))).toBe(true);
    await api("PUT", "/api/config", { dailyApiBudget: null });
    expect((await api("GET", "/api/config")).dailyApiBudget).toBeUndefined();
    expect((await api("GET", "/api/daily-api-budget")).global).toBeUndefined();
    expect(JSON.parse(readFileSync(join(fixture.info.dataDir, "config.json"), "utf8")).dailyApiBudget).toBeUndefined();
  });

  it("preserves distinct models on one provider, saved order and explicit API permission", async () => {
    const fallback = [{ instanceId: "claude", model: models[1] }, { instanceId: "claude", model: models[0] }];
    const result = await api("PATCH", `/api/bots/${botId}`, {
      fallback: [...fallback, { instanceId: "claude", model: ` ${models[1]} ` }],
      quotaFallback: true, fallbackApiAllowed: false, dailyApiBudgetUsd: 1.25,
    });
    expect(result.bot).toMatchObject({ fallback, quotaFallback: true, fallbackApiAllowed: false, dailyApiBudgetUsd: 1.25 });
    const saved = JSON.parse(readFileSync(join(fixture.info.dataDir, "bots.json"), "utf8")).find((bot: any) => bot.id === botId);
    expect(saved).toMatchObject({ fallback, quotaFallback: true, fallbackApiAllowed: false, dailyApiBudgetUsd: 1.25 });
    expect(saved.modelSelection).toEqual({ instanceId: "claude", model: models[0] });
    const reordered = await api("PATCH", `/api/bots/${botId}`, { fallback: [...fallback].reverse(), fallbackApiAllowed: true });
    expect(reordered.bot.fallback).toEqual([...fallback].reverse());
    expect(reordered.bot.modelSelection).toEqual(saved.modelSelection);
  });

  it("treats a zero agent cap as a block and null as inheritance", async () => {
    expect((await api("PATCH", `/api/bots/${botId}`, { dailyApiBudgetUsd: 0 })).bot.dailyApiBudgetUsd).toBe(0);
    expect((await api("GET", "/api/daily-api-budget")).agents.find((agent: any) => agent.botId === botId)).toMatchObject({ limitUsd: 0, exceeded: true });
    expect((await api("PATCH", `/api/bots/${botId}`, { dailyApiBudgetUsd: null })).bot.dailyApiBudgetUsd).toBeUndefined();
    expect((await api("GET", "/api/daily-api-budget")).agents.find((agent: any) => agent.botId === botId).limitUsd).toBeUndefined();
  });

  it("rejects malformed caps and automatic-switch flags", async () => {
    await api("PUT", "/api/config", { dailyApiBudget: { limitUsd: -1, timeZone: "UTC" } }, 400);
    await api("PUT", "/api/config", { dailyApiBudget: { limitUsd: 1, timeZone: "fake/zone" } }, 400);
    await api("PATCH", `/api/bots/${botId}`, { dailyApiBudgetUsd: -1 }, 400);
    await api("PATCH", `/api/bots/${botId}`, { quotaFallback: "true" }, 400);
    await api("PATCH", `/api/bots/${botId}`, { fallbackApiAllowed: 1 }, 400);
  });

  it("requires active uncapped agents to stop before enabling new caps", async () => {
    const hanging = await launchVerificationServer({ FAKE_CLAUDE_MODE: "hang" });
    const request = async (method: string, path: string, body?: unknown) => fetch(hanging.info.url + path, {
      method, headers: { origin: hanging.info.url, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    const json = async (response: Response): Promise<any> => response.json();
    try {
      const { bot } = await runControlOmb(["new-bot", "--name", "Busy synthetic agent", "--url", hanging.info.url]) as any;
      await runControlOmb(["send", "--bot", bot.id, "--text", "HOLD_SYNTHETIC_BUDGET_TURN", "--url", hanging.info.url]);
      await expect.poll(async () => (await json(await request("GET", "/api/bots"))).bots.find((entry: any) => entry.id === bot.id)?.busy).toBe(true);
      const global = await request("PUT", "/api/config", { dailyApiBudget: { limitUsd: 2, timeZone: "UTC" } });
      expect(global.status).toBe(409);
      expect((await json(global)).error).toContain("Stop active agents");
      const agent = await request("PATCH", `/api/bots/${bot.id}`, { dailyApiBudgetUsd: 1 });
      expect(agent.status).toBe(409);
      expect((await json(agent)).error).toContain("Stop this agent");
      expect((await json(await request("GET", "/api/config"))).dailyApiBudget).toBeUndefined();
      expect((await json(await request("GET", "/api/bots"))).bots.find((entry: any) => entry.id === bot.id).dailyApiBudgetUsd).toBeUndefined();
    } finally { await hanging.close(); }
  }, 90_000);

  it("keeps API spending counted when a policy is cleared and rejects a reset-zone bypass", async () => {
    const ledger = createDailyApiBudget({ file: join(fixture.info.dataDir, "usage", "daily-api-budget.sqlite") });
    try {
      ledger.reserve({ requestId: "synthetic-timezone-cost", botId, policy: { limitUsd: 1, timeZone: "UTC" }, maximumUsd: 0.1 }).settle(0.1);
    } finally { ledger.close(); }
    const rejected = await api("PUT", "/api/config", { dailyApiBudget: { limitUsd: 1, timeZone: "Europe/Rome" } }, 409);
    expect(rejected.error).toContain("36 hours");
    await api("PUT", "/api/config", { dailyApiBudget: { limitUsd: 1, timeZone: "UTC" } });
    expect((await api("GET", "/api/daily-api-budget")).spentUsd).toBe(0.1);
    await api("PUT", "/api/config", { dailyApiBudget: null });
    await api("PUT", "/api/config", { dailyApiBudget: { limitUsd: 1, timeZone: "Europe/Rome" } }, 409);
    await api("PUT", "/api/config", { dailyApiBudget: { limitUsd: 0.5, timeZone: "UTC" } });
    expect((await api("GET", "/api/daily-api-budget")).global.remainingUsd).toBe(0.4);
  });
});
