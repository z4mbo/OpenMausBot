import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstanceConfig, ProviderInstance, ProviderSnapshot } from "./contracts.ts";
import { createApiBudgetHost, modelBilling } from "./api-budget-policy.ts";
import { closeDailyApiBudgets } from "./daily-api-budget.ts";

const subscription: ProviderSnapshot = { state: "available", authenticated: true, billing: "subscription" };
const dirs: string[] = [];
afterEach(() => { closeDailyApiBudgets(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const instance = (driverKind = "fixture", bounded = false): ProviderInstance => ({
  instanceId: "instance", driverKind, enabled: true, models: { default: "gpt-5.4", options: [{ id: "gpt-5.4", label: "GPT", contextWindow: 1_050_000 }] },
  adapter: { capabilities: { sessionModelSwitch: "unsupported", ...(bounded ? { apiRequestBudget: true } : {}) } },
} as ProviderInstance);
const fixture = (options: { snapshot?: ProviderSnapshot; config?: InstanceConfig; limitUsd?: number } = {}) => {
  const dataDir = mkdtempSync(join(tmpdir(), "origin-api-policy-")); dirs.push(dataDir);
  let snapshot = options.snapshot;
  const config = options.limitUsd === undefined ? {} : { dailyApiBudget: { limitUsd: options.limitUsd, timeZone: "Europe/Rome" } };
  const host = createApiBudgetHost({ dataDir, config: () => config, bot: () => ({}), provider: () => options.config, snapshot: () => snapshot });
  return { host, snapshot: (value: ProviderSnapshot) => { snapshot = value; } };
};

describe("API billing admission", () => {
  it("requires live agent attribution and current policy for unpriced paid AI", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "origin-unpriced-policy-")); dirs.push(dataDir);
    const config: { dailyApiBudget?: { limitUsd: number; timeZone: string } } = {};
    const bot: { dailyApiBudgetUsd?: number } = {};
    const host = createApiBudgetHost({ dataDir, config: () => config, bot: id => id === "agent" ? bot : null,
      provider: () => undefined, snapshot: () => undefined });
    expect(() => host.assertUnpriced(undefined, "Speech transcription")).not.toThrow();
    expect(() => host.assertUnpriced("", "Speech transcription")).toThrow(/agent/i);
    expect(() => host.assertUnpriced("missing", "Speech transcription")).toThrow(/agent/i);
    expect(() => host.assertUnpriced("agent", "Speech transcription")).not.toThrow();
    for (const limitUsd of [0, 2]) {
      config.dailyApiBudget = { limitUsd, timeZone: "Europe/Rome" };
      expect(() => host.assertUnpriced(undefined, "Speech transcription")).toThrow(/daily API budget/);
      expect(() => host.assertUnpriced("agent", "Speech transcription")).toThrow(/Speech transcription.*daily API budget/);
    }
    delete config.dailyApiBudget;
    for (const limitUsd of [0, 2]) {
      bot.dailyApiBudgetUsd = limitUsd;
      expect(() => host.assertUnpriced("agent", "Speech transcription")).toThrow(/daily API budget/);
      expect(() => host.assertUnpriced(undefined, "Speech transcription")).not.toThrow();
    }
    delete bot.dailyApiBudgetUsd;
    expect(() => host.assertUnpriced("agent", "Speech transcription")).not.toThrow();
  });

  it.each(["claudeAgent", "codex", "grokAgent"])("permits confirmed %s subscriptions under a zero API cap", driver => {
    const { host } = fixture({ snapshot: subscription, limitUsd: 0 });
    expect(host(instance(driver), "agent", "gpt-5.4")).toBeUndefined();
  });

  it("does not turn missing snapshots, custom routes or API-key auth into free subscriptions", () => {
    expect(modelBilling("codex", undefined, undefined)).toBe("unknown");
    expect(modelBilling("claudeAgent", undefined, { ...subscription, account: { method: "api-key" } })).toBe("metered");
    expect(modelBilling("grokAgent", undefined, subscription, "configured-api-slug", true)).toBe("unknown");
    expect(modelBilling("codex", undefined, subscription, "other::model")).toBe("unknown");
    expect(modelBilling("claudeAgent", { driver: "claudeAgent", config: {}, environment: { ANTHROPIC_API_KEY: "fixture-only" } }, subscription)).toBe("metered");
    const { host } = fixture({ limitUsd: 1 });
    expect(() => host(instance("codex"), "agent")).toThrow(/cannot enforce/);
  });

  it("requires separate API fallback consent even without a cap", () => {
    const target = instance("openai-compat", true);
    const { host } = fixture();
    const snapshot: ProviderSnapshot = { state: "available", authenticated: true, billing: "metered" };
    expect(host.fallbackRefusal(target, "agent", "gpt-5.4", snapshot, false)).toMatch(/not allowed/);
    expect(host.fallbackRefusal(target, "agent", "gpt-5.4", snapshot, true)).toBeUndefined();
  });

  it("skips unpriced and unaffordable paid backups before changing the thread", () => {
    const target = instance("openai-compat", true);
    const { host } = fixture({ limitUsd: 0.01 });
    const snapshot: ProviderSnapshot = { state: "available", authenticated: true, billing: "metered" };
    expect(host.fallbackRefusal(target, "agent", "gpt-5.4", snapshot, true)).toMatch(/cannot fit/);
    expect(host.fallbackRefusal(target, "agent", "unknown-model", snapshot, true)).toMatch(/reviewed|price|bound|known/i);
  });

  it("does not reuse a fallback subscription snapshot after newer account status arrives", () => {
    const target = instance("claudeAgent");
    const { host, snapshot } = fixture({ snapshot: { state: "available" }, limitUsd: 1 });
    expect(host.fallbackRefusal(target, "agent", "gpt-5.4", subscription, false)).toBeUndefined();
    expect(host(target, "agent", "gpt-5.4")).toBeUndefined();
    snapshot({ state: "available", authenticated: true, billing: "metered" });
    expect(() => host(target, "agent", "gpt-5.4")).toThrow(/cannot enforce/);
  });

  it("refreshes a cached subscription billing fact before capped CLI dispatch", async () => {
    const target = instance("claudeAgent"), { host } = fixture({ snapshot: subscription, limitUsd: 1 });
    target.snapshot = vi.fn(async (): Promise<ProviderSnapshot> => ({ ...subscription, account: { method: "api-key" }, billing: "metered" }));
    await expect(host.prepare(target, "agent", "gpt-5.4")).rejects.toThrow(/cannot enforce/);
    expect(target.snapshot).toHaveBeenCalledOnce();
  });

  it("accepts a freshly confirmed subscription even before a cached Engines read", async () => {
    const target = instance("codex"), { host } = fixture({ limitUsd: 0 });
    target.snapshot = vi.fn(async () => subscription);
    await expect(host.prepare(target, "agent", "gpt-5.4")).resolves.toBeUndefined();
  });

  it("does not probe confirmed API routes or uncapped CLI calls", async () => {
    for (const [driver, bounded, limitUsd] of [["openai-compat", true, 1], ["claudeAgent", false, undefined]] as const) {
      const target = instance(driver, bounded), { host } = fixture({ limitUsd });
      target.snapshot = vi.fn(async () => { throw new Error("Must not probe"); });
      await host.prepare(target, "agent", "gpt-5.4");
      expect(target.snapshot).not.toHaveBeenCalled();
    }
  });

  it("fails closed when a native billing probe cannot finish in its bounded window", async () => {
    const target = instance("codex"); target.snapshot = async () => new Promise(() => {});
    const dataDir = mkdtempSync(join(tmpdir(), "origin-api-probe-")); dirs.push(dataDir);
    const host = createApiBudgetHost({ dataDir, config: () => ({ dailyApiBudget: { limitUsd: 1, timeZone: "Europe/Rome" } }),
      bot: () => ({}), provider: () => undefined, snapshot: () => subscription, probeTimeoutMs: 5 });
    await expect(host.prepare(target, "agent", "gpt-5.4")).rejects.toThrow(/Could not confirm/);
  });

  it("does not admit a replaced connection after its old billing probe answers", async () => {
    const target = instance("codex"); let current = true;
    target.snapshot = async () => { current = false; return subscription; };
    const dataDir = mkdtempSync(join(tmpdir(), "origin-api-replaced-")); dirs.push(dataDir);
    const host = createApiBudgetHost({ dataDir, config: () => ({ dailyApiBudget: { limitUsd: 1, timeZone: "Europe/Rome" } }),
      bot: () => ({}), provider: () => undefined, snapshot: () => subscription, current: () => current });
    await expect(host.prepare(target, "agent", "gpt-5.4")).rejects.toThrow(/Could not confirm/);
  });
});
