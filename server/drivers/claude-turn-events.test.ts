import { expect, it, vi } from "vitest";
import type { RuntimeEvent, RuntimeEventListener, SendTurnInput } from "../contracts.ts";
import type { killCliTree } from "../procs.ts";
import { claudeTurnEvents } from "./claude-turn-events.ts";

const base = { eventId: "event", provider: "claudeAgent", threadId: "thread", turnId: "turn", createdAt: "2026-10-20T00:00:00Z" };
const evidence = { kind: "quota_exhausted", scope: "account" } as const;
const input: SendTurnInput = { threadId: "thread", text: "hello", startupRecovery: true };
const loginMessage = "Not logged in · Please run /login";

function fixture() {
  const events: RuntimeEvent[] = [];
  const listeners = new Set<RuntimeEventListener>([event => events.push(event)]);
  const sessions = new Map([["thread", { child: {} as Parameters<typeof killCliTree>[0], closed: Promise.resolve() }]]);
  const stop = vi.fn<typeof killCliTree>(async () => { sessions.delete("thread"); return true; });
  return { ...claudeTurnEvents(listeners, sessions, { has: () => false }, stop), events, stop };
}

it("clears quota bookkeeping when auth recovery consumes a retired initial refusal", async () => {
  const f = fixture();
  const sent = f.authRecovery.send(input, async () => {
    f.emit({ ...base, type: "turn.started" });
    f.authRecovery.frame("thread", { type: "assistant", error: "authentication_failed", is_api_error_message: true,
      message: { model: "<synthetic>", content: [{ type: "text", text: loginMessage }] } });
    f.emit({ ...base, type: "runtime.error", setup: true, message: loginMessage });
    f.authRecovery.frame("thread", { type: "result", is_error: true });
    f.emit({ ...base, type: "turn.completed", ok: false, stopReason: "auth_required", cost: null });
    return { turnId: "turn" };
  });
  await expect(sent).rejects.toMatchObject({ name: "TurnAuthenticationRefusedError", message: loginMessage });
  expect(f.events.map(event => event.type)).toEqual(["turn.started"]);
  expect(f.quotaProofs.refusal("thread", evidence, true)).toBeUndefined();
  expect(f.stop).toHaveBeenCalledOnce();
});

it("preserves one safe quota completion through recoverable ACK handling", async () => {
  const f = fixture();
  await f.authRecovery.send(input, async () => {
    f.emit({ ...base, type: "turn.started" });
    f.authRecovery.frame("thread", { type: "result", is_error: true });
    f.emit({ ...base, type: "runtime.error", message: "usage limit" });
    f.emit({ ...base, type: "turn.completed", ok: false, refusal: f.quotaProofs.refusal("thread", evidence, true) });
    return { turnId: "turn" };
  });
  expect(f.events.filter(event => event.type === "turn.completed")).toEqual([expect.objectContaining({ refusal: { ...evidence, retry: "safe_initial_refusal" } })]);
  expect(f.quotaProofs.refusal("thread", evidence, true)).toBeUndefined();
  expect(f.stop).not.toHaveBeenCalled();
});

it.each([
  { ...base, type: "content.delta", streamKind: "reasoning_text", delta: "thinking" },
  { ...base, type: "item.started", itemType: "tool", title: "Write" },
] satisfies RuntimeEvent[])("keeps quota after $type activity manual through auth recovery", async activity => {
  const f = fixture();
  await f.authRecovery.send(input, async () => {
    f.emit({ ...base, type: "turn.started" });
    f.emit(activity);
    f.emit({ ...base, type: "turn.completed", ok: false, refusal: f.quotaProofs.refusal("thread", evidence, true) });
    return { turnId: "turn" };
  });
  expect(f.events.filter(event => event.type === "turn.completed")).toEqual([expect.objectContaining({ refusal: { ...evidence, retry: "manual" } })]);
});
