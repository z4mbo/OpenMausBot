import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import { createQuotaActivityProof, httpQuotaRefusal, providerQuotaRefusal } from "./quota-refusal.ts";
import { createQuotaStartGate, InitialQuotaRefusalError } from "./quota-start.ts";

const base = { eventId: "event", provider: "fixture", providerInstanceId: "primary", threadId: "thread", turnId: "turn", createdAt: "2026-10-19T00:00:00Z" };
const completed = (): Extract<RuntimeEvent, { type: "turn.completed" }> => ({ ...base, type: "turn.completed", ok: false,
  refusal: { kind: "quota_exhausted", scope: "account", retry: "safe_initial_refusal" } });

describe("provider quota proof", () => {
  it("accepts structured exhaustion and ignores billing, auth, ordinary rate limits and text", () => {
    expect(httpQuotaRefusal(429, { error: { code: "usage_limit_reached" } })).toEqual({ kind: "quota_exhausted", scope: "account" });
    expect(providerQuotaRefusal({ code: -32000, data: { code: "quota_exceeded" } })).toEqual({ kind: "quota_exhausted", scope: "account" });
    for (const status of [401, 403, 402, 500, 200]) expect(httpQuotaRefusal(status, { error: { code: "quota_exceeded" } })).toBeNull();
    for (const code of ["insufficient_quota", "insufficient_funds", "rate_limit_exceeded", "invalid_api_key", "billing_hard_limit_reached"]) expect(httpQuotaRefusal(429, { error: { code, message: "usage limit reached" } })).toBeNull();
    expect(providerQuotaRefusal({ message: "quota_exceeded" })).toBeNull();
  });

  it.each([
    { ...base, type: "content.delta", streamKind: "assistant_text", delta: "partial" },
    { ...base, type: "content.delta", streamKind: "reasoning_text", delta: "thinking" },
    { ...base, type: "item.started", itemType: "tool", title: "write" },
    { ...base, type: "item.completed", itemType: "tool", ok: false },
    { ...base, type: "request.opened", requestType: "permission", tool: "shell", summary: "ask" },
  ] satisfies RuntimeEvent[])("keeps prior $type work manual", event => {
    const proof = createQuotaActivityProof();
    proof.note(event);
    expect(proof.refusal({ kind: "quota_exhausted", scope: "account" }, true).retry).toBe("manual");
  });

  it("requires confirmed quiescence and does not mistake synthetic errors for work", () => {
    const proof = createQuotaActivityProof();
    proof.note({ ...base, type: "item.completed", itemType: "assistant_text", synthetic: true, text: "usage limit" });
    expect(proof.refusal({ kind: "quota_exhausted", scope: "account" }, false).retry).toBe("manual");
    expect(proof.refusal({ kind: "quota_exhausted", scope: "account" }, true).retry).toBe("safe_initial_refusal");
  });
});

describe("initial quota dispatch gate", () => {
  it("consumes one initial typed refusal before subscribers settle the request", async () => {
    const gate = createQuotaStartGate();
    const wait = gate.open("thread", "generation", "primary");
    const sending = wait(Promise.resolve({ turnId: "turn" }));
    expect(gate.event({ ...base, type: "turn.started" })).toBe(false);
    expect(gate.event(completed())).toBe(true);
    expect(gate.event(completed())).toBe(true);
    await expect(sending).rejects.toBeInstanceOf(InitialQuotaRefusalError);
  });

  it("publishes an unsafe completion after real output and does not retry", async () => {
    const gate = createQuotaStartGate();
    const wait = gate.open("thread", "generation", "primary");
    const sending = wait(Promise.resolve({ turnId: "turn" }));
    gate.event({ ...base, type: "turn.started" });
    gate.event({ ...base, type: "content.delta", streamKind: "assistant_text", delta: "partial" });
    expect(gate.event(completed())).toBe(false);
    await expect(sending).resolves.toEqual({ turnId: "turn" });
  });

  it("Stop releases the exact pending generation and cannot consume its completion", async () => {
    const gate = createQuotaStartGate();
    const wait = gate.open("thread", "generation", "primary");
    const sending = wait(Promise.resolve({ turnId: "turn" }));
    gate.cancel("thread", "generation");
    expect(gate.event(completed())).toBe(false);
    await expect(sending).resolves.toEqual({ turnId: "turn" });
  });

  it("does not consume another provider or already-bound turn", async () => {
    const gate = createQuotaStartGate();
    const wait = gate.open("thread", "generation", "primary");
    const sending = wait(Promise.resolve({ turnId: "turn" }));
    gate.event({ ...base, type: "turn.started" });
    expect(gate.event({ ...completed(), eventId: "foreign", providerInstanceId: "foreign" })).toBe(false);
    expect(gate.event({ ...completed(), eventId: "old", turnId: "old" })).toBe(false);
    gate.cancel("thread", "generation");
    await sending;
  });

  it("does not bind a stale completion before the new turn starts", async () => {
    const gate = createQuotaStartGate();
    const wait = gate.open("thread", "generation", "primary");
    const sending = wait(Promise.resolve({ turnId: "turn" }));
    expect(gate.event({ ...completed(), eventId: "stale", turnId: "old" })).toBe(false);
    gate.event({ ...base, type: "turn.started" });
    expect(gate.event(completed())).toBe(true);
    await expect(sending).rejects.toBeInstanceOf(InitialQuotaRefusalError);
  });

  it("handles a synchronous initial refusal before the dispatch promise can be wrapped", async () => {
    const gate = createQuotaStartGate();
    const wait = gate.open("thread", "generation", "primary");
    gate.event({ ...base, type: "turn.started" });
    expect(gate.event(completed())).toBe(true);
    await Promise.resolve();
    await expect(wait(Promise.resolve({ turnId: "turn" }))).rejects.toBeInstanceOf(InitialQuotaRefusalError);
  });
});
