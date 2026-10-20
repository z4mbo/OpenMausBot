// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const polled = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/lib/origin-realtime", () => ({
  originRealtime: vi.fn(),
  originRealtimeFile: vi.fn(),
  usePolled: () => ({ value: undefined, error: "Workspace server unreachable", refresh: polled.refresh }),
}));
vi.mock("@/lib/origin-chat-focus", () => ({ useChatFocus: () => null, consumeChatFocus: vi.fn() }));
vi.mock("../ChatMarkdown", () => ({ ChatMarkdown: () => null }));
const { TeamChat } = await import("./TeamChatPage");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("says the conversation could not load and offers a retry instead of a blank page", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(TeamChat, { target: { teamId: "t", conversation: "project:p" }, name: "Walkies", me: { _id: "me", name: "Ada", email: "ada@example.test" }, canWrite: true, people: [], emptyTitle: "Start", emptyBody: "", readOnlyNote: "" })));
  expect(host.textContent).toContain("Could not load messages");
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
  act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again")!.click());
  expect(polled.refresh).toHaveBeenCalled();
  act(() => root.unmount());
});
