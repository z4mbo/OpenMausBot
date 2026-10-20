import { describe, expect, it, vi } from "vitest";
import type { ProviderInstance } from "./contracts.ts";
import { chooseQuotaFallback, modelPairKey } from "./quota-fallback.ts";

const engine = (instanceId: string): ProviderInstance => ({ instanceId, enabled: true, driverKind: "fixture",
  models: { default: "one", options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] },
  snapshot: async () => ({ state: "available", authenticated: true, billing: "subscription" }),
} as ProviderInstance);

describe("ranked quota candidates", () => {
  it("keeps exact model order, including another model on the same instance", async () => {
    const primary = engine("primary"), backup = engine("backup");
    const validate = vi.fn(() => undefined);
    const found = await chooseQuotaFallback({ chain: [{ instanceId: "primary", model: "one" }, { instanceId: "primary", model: "two" }, { instanceId: "backup", model: "one" }],
      visited: new Set([modelPairKey({ instanceId: "primary", model: "one" })]), blockedInstances: new Set(), engine: id => id === "primary" ? primary : backup, current: () => true, validate });
    expect(found?.selection).toEqual({ instanceId: "primary", model: "two" });
  });

  it("skips account-wide exhaustion, duplicates, rejected policy and removed models", async () => {
    const entries = new Map(["primary", "paid", "last"].map(id => [id, engine(id)]));
    const found = await chooseQuotaFallback({ chain: [{ instanceId: "primary", model: "two" }, { instanceId: "paid", model: "one" }, { instanceId: "paid", model: "one" }, { instanceId: "last", model: "missing" }, { instanceId: "last", model: "two" }],
      visited: new Set(), blockedInstances: new Set(["primary"]), engine: id => entries.get(id), current: () => true,
      validate: selection => selection.instanceId === "paid" ? "Paid fallback is disabled" : undefined });
    expect(found?.selection).toEqual({ instanceId: "last", model: "two" });
  });

  it("cannot switch after ownership changes during the availability probe", async () => {
    const candidate = engine("backup");
    let current = true;
    candidate.snapshot = async () => { current = false; return { state: "available", authenticated: true }; };
    const validate = vi.fn(() => undefined);
    expect(await chooseQuotaFallback({ chain: [{ instanceId: "backup", model: "one" }], visited: new Set(), blockedInstances: new Set(), engine: () => candidate, current: () => current, validate })).toBeNull();
    expect(validate).not.toHaveBeenCalled();
  });
});
