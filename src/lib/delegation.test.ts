import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { delegatedRequestIds, delegationBrief, delegationSegment, delegationStatus, failedRequestIds, isDelegatedThread, isDelegationChip, resultShownInBlock } from "./delegation";

const at = 1;
const line = (id: string, extra: Partial<Message> = {}): Message => ({ id, at, role: "bot", kind: "text", text: id, ...extra });
const sent = (id: string, botId = "designer"): Message => line(`sent-${id}`, {
  kind: "activity", tool: { name: "Sent to Designer", ok: true }, roomRequest: { id, phase: "sent" },
  threadRef: { botId, threadId: "t-designer", title: "@Heroes · work" },
});

describe("delegation", () => {
  it("treats only a thread another bot opened as delegated", () => {
    expect(isDelegatedThread({ openedBy: { botId: "heroes", name: "Heroes", at } }, "designer")).toBe(true);
    expect(isDelegatedThread({ openedBy: { botId: "designer", name: "Designer", at } }, "designer")).toBe(false);
    expect(isDelegatedThread({}, "designer")).toBe(false);
  });

  it("recognises a sent chip toward another bot and hides that handoff's succeeded result", () => {
    expect(isDelegationChip(sent("r1"), "heroes")).toBe(true);
    expect(isDelegationChip(sent("r1", "heroes"), "heroes")).toBe(false);
    const ids = delegatedRequestIds([sent("r1"), line("reply")], "heroes");
    expect([...ids]).toEqual(["r1"]);
    const result = (ok: boolean) => line("result", { kind: "activity", tool: { name: "Designer replied", ok }, roomRequest: { id: "r1", phase: "result" } });
    expect(resultShownInBlock(result(true), ids)).toBe(true);
    expect(resultShownInBlock(result(false), ids)).toBe(false);
    expect([...failedRequestIds([result(false)])]).toEqual(["r1"]);
  });

  it("slices one handoff out of a thread the same opener keeps reusing", () => {
    const thread = [
      line("old", { roomRequest: { id: "r0", phase: "request" } }),
      line("old-reply"),
      line("ask", { text: "@Designer Design the home page", roomRequest: { id: "r1", phase: "request" } }),
      line("tool", { kind: "activity", tool: { name: "Edit", ok: true } }),
      line("reply", { turnTerminal: true, turnSucceeded: true }),
      line("next", { roomRequest: { id: "r2", phase: "request" } }),
    ];
    const segment = delegationSegment(thread, "r1");
    expect(segment.map((message) => message.id)).toEqual(["ask", "tool", "reply"]);
    expect(delegationSegment(thread, "missing")).toEqual([]);
    expect(delegationBrief(segment[0], "Designer")).toBe("Design the home page");
  });

  it("derives the block's status", () => {
    const started = [line("ask"), line("tool", { kind: "activity", tool: { name: "Edit" } })];
    const base = { working: false, pendingApproval: false, failed: false };
    expect(delegationStatus([], base)).toBe("queued");
    expect(delegationStatus(started, base)).toBe("working");
    expect(delegationStatus(started, { ...base, pendingApproval: true })).toBe("approval");
    expect(delegationStatus([...started, line("done", { turnTerminal: true, turnSucceeded: true })], base)).toBe("done");
    expect(delegationStatus([...started, line("done", { turnTerminal: true, turnSucceeded: false })], base)).toBe("failed");
    expect(delegationStatus([], { ...base, failed: true })).toBe("failed");
  });
});
