import { describe, expect, it } from "vitest";
import { defaultsChanged, defaultsPayload, parsePlan, providerDefaults } from "./shared-agents-plan";

const engine = (instanceId: string, driverKind: string, models: string[], fallback = models[0] ?? "") => ({
  instanceId,
  driverKind,
  displayName: instanceId,
  models: { default: fallback, options: models.map((id) => ({ id, label: id.toUpperCase() })) },
});

describe("providerDefaults", () => {
  it("offers one row per provider, starting on the engine's own default", () => {
    const rows = providerDefaults([engine("claude", "claudeAgent", ["opus", "sonnet"], "sonnet"), engine("codex", "codex", ["gpt"])], {});
    expect(rows.map((row) => row.driverKind)).toEqual(["claudeAgent", "codex"]);
    expect(rows[0]!.options.map((option) => option.label)).toEqual(["OPUS", "SONNET"]);
    expect(rows[0]!.selected).toBe(1);
  });

  it("names the account when one provider has several, and starts on the saved default", () => {
    const rows = providerDefaults(
      [engine("work", "claudeAgent", ["opus"]), engine("home", "claudeAgent", ["opus"])],
      { claudeAgent: { instanceId: "home", model: "opus" } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.options.map((option) => option.label)).toEqual(["work · OPUS", "home · OPUS"]);
    expect(rows[0]!.selected).toBe(1);
  });

  it("falls back to the default model when an engine lists no options, and drops a provider with nothing", () => {
    const rows = providerDefaults([engine("api", "openai", [], "gpt-5"), engine("empty", "grok", [], "")], {});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.options).toEqual([{ instanceId: "api", model: "gpt-5", label: "gpt-5" }]);
  });
});

describe("defaultsPayload", () => {
  it("keeps a saved effort for an unchanged choice and defaults for providers not ready here", () => {
    const saved = {
      claudeAgent: { instanceId: "claude", model: "opus", effort: "high" },
      codex: { instanceId: "codex", model: "gpt" },
    };
    const rows = providerDefaults([engine("claude", "claudeAgent", ["opus", "sonnet"])], saved);
    expect(defaultsPayload(rows, saved)).toEqual(saved);
    expect(defaultsChanged(defaultsPayload(rows, saved), saved)).toBe(false);
    const switched = defaultsPayload([{ ...rows[0]!, selected: 1 }], saved);
    expect(switched.claudeAgent).toEqual({ instanceId: "claude", model: "sonnet" });
    expect(defaultsChanged(switched, saved)).toBe(true);
  });
});

describe("parsePlan", () => {
  it("accepts the plan and drops malformed bots", () => {
    const plan = parsePlan({
      defaults: {},
      bots: [
        { botId: "b1", name: "Scout", intent: null, resolved: null, via: "none" },
        { botId: "b2", name: "Odd", via: "somewhere" },
        null,
      ],
    });
    expect(plan?.bots.map((bot) => bot.botId)).toEqual(["b1"]);
  });

  it("rejects anything that is not a plan", () => {
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan({ bots: [] })).toBeNull();
    expect(parsePlan({ defaults: {}, bots: {} })).toBeNull();
  });
});
