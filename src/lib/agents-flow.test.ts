import { describe, expect, it } from "vitest";
import { botThreadIds, flowLink, roomThreadsSpokenBy, missingMembers, projectRoomBulletin, projectRoomOf, projectRoster, workspaceHeadOf } from "./agents-flow";
import { EMPTY_TEAM_MAP_SNAPSHOT } from "./team-map";

const head = { id: "h", name: "Atlas", section: "Workspace: Acme", chiefOfStaff: true, managedSections: ["Shop"] };
const lead = { id: "c", name: "Nova", section: "Shop", chiefOfStaff: true };
const dev = { id: "d", name: "Dev", section: "Shop" };
const designer = { id: "e", name: "Designer", section: "Shop" };

describe("flowLink", () => {
  it("is live while the agent works a thread the lead opened", () => {
    const working = { ...dev, busy: true, tasks: [{ threadId: "t", busy: true, openedBy: { botId: "c" } }] };
    expect(flowLink(lead, working, EMPTY_TEAM_MAP_SNAPSHOT)).toBe("running");
    expect(flowLink(lead, { ...working, tasks: [{ threadId: "t", busy: false, openedBy: { botId: "c" } }] }, EMPTY_TEAM_MAP_SNAPSHOT)).toBe("busy");
  });

  it("follows the coordinator's running and queued hand-offs", () => {
    const snapshot = { collaborations: [], running: [{ sourceBotId: "c", targetBotId: "d", threadId: "t" }], queued: [{ sourceBotId: "c", targetBotId: "e" }] };
    expect(flowLink(lead, dev, snapshot)).toBe("running");
    expect(flowLink(lead, designer, snapshot)).toBe("queued");
    expect(flowLink(lead, { ...dev, id: "z" }, snapshot)).toBe("idle");
  });
});

describe("project room", () => {
  it("finds the workspace head that manages the project", () => {
    expect(workspaceHeadOf([dev, head, lead], lead)?.id).toBe("h");
    expect(workspaceHeadOf([dev, lead], lead)).toBeUndefined();
  });

  it("is the one non-direct room filed under the project's team", () => {
    const rooms = [{ id: "dm", dm: true, section: "Shop", memberIds: [] }, { id: "other", section: "Blog", memberIds: [] }, { id: "room", section: " Shop ", memberIds: [] }];
    expect(projectRoomOf(rooms, lead)?.id).toBe("room");
    expect(projectRoomOf(rooms, { ...lead, section: undefined })).toBeUndefined();
  });

  it("ranks the head, the lead, then the agents, and names who is missing", () => {
    const roster = projectRoster(head, lead, [dev, designer]);
    expect(roster).toEqual(["h", "c", "d", "e"]);
    expect(missingMembers({ id: "r", memberIds: ["c", "d"] }, roster)).toEqual(["h", "e"]);
  });

  it("tells every member the chain of command", () => {
    expect(projectRoomBulletin(head, lead, [dev, designer])).toContain("the people in this project → Atlas (workspace lead) → Nova (project lead) → Dev, Designer");
    expect(projectRoomBulletin(undefined, lead, [])).toContain("the people in this project → Nova (project lead).");
  });

  it("collects every thread a bot can be working in", () => {
    expect(botThreadIds({ threadId: "a", mainThreadId: "m", tasks: [{ threadId: "a" }, { threadId: "b" }] })).toEqual(["a", "m", "b"]);
  });

  it("adds the room threads a bot is speaking in right now", () => {
    const rooms = [{ threadId: "r", busyBotId: "d", tasks: [{ threadId: "r2", busyBotId: "d" }, { threadId: "r3", busyBotId: "e" }] }, { threadId: "q", busyBotId: null }];
    expect(roomThreadsSpokenBy(rooms, "d")).toEqual(["r", "r2"]);
  });
});
