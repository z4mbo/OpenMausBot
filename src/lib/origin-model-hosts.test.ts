import { describe, expect, it } from "vitest";
import { modelPairKey } from "../../shared/model-selection";
import { sharedSelection, sharedSourceModels, sharedSourceReady, type ModelHostSource } from "./origin-model-hosts";

const source = (patch: Partial<ModelHostSource> = {}): ModelHostSource => ({ sourceId: "source-a", hostId: "host-a", ownerUserId: "alice", ownerName: "Alice", computerName: "Mac", provider: "claudeAgent", label: "Claude", billing: "subscription", models: ["same-model", "other-model"], heartbeatAt: 1_000, expiresAt: 60_000, capacity: 1, ...patch });

describe("shared model source choices", () => {
  it("distinguishes the same model on two computers and clears local-only effort and variant", () => {
    const first = sharedSelection(source(), "same-model");
    const second = sharedSelection(source({ hostId: "host-b", sourceId: "source-b" }), "same-model");
    expect(modelPairKey(first)).not.toBe(modelPairKey(second));
    expect(first).toEqual({ instanceId: "origin-remote", model: "same-model", source: { hostId: "host-a", sourceId: "source-a" } });
    expect(sharedSourceModels(source(), [second], false, 2_000)).toEqual(["same-model", "other-model"]);
    expect(sharedSourceModels(source(), [first], false, 2_000)).toEqual(["other-model"]);
  });

  it("requires an exact paid opt-in for metered backup sources and never admits unverified or expired sources", () => {
    expect(sharedSourceModels(source({ billing: "metered" }), [], false, 2_000)).toEqual([]);
    expect(sharedSourceModels(source({ billing: "metered" }), [], true, 2_000)).toEqual(["same-model", "other-model"]);
    expect(sharedSourceModels(source({ billing: "unknown" }), [], true, 2_000)).toEqual([]);
    expect(sharedSourceModels(source({ expiresAt: 2_000 }), [], true, 2_000)).toEqual([]);
    expect(sharedSourceReady(source(), 60_000)).toBe(false);
  });
});
