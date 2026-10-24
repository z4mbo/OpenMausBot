import { describe, expect, it, vi } from "vitest";
import { createSubscriptions, instanceSubscription } from "./agent-subscriptions.ts";
import type { InstanceConfigMap } from "./contracts.ts";
import type { PlanUsageReport } from "./plan-usage.ts";

const report = (plans: Record<string, string | null>): PlanUsageReport => ({
  fetchedAt: "", providers: Object.entries(plans).map(([id, plan]) => ({
    id, name: id, driver: "claude", plan, ok: true, error: null, extra: [], models: [],
    fiveHour: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null },
    weekly: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null },
  })),
});

describe("which account runs an agent", () => {
  it("names subscriptions by product and anything else as a key, never with a credential", () => {
    expect(instanceSubscription({ driver: "claudeAgent" }, "max")).toEqual({ provider: "claude", plan: "max" });
    expect(instanceSubscription({ driver: "codex", config: { authMode: "chatgpt-plan" } }, null)).toEqual({ provider: "chatgpt" });
    expect(instanceSubscription({ driver: "grokAgent" }, "SuperGrok")).toEqual({ provider: "grok", plan: "SuperGrok" });
    expect(instanceSubscription({ driver: "claudeAgent", access: "api", environment: { OMB_ANTHROPIC_API_KEY: "sk-ant-secret" } }, null)).toEqual({ provider: "key" });
    expect(instanceSubscription({ driver: "codex", config: { requireApiKey: true } }, "plus")).toEqual({ provider: "key" });
    expect(instanceSubscription({ driver: "openai-compat", displayName: "OpenRouter" }, null)).toEqual({ provider: "key", plan: "OpenRouter" });
  });

  it("asks the providers for plan names at most every half hour, and keeps the last answer through a failure", async () => {
    let now = 0;
    const instances: InstanceConfigMap = { claude: { driver: "claudeAgent" }, router: { driver: "openai-compat", displayName: "OpenRouter" }, off: { driver: "grokAgent", enabled: false } };
    const usage = vi.fn(async () => report({ claude: "max" }));
    const subscriptions = createSubscriptions({ instances: () => instances, usage, now: () => now });
    expect(await subscriptions.all()).toEqual({ claude: { provider: "claude", plan: "max" }, router: { provider: "key", plan: "OpenRouter" } });
    now = 29 * 60_000;
    await subscriptions.all();
    expect(usage).toHaveBeenCalledTimes(1);
    now = 31 * 60_000;
    usage.mockRejectedValueOnce(new Error("429"));
    expect((await subscriptions.all()).claude).toEqual({ provider: "claude", plan: "max" });
    expect(usage).toHaveBeenCalledTimes(2);
  });
});
