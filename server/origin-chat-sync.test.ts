import { describe, expect, it, vi } from "vitest";
import { orderedSharedMessages } from "../shared/shared-chat-order.ts";
import { createThreadMirror, sharedStreamingPreview, type CloudRow, type ThreadSnapshot } from "./origin-thread-mirror.ts";
import type { Message, StoreChange } from "./store.ts";

const redact = (text: string) => text.replace(/sk-[A-Za-z0-9]+/g, "[redacted]");

function fixture() {
  const messages: Message[] = [];
  let listener!: (change: StoreChange) => void;
  let cursor = 0;
  const subscriptions: { afterSeq: unknown; update(value: unknown): void }[] = [];
  const writes: { name: string; args: Record<string, unknown> }[] = [];
  const task = { threadId: "local", title: "Chat" };
  const emit = (message: Message) => { messages.push(message); listener({ type: "message", threadId: "local", message }); };
  const mirror = createThreadMirror({
    store: {
      onChange: fn => { listener = fn; return () => undefined; }, messagesFor: () => messages,
      patchMessage: (_thread, id, patch) => {
        const index = messages.findIndex(message => message.id === id);
        messages[index] = { ...messages[index], ...patch };
        listener({ type: "message.patch", threadId: "local", message: messages[index] });
        return messages[index];
      },
      applyRemoteMessage: (_thread, row) => {
        const index = messages.findIndex(message => message.remote?.cloudId === row.remote.cloudId);
        const next = { id: `remote:${row.remote.cloudId}`, at: 1, ...row };
        if (index < 0) messages.push(next); else messages[index] = next;
        return next;
      },
      taskByThread: () => task as never, patchTask: vi.fn(), botByThread: () => ({ id: "bot" }) as never,
    },
    outbox: { enqueue: (name, args) => { writes.push({ name, args }); }, cursor: () => cursor, setCursor: (_thread, value) => { cursor = value; } },
    cloud: { mutation: vi.fn(), subscribe: (_name, args, update) => { subscriptions.push({ afterSeq: args.afterSeq, update }); return () => undefined; } },
    threads: () => ({ local: "cloud" }), runFor: () => "run", me: () => "ada", redact, kick: vi.fn(),
  });
  mirror.sync();
  const deliver = (rows: CloudRow[], more = false) => subscriptions.at(-1)!.update({ seq: 100, title: "Chat", archived: false, messages: rows, more, activeRun: null, queued: [] } satisfies ThreadSnapshot);
  return { mirror, messages, emit, deliver, subscriptions, writes };
}

const cloudRow = (id: string, seq: number, updSeq = seq): CloudRow => ({ _id: id, seq, updSeq, clientId: `m:${id}`, role: "bot", kind: "text", text: id, status: "final", createdAt: 1 });

describe("shared conversation convergence", () => {
  it("advances change cursors without refetching history and orders changed old rows by creation sequence", () => {
    const f = fixture();
    try {
      f.deliver([cloudRow("second", 2)], true);
      f.deliver([cloudRow("first", 1, 3)]);
      f.deliver([cloudRow("first", 1, 4)]);
      expect(f.subscriptions.map(row => row.afterSeq)).toEqual([0, 2, 3, 4]);
      expect(orderedSharedMessages(f.messages).map(message => message.text)).toEqual(["first", "second"]);
      expect(f.writes).toEqual([]);
    } finally { f.mirror.stop(); }
  });

  it("recognizes an own echo arriving before the local send row without publishing acknowledgment loops", () => {
    const f = fixture();
    try {
      f.mirror.expect("send:once");
      f.deliver([{ ...cloudRow("user", 1), clientId: "send:once", role: "user", authorUserId: "ada" }]);
      expect(f.messages).toEqual([]);
      f.emit({ id: "local-user", at: 1, role: "user", kind: "text", text: "Hello", sendId: "once" });
      expect(f.messages).toHaveLength(1);
      expect(f.messages[0].sharedMessage).toEqual({ cloudId: "user", seq: 1, updSeq: 1 });
      expect(f.writes.map(write => write.name)).toEqual(["agentRuns:appendMessage"]);
    } finally { f.mirror.stop(); }
  });

  it("uses one cloud row for streaming and completion and keeps separate assistant items distinct", () => {
    const f = fixture();
    const delta = (text: string) => f.mirror.delta({ eventId: text, provider: "claudeAgent", threadId: "local", turnId: "turn", createdAt: "", type: "content.delta", streamKind: "assistant_text", delta: text });
    try {
      delta("Hello sk-abc");
      delta("def world ");
      const clientId = f.mirror.completeText("local", "completed-item");
      f.emit({ id: "reply", at: 1, role: "bot", kind: "text", text: "Hello sk-abcdef world", cloudClientId: clientId });
      expect(f.writes.filter(write => write.name === "agentRuns:appendMessage").map(write => write.args.clientId)).toEqual([clientId, clientId]);
      expect(f.writes.at(-1)?.args).toMatchObject({ clientId, status: "final", text: "Hello [redacted] world" });
      delta("Another answer ");
      expect(f.mirror.completeText("local")).not.toBe(clientId);
      expect(JSON.stringify(f.writes)).not.toContain("sk-abc");
    } finally { f.mirror.stop(); }
  });

  it("withholds unfinished tokens and private-key or credential preambles across deltas", () => {
    expect(sharedStreamingPreview("Hello sk-abc", redact)).toBe("Hello ");
    expect(sharedStreamingPreview("Hello sk-abcdef done ", redact)).toBe("Hello [redacted] done ");
    expect(sharedStreamingPreview("Hello -----BEGIN PRIVATE KEY-----\nPRIVATE MATERIAL\n", redact)).toBe("Hello ");
    expect(sharedStreamingPreview("Hello password=\"multiple secret words", redact)).toBe("Hello ");
  });
});
