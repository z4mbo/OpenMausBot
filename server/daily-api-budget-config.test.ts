import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR, engineLaunches, changedInstanceIds, ensureDirs, instanceConfigs, loadConfig, parseConfigPatch, parseStoredConfig, saveConfig } from "./config.ts";
import type { JsonValue } from "./schema.ts";

beforeEach(() => {
  ensureDirs();
  writeFileSync(join(DATA_DIR, "config.json"), "{}");
});

describe("daily model API budget configuration", () => {
  it("preserves zero as a paid-request block and persists the explicit reset zone", () => {
    const dailyApiBudget = { limitUsd: 0, timeZone: "Europe/Rome" };
    expect(parseConfigPatch({ dailyApiBudget }).dailyApiBudget).toEqual(dailyApiBudget);
    expect(parseStoredConfig({ dailyApiBudget }).dailyApiBudget).toEqual(dailyApiBudget);
    saveConfig({ dailyApiBudget });
    expect(loadConfig().dailyApiBudget).toEqual(dailyApiBudget);
  });

  it("clears only the daily API policy while retaining unrelated monthly settings", () => {
    saveConfig({ dailyApiBudget: { limitUsd: 5, timeZone: "UTC" }, budgets: { monthlyUsd: 100 } });
    expect(parseConfigPatch({ dailyApiBudget: null })).toEqual({ dailyApiBudget: null });
    saveConfig({ dailyApiBudget: null });
    expect(loadConfig().dailyApiBudget).toBeUndefined();
    expect(JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"))).toMatchObject({ budgets: { monthlyUsd: 100 } });
  });

  it("does not reload providers when the accounting limit changes", () => {
    expect(changedInstanceIds(engineLaunches(instanceConfigs({}), {}),
      engineLaunches(instanceConfigs({ dailyApiBudget: { limitUsd: 3, timeZone: "UTC" } }), {}))).toEqual([]);
  });

  const invalidPolicies: Record<string, JsonValue>[] = [
    { limitUsd: -1, timeZone: "UTC" },
    { limitUsd: "5", timeZone: "UTC" },
    { limitUsd: 5, timeZone: "Not/A_Time_Zone" },
    { limitUsd: 5 },
    { limitUsd: 5, timeZone: "UTC", allowOverdraft: true },
  ];
  it.each(invalidPolicies)("rejects an invalid budget policy %j", dailyApiBudget => {
    expect(() => parseConfigPatch({ dailyApiBudget })).toThrow();
  });
});
