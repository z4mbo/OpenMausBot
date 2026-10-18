import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelCatalog, ProviderInstance, ProviderSnapshot } from "../contracts.ts";
import { makeFakeDriver } from "../testing/fake-driver.ts";
import { ProviderRegistry } from "./registry.ts";

function probe(snapshot: ProviderInstance["snapshot"], kind = "probe") {
  const fake = makeFakeDriver({ kind }), create = fake.driver.create.bind(fake.driver);
  fake.driver.create = async input => {
    const instance = await create(input);
    instance.snapshot = snapshot;
    return instance;
  };
  return fake;
}
function observe<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  void promise.then(value => Object.assign(state, { settled: true, value }), error => Object.assign(state, { settled: true, error }));
  return state;
}
const available: ProviderSnapshot = { state: "available", version: "synthetic" };
afterEach(() => { vi.useRealTimers(); });

describe("provider status probe deadline", () => {
  it("finishes describe after one minute when a sibling status probe never settles", async () => {
    vi.useFakeTimers();
    const stuck = probe(() => new Promise(() => {})), fine = makeFakeDriver({ kind: "fine" });
    const registry = new ProviderRegistry([stuck.driver, fine.driver], { npmAvailable: () => false });
    await registry.load({ stuck: { driver: "probe" }, fine: { driver: "fine" } });
    const read = observe(registry.describe());
    await vi.advanceTimersByTimeAsync(59_999);
    expect(read.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(read.settled).toBe(true);
    expect(read.value?.map(entry => [entry.instanceId, entry.snapshot.state])).toEqual([["stuck", "unavailable"], ["fine", "available"]]);
    expect(read.value?.[0]?.snapshot.reason).toContain("within a minute");
    expect(registry.lastSnapshot("stuck")?.state).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds direct get().snapshot calls used outside describe", async () => {
    vi.useFakeTimers();
    const fake = probe(() => new Promise(() => {}));
    const registry = new ProviderRegistry([fake.driver]);
    await registry.load({ a: { driver: "probe" } });
    const read = observe(registry.get("a")!.snapshot());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read.settled).toBe(true);
    expect(read.error).toBeInstanceOf(Error);
    expect((read.error as Error).message).toContain("within a minute");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)("ignores a late %s after timing out and permits the next healthy probe", async completion => {
    vi.useFakeTimers();
    let resolve!: (value: ProviderSnapshot) => void, reject!: (error: Error) => void, calls = 0;
    const pending = new Promise<ProviderSnapshot>((yes, no) => { resolve = yes; reject = no; });
    const fake = probe(() => ++calls === 1 ? pending : Promise.resolve(available));
    const registry = new ProviderRegistry([fake.driver], { npmAvailable: () => false });
    await registry.load({ a: { driver: "probe" } });
    const read = observe(registry.describe());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read.settled).toBe(true);
    if (completion === "resolve") resolve(available); else reject(new Error("late synthetic failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(registry.lastSnapshot("a")?.state).toBe("unavailable");
    expect((await registry.describe())[0]?.snapshot).toEqual(available);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject", "throw"] as const)("clears the deadline after an immediate %s", async completion => {
    vi.useFakeTimers();
    const error = new Error("synthetic provider failure");
    const fake = probe(() => {
      if (completion === "throw") throw error;
      return completion === "reject" ? Promise.reject(error) : Promise.resolve(available);
    });
    const registry = new ProviderRegistry([fake.driver]);
    await registry.load({ a: { driver: "probe" } });
    const read = observe(Promise.resolve().then(() => registry.get("a")!.snapshot()));
    await vi.advanceTimersByTimeAsync(0);
    expect(read.settled).toBe(true);
    if (completion === "resolve") expect(read.value).toEqual(available); else expect(read.error).toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves live getters, instance identity, receiver binding and the snapshot seen by decorators", async () => {
    vi.useFakeTimers();
    let models: ModelCatalog = { default: "first", options: [] };
    const fake = probe(function (this: ProviderInstance) {
      expect(this).toBe(fake.created.get("a")!.instance);
      return Promise.resolve(available);
    });
    const create = fake.driver.create.bind(fake.driver);
    fake.driver.create = async input => {
      const instance = await create(input);
      Object.defineProperty(instance, "models", { get: () => models, configurable: true });
      return instance;
    };
    const registry = new ProviderRegistry([fake.driver], { npmAvailable: () => false });
    let decorated: ProviderInstance | undefined;
    await registry.load({ a: { driver: "probe" } }, instance => {
      decorated = instance;
      return instance;
    });
    expect(registry.get("a")).toBe(decorated);
    expect(registry.get("a")).toBe(fake.created.get("a")!.instance);
    models = { default: "second", options: [] };
    expect((await registry.describe())[0]?.models).toBe(models);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds snapshots captured by a decorator before publishing the instance", async () => {
    vi.useFakeTimers();
    const fake = probe(() => new Promise(() => {}));
    const registry = new ProviderRegistry([fake.driver]);
    let decoratedRead!: ProviderInstance["snapshot"];
    await registry.load({ a: { driver: "probe" } }, instance => {
      decoratedRead = instance.snapshot.bind(instance);
      return { ...instance, snapshot: async () => ({ ...await decoratedRead(), billing: "metered" }) };
    });
    const read = observe(registry.get("a")!.snapshot());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read.settled).toBe(true);
    expect(read.error).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
