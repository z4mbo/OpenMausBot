// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/origin-realtime", () => ({
  originRealtime: calls.send,
  originRealtimeFile: vi.fn(),
  usePolled: () => ({ value: { messages: [], hasMore: false }, error: "", refresh: calls.refresh }),
}));
vi.mock("@/lib/origin-cloud", () => ({ useCloudSession: () => ({ user: null }) }));
vi.mock("@/lib/origin-chat-focus", () => ({ useChatFocus: () => null, consumeChatFocus: vi.fn() }));
vi.mock("../origin-members/teammates", () => ({ useTeammates: () => [] }));
vi.mock("../ChatMarkdown", () => ({ ChatMarkdown: () => null }));
vi.mock("./ui", () => ({
  CloudGate: () => null, EmptyState: () => null, Loading: () => null,
  Notice: ({ children }: { children: string }) => createElement("p", null, children),
  iconButton: "", inputClass: "", primaryButton: "",
}));
const { TeamChat } = await import("./TeamChatPage");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  calls.send.mockReset();
  calls.refresh.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(TeamChat, {
    target: { teamId: "workspace", conversation: "project:one" }, name: "Project", me: { _id: "me", email: "me@example.test" },
    canWrite: true, people: [], emptyTitle: "Empty", emptyBody: "Empty", readOnlyNote: "Read only",
  })));
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

function fill(text: string) {
  const input = host.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
  flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
}
function submit() { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }

describe("TeamChat sending", () => {
  it("preserves a new draft typed while the preceding message is in flight", async () => {
    const response = Promise.withResolvers<unknown>();
    calls.send.mockReturnValue(response.promise);
    fill("First message");
    flushSync(submit);
    fill("Second draft");
    response.resolve({});
    await vi.waitFor(() => expect(calls.refresh).toHaveBeenCalledOnce());
    expect(host.querySelector("textarea")!.value).toBe("Second draft");
    expect(calls.send.mock.calls[0]![2].json.body).toBe("First message");
  });

  it("clears an unchanged draft only after the server accepts it", async () => {
    const response = Promise.withResolvers<unknown>();
    calls.send.mockReturnValue(response.promise);
    fill("First message");
    flushSync(submit);
    expect(host.querySelector("textarea")!.value).toBe("First message");
    response.resolve({});
    await vi.waitFor(() => expect(host.querySelector("textarea")!.value).toBe(""));
  });

  it("keeps the draft and exposes the failure when sending fails", async () => {
    calls.send.mockRejectedValue(new Error("Server unavailable"));
    fill("Keep this message");
    flushSync(submit);
    await vi.waitFor(() => expect(host.textContent).toContain("Server unavailable"));
    expect(host.querySelector("textarea")!.value).toBe("Keep this message");
    expect(calls.refresh).not.toHaveBeenCalled();
  });

  it("sends only once when two submit events arrive in the same render", () => {
    calls.send.mockReturnValue(new Promise(() => {}));
    fill("Only once");
    flushSync(() => { submit(); submit(); });
    expect(calls.send).toHaveBeenCalledOnce();
  });
});

describe("message groups", () => {
  it("continues an author's run of messages for five minutes and starts over for someone else", async () => {
    const { continuesGroup } = await import("./TeamChatPage");
    const message = (authorUserId: string, minute: number) => ({ id: `${authorUserId}${minute}`, authorUserId, authorName: authorUserId, authorEmail: "", body: "", createdAt: minute * 60_000 });
    expect(continuesGroup(undefined, message("ada", 0))).toBe(false);
    expect(continuesGroup(message("ada", 0), message("ada", 4))).toBe(true);
    expect(continuesGroup(message("ada", 0), message("ada", 5))).toBe(false);
    expect(continuesGroup(message("ada", 0), message("ben", 1))).toBe(false);
  });
});
