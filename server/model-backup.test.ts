import { describe, expect, it, vi } from "vitest";
import { modelPairKey } from "../shared/model-selection.ts";
import type { ModelSelection } from "./contracts.ts";
import { chooseModelBackup, modelAccountKey } from "./model-backup.ts";

const local = (instanceId: string, model = "one"): ModelSelection => ({ instanceId, model });
const remote = (sourceId: string, model = "one", hostId = "host"): ModelSelection => ({ instanceId: "origin-remote", model, source: { hostId, sourceId } });
const choose = <T>(chain: ModelSelection[], prepare: (selection: ModelSelection) => Promise<T | null>, extra = {}) => chooseModelBackup({ chain, visited: new Set<string>(), blockedAccounts: new Set<string>(), current: () => true, prepare, ...extra });

describe("local and teammate ranked backups", () => {
  it("checks local, teammate and API candidates in order without racing paid preparation", async () => {
    const chain = [local("mine-claude"), remote("his-claude"), local("grok-api"), remote("another-api")];
    const prepare = vi.fn(async selection => selection.source ? { route: "host" } : null);
    expect(await choose(chain, prepare)).toEqual({ selection: chain[1], value: { route: "host" } });
    expect(prepare.mock.calls.map(call => call[0])).toEqual(chain.slice(0, 2));
  });

  it("deduplicates exact source/model pairs and blocks only the exhausted account", async () => {
    const chain = [remote("exhausted", "two"), remote("other"), remote("other"), remote("other", "two"), local("last")];
    const prepare = vi.fn(async selection => selection.model === "two" ? "ready" : null);
    expect(await choose(chain, prepare, { blockedAccounts: new Set([modelAccountKey(remote("exhausted"))]) })).toEqual({ selection: chain[3], value: "ready" });
    expect(prepare.mock.calls.map(call => call[0])).toEqual([chain[1], chain[3]]);
    expect(modelAccountKey(local("origin-remote"))).not.toBe(modelAccountKey(remote("exhausted")));
    expect(modelAccountKey(remote("same", "one", "hostA"))).not.toBe(modelAccountKey(remote("same", "one", "hostB")));
  });

  it("skips visited pairs, rejected policy and unknown availability within five configured entries", async () => {
    const chain = [local("used"), remote("paid-no-consent"), local("offline"), local("missing-price"), local("unknown"), local("sixth")];
    const prepare = vi.fn(async selection => {
      if (selection.instanceId === "offline") throw new Error("unavailable");
      return selection.instanceId === "sixth" ? "ready" : null;
    });
    expect(await choose(chain, prepare, { visited: new Set([modelPairKey(chain[0]!)]) })).toBeNull();
    expect(prepare).toHaveBeenCalledTimes(4);
    expect(prepare.mock.calls.some(call => call[0].instanceId === "sixth")).toBe(false);
  });

  it("stops before or after an awaited probe when ownership or Stop changes", async () => {
    const before = vi.fn(async () => "ready");
    expect(await choose([local("first")], before, { current: () => false })).toBeNull();
    expect(before).not.toHaveBeenCalled();
    let current = true;
    const prepare = vi.fn(async () => { current = false; return "ready"; });
    expect(await choose([remote("first"), local("second")], prepare, { current: () => current })).toBeNull();
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("bounds an unavailable probe and ignores its eventual result", async () => {
    let release!: (value: string) => void;
    const pending = new Promise<string>(resolve => { release = resolve; });
    const prepare = vi.fn(async selection => selection.instanceId === "hung" ? pending : "later");
    expect(await choose([local("hung"), remote("next")], prepare, { timeoutMs: 10 })).toEqual({ selection: remote("next"), value: "later" });
    release("too late"); await Promise.resolve();
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});
