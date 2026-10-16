import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

let local: ReturnType<typeof memoryStorage>;

// The module keeps a per-session choice, so each case loads a fresh copy over the same storage, as a relaunch would.
async function fresh() {
  vi.resetModules();
  return import("./interface-mode");
}

beforeEach(() => {
  local = memoryStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("interface mode", () => {
  it("is Advanced on a fresh install", async () => {
    const { readAdvancedMode, settleAdvancedModeDefault } = await fresh();
    expect(readAdvancedMode()).toBe(true);
    settleAdvancedModeDefault();
    expect((await fresh()).readAdvancedMode()).toBe(true);
  });

  it("defaults an existing install to Advanced so an update hides nothing", async () => {
    local.setItem("omb-skin", "lagoon");
    const { readAdvancedMode, settleAdvancedModeDefault, ADVANCED_MODE_KEY } = await fresh();
    expect(readAdvancedMode()).toBe(true);
    settleAdvancedModeDefault();
    expect(local.getItem(ADVANCED_MODE_KEY)).toBe("1");
  });

  it("ignores a stored Simple choice", async () => {
    local.setItem("omb-skin", "midnight");
    (await fresh()).setAdvancedMode(false);
    expect((await fresh()).readAdvancedMode()).toBe(true);
  });

  it("still switches for the session when storage throws", async () => {
    const { setAdvancedMode, readAdvancedMode } = await fresh();
    local.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    setAdvancedMode(true);
    expect(readAdvancedMode()).toBe(true);
  });

  it("stays Advanced when storage cannot be read at all", async () => {
    local.getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    const { readAdvancedMode, settleAdvancedModeDefault } = await fresh();
    expect(() => settleAdvancedModeDefault()).not.toThrow();
    expect(readAdvancedMode()).toBe(true);
  });
});
