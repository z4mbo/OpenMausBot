import { describe, expect, it } from "vitest";
import { createInternalThreadRoutes } from "./routes/internal-threads.ts";
import type { RouteContext } from "./routes/table.ts";
import type { BotRecord, TaskRecord } from "./store.ts";

function fixture() {
  const head = { id: "head", name: "Head", section: "Workspace: One", chiefOfStaff: true, managedSections: ["Alpha", "Beta"] } as BotRecord;
  const alpha = { id: "alpha", name: "Alpha", section: "Alpha", chiefOfStaff: true } as BotRecord;
  const beta = { id: "beta", name: "Beta", section: "Beta", chiefOfStaff: true } as BotRecord;
  const other = { id: "other", name: "Other", section: "Other", chiefOfStaff: true } as BotRecord;
  const bots = [head, alpha, beta, other];
  const state = { visible: true, room: false, owned: true, originRoom: undefined as { memberIds: string[]; audienceFloor: string } | undefined };
  const task = { threadId: "thread", title: "Private work", createdAt: 1, openedBy: undefined as TaskRecord["openedBy"] };
  const messages: { id: string; role: string; text: string; tool?: { name: string; input: string; output: string } }[] = [{ id: "m", role: "bot", text: "Verified the artifact" }];
  const routes = createInternalThreadRoutes({
    from: head, fromThreadId: "head-thread",
    store: {
      bots, bot: (id: string) => bots.find((bot) => bot.id === id), tasks: (id: string) => id === "alpha" ? [task] : [],
      taskByThread: (id: string, threadId: string) => id === "alpha" && threadId === "thread" ? task : undefined,
      activePath: () => messages, groupByThread: (threadId: string) => threadId === "head-thread" ? state.room ? {} : undefined : threadId === "origin-room" ? state.originRoom : undefined,
    } as unknown as Parameters<typeof createInternalThreadRoutes>[0]["store"],
    coordinator: { awaitingAnswer: () => false, parkedDirect: () => false, activeDirect: () => false } as unknown as Parameters<typeof createInternalThreadRoutes>[0]["coordinator"],
    ownsThread: () => state.owned, shown: () => state.visible, threadBusy: () => false, queuedThreadPosition: () => null,
  });
  const request = async (path = "/api/internal/agent-transcript?targetBotId=alpha&threadId=thread") => {
    const url = new URL(`http://fixture.invalid${path}`);
    let status = 0;
    let body: any;
    await routes({ method: "GET", path: url.pathname, url, json: (_res, code, value) => { status = code; body = value; } } as RouteContext);
    return { status, body };
  };
  return { request, head, alpha, state, messages, task };
}

describe("workspace agent transcripts", () => {
  it("lists and reads a supervised Chief's person-started conversation without closing it", async () => {
    const { request } = fixture();
    expect((await request("/api/internal/threads")).body.threads).toEqual([expect.objectContaining({ botId: "alpha", threadId: "thread", own: false })]);
    expect(await request()).toEqual({ status: 200, body: { botId: "alpha", threadId: "thread", title: "Private work", messages: [{ id: "m", role: "bot", text: "Verified the artifact" }], truncated: false } });
  });

  it.each(["team", "chief", "peers", "audience", "hidden", "visible", "room", "owned"])("refuses stale or invalid %s authority", async (change) => {
    const { request, head, alpha, state } = fixture();
    if (change === "team") head.managedSections = ["Beta"];
    if (change === "chief") head.chiefOfStaff = false;
    if (change === "peers") head.peers = [];
    if (change === "audience") alpha.visibility = "admins";
    if (change === "hidden") alpha.hidden = true;
    if (change === "visible") state.visible = false;
    if (change === "room") state.room = true;
    if (change === "owned") state.owned = false;
    const result = await request();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(result.body)).not.toContain("Verified the artifact");
  });

  it("bounds transcript text and redacts secrets before returning it", async () => {
    const { request, messages } = fixture();
    messages[0]!.text = "sk-test-123456789012345678901234567890 " + "x".repeat(30_000);
    const { body } = await request();
    expect(body.messages[0].text).not.toContain("sk-test-");
    expect(body.messages[0].text.length).toBe(4_000);
    expect(body.truncated).toBe(true);
  });

  it("includes tool evidence within the same text budget", async () => {
    const { request, messages } = fixture();
    messages[0]!.tool = { name: "verify", input: "Run checks", output: "token=fixture-secret-value\n" + "x".repeat(30_000) };
    const { body } = await request();
    const message = body.messages[0];
    expect(message.tool.output).not.toContain("fixture-secret-value");
    expect(message.text.length + message.tool.name.length + message.tool.input.length + message.tool.output.length).toBe(4_000);
    expect(body.truncated).toBe(true);
  });

  it("withholds room-derived work from a wider audience or outside workspace", async () => {
    const { request, state, task } = fixture();
    task.openedBy = { botId: "alpha", name: "Alpha", threadId: "origin-room", roomLane: true, at: 1 };
    state.originRoom = { memberIds: ["alpha"], audienceFloor: "admins" };
    expect((await request()).status).toBe(404);
    expect((await request("/api/internal/threads")).body.threads).toEqual([]);
    state.originRoom.audienceFloor = "everyone";
    expect((await request()).status).toBe(200);
    state.originRoom.memberIds.push("other");
    expect((await request()).status).toBe(404);
  });

  it("withholds transcripts whose source conversation can no longer be checked", async () => {
    const { request, task } = fixture();
    task.openedBy = { botId: "alpha", name: "Alpha", threadId: "deleted", at: 1 };
    expect((await request()).status).toBe(404);
  });
});
