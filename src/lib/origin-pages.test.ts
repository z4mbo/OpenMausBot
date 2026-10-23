import { describe, expect, it, vi } from "vitest";
import { chiefSectionOf, setChiefSectionOf } from "./origin-chief-section";
import { currentOriginPage, openOriginPage } from "./origin-pages";
import { openNotificationTarget } from "@/state/thread-navigation";

describe("opening a conversation from a notification or search", () => {
  it("closes the workspace page and turns a project lead back to its chat", () => {
    const lead = { id: "atlas", threadId: "t1", chiefOfStaff: true, tasks: [{ threadId: "t1" }] };
    openOriginPage("inbox");
    setChiefSectionOf(lead.id, "issues");
    openNotificationTarget(vi.fn(), { botId: lead.id, threadId: "t1" }, { bots: [lead], groups: [] }, true);
    expect(currentOriginPage()).toBeNull();
    expect(chiefSectionOf(lead.id)).toBe("chat");
  });
  it("closes the workspace page for a room too", () => {
    openOriginPage("call");
    openNotificationTarget(vi.fn(), { botId: "asker", threadId: "room" }, { bots: [], groups: [{ id: "g", threadId: "room" }] } as never, true);
    expect(currentOriginPage()).toBeNull();
  });
});
