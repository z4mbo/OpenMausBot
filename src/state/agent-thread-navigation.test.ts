import { describe, expect, it, vi } from "vitest";
import { chooseProjectAgent, exposeProjectAgentThread, projectAgentSelection } from "@/lib/origin-agent-navigation";
import { chiefSectionOf, setChiefSectionOf } from "@/lib/origin-chief-section";
import { openNotificationTarget, visibleNotificationThread } from "./thread-navigation";

const chief = { id: "notify-project-chief", name: "Project", chiefOfStaff: true, section: "notify-project", threadId: "parent-a", tasks: [] };
const agent = { id: "notify-project-agent", name: "Researcher", section: "notify-project", threadId: "direct-b", tasks: [{ threadId: "child-a" }, { threadId: "direct-b" }] };
const state = { bots: [chief, agent], groups: [], activeView: "chat" as const, selectedId: chief.id };

describe("specialist notification destinations", () => {
  it("opens the exact child conversation inside its project's Agents page", () => {
    const dispatch = vi.fn();
    openNotificationTarget(dispatch, { botId: agent.id, threadId: "child-a" }, state, true);
    expect(chiefSectionOf(chief.id)).toBe("agents");
    expect(projectAgentSelection(chief.id)).toEqual({ agentId: agent.id, threadId: "child-a", chatOpen: true });
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: chief.id }, { type: "switchTask", botId: agent.id, threadId: "child-a", preserveSelection: true },
    ]);
  });
  it("suppresses only the visible specialist's thread, never its hidden project chat", () => {
    setChiefSectionOf(chief.id, "agents"); chooseProjectAgent(chief.id, agent.id, "direct-b");
    const close = exposeProjectAgentThread(chief.id, "direct-b");
    expect(visibleNotificationThread(state)).toBe("direct-b");
    close(); expect(visibleNotificationThread(state)).toBeNull();
    setChiefSectionOf(chief.id, "issues"); expect(visibleNotificationThread(state)).toBeNull();
    setChiefSectionOf(chief.id, "chat"); expect(visibleNotificationThread(state)).toBe("parent-a");
  });
});
