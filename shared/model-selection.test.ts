import { describe, expect, it } from "vitest";
import { modelPairKey } from "./model-selection.ts";
import { sameModelSelection, threadsOnOwnModel } from "./thread-model.ts";
import type { ModelSelection } from "./wire.ts";

describe("shared account identity", () => {
  const one: ModelSelection = { instanceId: "origin-remote", model: "same-model", source: { hostId: "one", sourceId: "account" } };
  const two: ModelSelection = { ...one, source: { hostId: "two", sourceId: "account" } };
  const three: ModelSelection = { ...one, source: { hostId: "one", sourceId: "other-account" } };

  it("keeps independent hosts and accounts in fallback order and history", () => {
    expect(new Set([one, two, three].map(modelPairKey)).size).toBe(3);
    expect(modelPairKey(one)).toBe(modelPairKey(structuredClone(one)));
    expect(sameModelSelection(one, two)).toBe(false); expect(sameModelSelection(one, three)).toBe(false);
  });

  it("keeps a thread's explicit teammate account distinct from its bot's account", () => {
    const tasks = [{ id: "same", modelSelection: structuredClone(one), followsBotModel: false }, { id: "other", modelSelection: two, followsBotModel: false }];
    expect(threadsOnOwnModel(one, tasks).map(task => task.id)).toEqual(["other"]);
    expect(sameModelSelection(one, { ...one, effort: "high" })).toBe(false);
  });

  it("retains the local fallback identity format for existing saved visits", () => {
    expect(modelPairKey({ instanceId: "claude", model: "local" })).toBe('["claude","local"]');
    expect(sameModelSelection({ instanceId: "claude", model: "local" }, { instanceId: "claude", model: "local" })).toBe(true);
  });
});
