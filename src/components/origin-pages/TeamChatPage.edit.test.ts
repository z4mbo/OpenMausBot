// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const message = (id: string, body: string) => ({ id, authorUserId: "me", authorName: "Me", authorEmail: "me@example.test", body, createdAt: 1 });
const calls = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/origin-realtime", () => ({
  originRealtime: calls.send,
  originRealtimeFile: vi.fn(),
  usePolled: () => ({ value: { messages: [message("a", "First"), message("b", "Second")], hasMore: false }, error: "", refresh: vi.fn() }),
}));
vi.mock("@/lib/origin-cloud", () => ({ useCloudSession: () => ({ user: null }) }));
vi.mock("@/lib/origin-chat-focus", () => ({ useChatFocus: () => null, consumeChatFocus: vi.fn() }));
vi.mock("../origin-members/teammates", () => ({ useTeammates: () => [] }));
vi.mock("../ChatMarkdown", () => ({ ChatMarkdown: () => null }));
vi.mock("./PersonAvatar", () => ({ PersonAvatar: () => null }));
const { TeamChat } = await import("./TeamChatPage");

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const editor = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit message"]');
const editButton = (index: number) => host.querySelectorAll<HTMLButtonElement>('button[aria-label="Edit message"]')[index]!;

it("keeps another message's edit open when an earlier save finishes", async () => {
  flushSync(() => root.render(createElement(TeamChat, {
    target: { teamId: "workspace", conversation: "project:one" }, name: "Project", me: { _id: "me", email: "me@example.test" },
    canWrite: true, people: [], emptyTitle: "Empty", emptyBody: "Empty", readOnlyNote: "Read only",
  })));
  const saved = Promise.withResolvers<unknown>();
  calls.send.mockReturnValue(saved.promise);
  flushSync(() => editButton(0).click());
  flushSync(() => editor()!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-label="Cancel editing"]')!.click());
  flushSync(() => editButton(1).click());
  expect(editor()!.value).toBe("Second");
  saved.resolve({ message: message("a", "First") });
  await saved.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(editor()?.value).toBe("Second");
  flushSync(() => root.unmount());
});
