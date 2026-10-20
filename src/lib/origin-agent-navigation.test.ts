import { describe, expect, it } from "vitest";
import { agentConversation, exposeProjectAgentThread, visibleProjectAgentThread } from "./origin-agent-navigation";
import type { Task } from "@/state/store";

const tasks = [
  { threadId: "delegation-a", title: "Project A research", createdAt: 1, busy: true, openedBy: { botId: "chief", name: "Chief", threadId: "project-a", at: 1 } },
  { threadId: "direct-b", title: "Independent research", createdAt: 2 },
] satisfies Task[];

describe("agent conversation selection", () => {
  it("initially opens active delegated work instead of the owner's last direct chat", () => {
    expect(agentConversation({ threadId: "direct-b", tasks })?.threadId).toBe("delegation-a");
  });
  it("keeps explicitly chosen direct B when project A delegates more work", () => {
    expect(agentConversation({ threadId: "direct-b", tasks }, "direct-b")?.threadId).toBe("direct-b");
  });
  it("recovers after the selected conversation is deleted", () => {
    expect(agentConversation({ threadId: "direct-b", tasks }, "deleted")?.threadId).toBe("delegation-a");
  });
  it("returns to the loaded conversation when no task needs attention", () => {
    expect(agentConversation({ threadId: "direct-b", tasks: tasks.map(task => ({ ...task, busy: false })) })?.threadId).toBe("direct-b");
  });
  it("does not let an old panel cleanup hide its replacement conversation", () => {
    const old = exposeProjectAgentThread("project", "a");
    const current = exposeProjectAgentThread("project", "b");
    old(); expect(visibleProjectAgentThread("project")).toBe("b");
    current(); expect(visibleProjectAgentThread("project")).toBeNull();
  });
});
