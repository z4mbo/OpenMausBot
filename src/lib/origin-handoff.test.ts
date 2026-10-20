import { describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { chiefSectionOf, setChiefSectionOf } from "./origin-chief-section";
import { currentOriginPage, openOriginPage } from "./origin-pages";
import { handOff } from "./origin-handoff";

const agent = (extra: Partial<Bot> = {}): Bot => ({ id: "dev", name: "Dev", color: "green", messages: [], notifications: false, unread: false,
  modelSelection: {}, threadId: "side", mainThreadId: "main", tasks: [{ threadId: "main" }, { threadId: "side" }], description: "", ...extra } as Bot);

describe("handOff", () => {
  it("sends to the same thread it opens when threads are hidden", () => {
    const dispatch = vi.fn();
    handOff(dispatch, agent(), "Brief", false);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ type: "send", botId: "dev", threadId: "main", text: "Brief" });
    expect(dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "dev", threadId: "main" });
  });

  it("keeps the current thread when threads are shown", () => {
    const dispatch = vi.fn();
    handOff(dispatch, agent(), "Brief", true);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ threadId: "side" });
  });

  it("shows a project lead's chat rather than the section it was on", () => {
    setChiefSectionOf("lead", "issues");
    openOriginPage("inbox");
    handOff(vi.fn(), agent({ id: "lead", chiefOfStaff: true }), "Brief", true);
    expect(chiefSectionOf("lead")).toBe("chat");
    expect(currentOriginPage()).toBeNull();
  });
});
