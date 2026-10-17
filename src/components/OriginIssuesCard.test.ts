// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";
import { groupTranscript } from "@/lib/activity-runs";
import { roomActivityVisible } from "@/lib/room-activity";
import { chiefSectionOf } from "@/lib/origin-chief-section";

const dispatch = vi.fn();
const bots = [
  { id: "kai-chief", threadId: "kai-thread", mainThreadId: "kai-thread", tasks: [] },
  { id: "kai-dev", threadId: "dev-thread", mainThreadId: "dev-thread", tasks: [] },
];
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots }, dispatch }) }));
vi.mock("@/lib/origin-cloud-links", () => ({ useCloudLinks: () => ({ workspaces: {}, projects: { "kai-chief": "kai" } }) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
const { OriginIssuesCard } = await import("./OriginIssuesCard");
const { useIssueFocus } = await import("@/lib/origin-issue-focus");

const message: Message = {
  id: "cards", at: 1, role: "bot", kind: "activity", tool: { name: "origin_list_issues", ok: true },
  originIssues: {
    heading: "2 open high-priority issues · 2 projects",
    issues: [
      { id: "kaitaskab12", key: "ORI-AB12", projectId: "kai", projectName: "Kai", title: "Set up CI", status: "Todo", done: false, priority: "high", assignee: "Ana", due: "2026-11-02", labels: ["ci"] },
      { id: "yukitaskef56", key: "ORI-EF56", projectId: "yuki", projectName: "Yuki", title: "Ship mobile", status: "In progress", done: false, priority: "high" },
    ],
    more: 3,
  },
};

function render(element: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(element));
  return { container, unmount: () => { root.unmount(); container.remove(); } };
}

describe("Origin issue cards", () => {
  it("shows each issue's key, title, status, priority, assignee and project but not its labels, and what was left out", () => {
    const { container, unmount } = render(createElement(OriginIssuesCard, { message }));
    try {
      expect(container.textContent).toContain("2 open high-priority issues · 2 projects");
      const first = container.querySelector('[data-origin-issue="kaitaskab12"]')!;
      for (const part of ["ORI-AB12", "Set up CI", "High"]) expect(first.textContent).toContain(part);
      expect([...first.querySelectorAll("span")].some((span) => span.textContent === "ci")).toBe(false);
      expect(first.querySelector("article")).not.toBeNull();
      expect(container.querySelector('[aria-label="Kai · Todo issues"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Yuki · In progress issues"]')).not.toBeNull();
      expect(container.textContent).toContain("3 more in Origin");
    } finally { unmount(); }
  });

  it("opens a linked project's Issues section focused on the issue, and cannot open an unlinked one", () => {
    dispatch.mockClear();
    let focused: unknown = null;
    function Probe() {
      focused = useIssueFocus("kai");
      return null;
    }
    const probe = render(createElement(Probe));
    const { container, unmount } = render(createElement(OriginIssuesCard, { message }));
    try {
      const unlinked = container.querySelector<HTMLElement>('[data-origin-issue="yukitaskef56"]')!;
      expect(unlinked.dataset.openable).toBeUndefined();
      flushSync(() => unlinked.querySelector("article")!.click());
      expect(dispatch).not.toHaveBeenCalled();
      const linked = container.querySelector<HTMLElement>('[data-origin-issue="kaitaskab12"]')!;
      expect(linked.dataset.openable).toBe("true");
      flushSync(() => linked.querySelector("article")!.click());
      expect(chiefSectionOf("kai-chief")).toBe("issues");
      expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "kai-chief" });
      expect(focused).toEqual({ projectId: "kai", issueId: "kaitaskab12" });
    } finally { unmount(); probe.unmount(); }
  });

  it("stays out of folded tool runs and shows in rooms with tool calls hidden", () => {
    expect(roomActivityVisible(message, false)).toBe(true);
    const ordinary = { ...message, originIssues: undefined };
    const grouped = groupTranscript([{ ...ordinary, id: "a" }, { ...ordinary, id: "b" }, message]);
    expect(grouped.map((item) => item.kind)).toEqual(["run", "message"]);
  });
});
