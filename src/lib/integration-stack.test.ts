import { describe, expect, it } from "vitest";
import type { IntegrationStatus } from "../../shared/integration-keys";
import { STACK, providerSource, stackProgress, stepState } from "./integration-stack";

const status = (id: string, patch: Partial<IntegrationStatus> = {}): IntegrationStatus => ({
  id, label: id, help: `https://${id}.test/keys`, configured: false, source: null, shared: null, shares: [],
  fields: [{ name: "key", label: "Key", secret: true, optional: false, set: false }], ...patch,
});
const step = (id: string) => STACK.find((candidate) => candidate.id === id)!;

describe("connect your stack", () => {
  it("completes a step when any of its providers is connected, by anyone", () => {
    expect(stepState(step("social"), [status("x"), status("tiktok", { configured: true, source: "shared" })], null)).toBe("done");
    expect(stepState(step("studio"), [status("fal")], null)).toBe("todo");
  });

  it("marks a step partial while a key is half filled in", () => {
    expect(stepState(step("studio"), [status("fal", { fields: [{ name: "key", label: "Key", secret: true, optional: false, set: true }] })], null)).toBe("partial");
  });

  it("counts GitHub done only once it is shared with the workspace", () => {
    expect(stepState(step("github"), [], { connected: true, shared: false })).toBe("partial");
    expect(stepState(step("github"), [], { connected: true, shared: true })).toBe("done");
    expect(stackProgress([status("fal", { configured: true, source: "yours" })], { connected: true, shared: true })).toEqual({ done: 2, total: 3 });
  });

  it("names whose key a provider uses", () => {
    expect(providerSource(status("fal", { configured: true, source: "shared" }))).toBe("shared");
    expect(providerSource(status("fal"))).toBe("none");
  });
});
