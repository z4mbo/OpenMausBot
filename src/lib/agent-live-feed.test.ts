import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../../shared/runtime-events";
import type { Message } from "@/state/store";
import { LIVE_STEPS_KEPT, pickFeed, reduceLiveFeed, stepsFromMessages, type LiveFeed } from "./agent-live-feed";

let serial = 0;
function event(body: Record<string, unknown>): RuntimeEvent {
  serial += 1;
  return { eventId: `e${serial}`, provider: "claude", threadId: "t1", createdAt: new Date(1_000 + serial).toISOString(), ...body } as RuntimeEvent;
}

function play(...events: RuntimeEvent[]): LiveFeed {
  return events.reduce<LiveFeed | undefined>((feed, next) => reduceLiveFeed(feed, next), undefined)!;
}

describe("reduceLiveFeed", () => {
  it("streams the thought, then a running tool, then its result", () => {
    let feed = play(event({ type: "turn.started" }), event({ type: "content.delta", streamKind: "reasoning_text", delta: "Look at " }),
      event({ type: "content.delta", streamKind: "reasoning_text", delta: "the repo" }));
    expect(feed).toMatchObject({ active: true, phase: "thinking", thought: "Look at the repo" });

    feed = reduceLiveFeed(feed, event({ type: "item.started", itemType: "tool", itemId: "a", title: "Bash", summary: "ls  -la\n src" }));
    expect(feed.phase).toBe("tool");
    expect(feed.steps[0]).toMatchObject({ id: "a", name: "Bash", detail: "ls -la src" });
    expect(feed.steps[0].ok).toBeUndefined();

    feed = reduceLiveFeed(feed, event({ type: "item.completed", itemType: "tool", itemId: "a", ok: false, output: "permission denied" }));
    expect(feed.phase).toBe("thinking");
    expect(feed.steps[0]).toMatchObject({ ok: false, output: "permission denied" });
  });

  it("puts the newest step first and keeps only the latest few", () => {
    const starts = Array.from({ length: LIVE_STEPS_KEPT + 3 }, (_, index) => event({ type: "item.started", itemType: "tool", itemId: `s${index}`, title: "Read" }));
    const feed = play(event({ type: "turn.started" }), ...starts);
    expect(feed.steps).toHaveLength(LIVE_STEPS_KEPT);
    expect(feed.steps[0].id).toBe(`s${LIVE_STEPS_KEPT + 2}`);
  });

  it("asks for approval, resumes, and settles unfinished steps when the turn ends", () => {
    let feed = play(event({ type: "turn.started" }), event({ type: "item.started", itemType: "tool", itemId: "x", title: "Write" }),
      event({ type: "request.opened", requestType: "permission", tool: "Write", summary: "Write notes.md" }));
    expect(feed).toMatchObject({ phase: "approval", approval: "Write notes.md" });
    feed = reduceLiveFeed(feed, event({ type: "request.resolved", behavior: "allow", source: "user" }));
    expect(feed.phase).toBe("thinking");
    feed = reduceLiveFeed(feed, event({ type: "turn.completed", ok: true }));
    expect(feed).toMatchObject({ active: false, phase: "idle" });
    expect(feed.steps[0].ok).toBe(true);
  });

  it("starts each turn with a fresh thought and ignores events it does not show", () => {
    const first = play(event({ type: "turn.started" }), event({ type: "content.delta", streamKind: "reasoning_text", delta: "old" }), event({ type: "turn.completed", ok: true }));
    expect(reduceLiveFeed(first, event({ type: "thread.token-usage.updated", input: 1, output: 1 }))).toBe(first);
    expect(reduceLiveFeed(first, event({ type: "turn.started" })).thought).toBe("");
  });
});

describe("tool output", () => {
  it("shows the text of an MCP content array instead of its JSON", () => {
    const feed = play(event({ type: "item.started", itemType: "tool", itemId: "m", title: "coordinate_bots" }),
      event({ type: "item.completed", itemType: "tool", itemId: "m", ok: true, output: JSON.stringify([{ type: "text", text: "Sent to Dev" }]) }));
    expect(feed.steps[0].output).toBe("Sent to Dev");
  });
});

describe("pickFeed", () => {
  it("prefers a running turn over a newer finished one", () => {
    const running = { threadId: "a", active: true, phase: "tool", thought: "", steps: [], updatedAt: 1 } as LiveFeed;
    const done = { threadId: "b", active: false, phase: "idle", thought: "", steps: [], updatedAt: 9 } as LiveFeed;
    expect(pickFeed([done, undefined, running])?.threadId).toBe("a");
    expect(pickFeed([done, { ...done, threadId: "c", updatedAt: 3 }])?.threadId).toBe("b");
  });
});

describe("stepsFromMessages", () => {
  it("lists tool steps newest first and skips everything else", () => {
    const messages = [
      { id: "1", role: "bot", kind: "activity", at: 1, tool: { name: "Bash", ok: true, summary: "npm test", output: "12 passed" } },
      { id: "2", role: "bot", kind: "text", at: 2, text: "done" },
      { id: "3", role: "bot", kind: "activity", at: 3, tool: { name: "Read", input: "src/app.ts" } },
    ] as Message[];
    expect(stepsFromMessages(messages).map((step) => [step.id, step.detail, step.ok])).toEqual([["3", "src/app.ts", undefined], ["1", "npm test", true]]);
  });
});
