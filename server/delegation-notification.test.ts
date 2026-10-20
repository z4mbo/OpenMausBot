import { describe, expect, it, vi } from "vitest";
import { appendDelegationRequest } from "./delegation-notification.ts";
import type { HandoffView } from "./coordinator.ts";
import type { BotRecord, Message } from "./store.ts";

function fixture() {
  const messages: Message[] = [];
  const bot = { id: "researcher", name: "Researcher", threadId: "direct-B", notifications: true } as BotRecord;
  const sender = { id: "chief", name: "Project Chief", chiefOfStaff: true } as BotRecord;
  const node = { id: "request-A", rootId: "root", parentId: "parent-A", botId: bot.id, threadId: "child-A", text: "Research project A", mode: "work", origin: { kind: "user", request: "Research project A" } } as HandoffView;
  const notify = vi.fn();
  const store = { messagesFor: () => messages, bot: () => bot, appendMessage: vi.fn((_thread: string, row: Omit<Message, "id" | "at">) => {
    const message = { ...row, id: "request-message", at: 1 } as Message; messages.push(message); return message;
  }) };
  return { bot, sender, node, notify, store, messages, send: (patch = {}) => appendDelegationRequest({ store, node, sender, bot, request: { id: node.id, botIds: [bot.id] }, resumed: false, routine: false, quiet: false, notify, ...patch }) };
}

describe("delegation start notifications", () => {
  it("notifies once after the child's actual request is saved and targets that exact thread", () => {
    const f = fixture();
    f.notify.mockImplementation(() => expect(f.messages).toHaveLength(1));
    f.send(); f.send(); f.send({ resumed: true });
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.notify.mock.calls[0]?.[0]).toMatchObject({ kind: "delegation-started", botId: f.bot.id, threadId: "child-A", title: "Researcher started delegated work" });
    expect(f.store.appendMessage).toHaveBeenCalledTimes(1);
  });
  it.each(["routine", "root", "muted"])('does not notify %s work', reason => {
    const f = fixture();
    if (reason === "root") delete f.node.parentId;
    if (reason === "muted") f.bot.notifications = false;
    f.send({ routine: reason === "routine" });
    expect(f.notify.mock.calls.every(([notification]) => notification === null)).toBe(true);
    expect(f.store.appendMessage).toHaveBeenCalledTimes(1);
  });
  it.each(["ordinary", "consult", "notice", "quiet", "outside", "room"])('keeps %s coordination in the transcript without a new start notification', reason => {
    const f = fixture();
    if (reason === "ordinary") f.sender.chiefOfStaff = false;
    if (reason === "consult") f.node.mode = "consult";
    if (reason === "notice") f.node.mode = "notify";
    if (reason === "outside") f.node.origin = { kind: "outside" };
    if (reason === "room") f.node.groupId = "room";
    f.send({ quiet: reason === "quiet" });
    expect(f.store.appendMessage).toHaveBeenCalledTimes(1);
    expect(f.notify).not.toHaveBeenCalled();
  });
  it("does not announce work whose request could not be saved", () => {
    const f = fixture(); f.store.appendMessage.mockImplementation(() => { throw new Error("disk full"); });
    expect(() => f.send()).toThrow("disk full"); expect(f.notify).not.toHaveBeenCalled();
  });
});
