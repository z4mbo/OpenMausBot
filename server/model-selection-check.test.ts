import { describe, expect, it, vi } from "vitest";
import { createScopedModelSelectionChecker } from "./model-selection-check.ts";
import { defaultModelSelectionSchema, globalModelSelectionSchema, automaticRecoverySchema } from "./model-selection-config.ts";
import type { ModelSelection } from "./contracts.ts";

const local: ModelSelection = { instanceId: "claude", model: "synthetic" };
const remote: ModelSelection = { instanceId: "origin-remote", model: "synthetic", source: { hostId: "host1", sourceId: "account1" } };
const scope = { botId: "shared-agent", threadId: "shared-thread" };
const fixture = () => {
  const localCheck = vi.fn((selection: ModelSelection) => ({ ok: true as const, selection }));
  const remoteCheck = vi.fn(async () => {});
  return { localCheck, remoteCheck, check: createScopedModelSelectionChecker({ local: localCheck, remote: remoteCheck }) };
};

describe("scoped shared model selection", () => {
  it("never maps a hosted selection into a local runnable provider", async () => {
    const f = fixture();
    expect(await f.check(remote, undefined, false, scope)).toEqual({ ok: true, selection: remote });
    expect(f.remoteCheck).toHaveBeenCalledWith(scope, remote);
    expect(f.localCheck).not.toHaveBeenCalled();
    expect(await f.check(local)).toEqual({ ok: true, selection: local });
    expect(f.localCheck).toHaveBeenCalledOnce();
  });

  it("requires an authenticated bound agent scope even when catalog checks were not requested", async () => {
    const f = fixture();
    expect(await f.check(remote)).toMatchObject({ ok: false, status: 400 });
    expect(f.remoteCheck).not.toHaveBeenCalled();
  });

  it.each([
    { ...remote, source: undefined },
    { ...local, source: remote.source },
    { ...remote, source: { ...remote.source, sessionToken: "must not be accepted" } },
    { ...remote, source: { hostId: "host1", sourceId: "https://invalid-source" } },
    { ...remote, source: { hostId: "host1" } },
    { ...remote, instanceId: "another-proxy" },
  ])("rejects malformed or contradictory source identity %j", async selection => {
    const f = fixture();
    expect(await f.check(selection, undefined, true, scope)).toMatchObject({ ok: false, status: 400 });
    expect(f.remoteCheck).not.toHaveBeenCalled(); expect(f.localCheck).not.toHaveBeenCalled();
  });

  it("does not treat two owners' accounts as the same model while a turn is active", async () => {
    const f = fixture();
    const other = { ...remote, source: { hostId: "host2", sourceId: "account2" } };
    expect(await f.check(other, { selection: remote, busy: true }, true, scope)).toMatchObject({ ok: false, status: 409 });
    expect(f.remoteCheck).not.toHaveBeenCalled();
  });

  it.each(["offline", "revoked", "outside project", "model withdrawn"])("fails closed when the controller rejects %s", async reason => {
    const f = fixture();
    f.remoteCheck.mockRejectedValueOnce(Object.assign(new Error(reason), { status: 403 }));
    expect(await f.check(remote, undefined, false, scope)).toMatchObject({ ok: false, status: 403, error: reason });
    expect(f.localCheck).not.toHaveBeenCalled();
  });

  it("does not expose backend diagnostics when source verification has an unknown outcome", async () => {
    const f = fixture();
    f.remoteCheck.mockRejectedValueOnce(new Error("synthetic credential diagnostic"));
    const result = await f.check(remote, undefined, true, scope);
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(result)).not.toContain("credential diagnostic");
  });

  it("preserves source identity in persisted selections and rejects ungranted model controls", async () => {
    expect(defaultModelSelectionSchema.parse(remote)).toEqual(remote);
    expect(globalModelSelectionSchema.safeParse(remote).success).toBe(false);
    expect(automaticRecoverySchema.safeParse({ enabled: false, backup: remote }).success).toBe(false);
    const f = fixture();
    for (const extra of [{ effort: "high" }, { variant: "fast" }]) {
      expect(await f.check({ ...remote, ...extra }, undefined, true, scope)).toMatchObject({ ok: false, status: 400 });
    }
    expect(f.remoteCheck).not.toHaveBeenCalled();
  });
});
