import { describe, expect, it } from "vitest";
import { MEMORY_MAX_LINES, readMemoryFile, readMemoryTopic, updateMemory, writeMemoryFile } from "../workspace.ts";
import { callTool, type ToolCallContext } from "./agents-call.ts";

function context(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    botId: "bot-voice",
    threadId: "thread-voice",
    depth: 0,
    externalRuntime: false,
    sharedComputers: false,
    client: {
      api: async () => ({}),
      apiResponse: async () => ({ ok: true, status: 200, body: {} }),
    },
    ...overrides,
  };
}

describe("read_agent_transcript", () => {
  it("uses target addressing separately from capability identity and surfaces refusals", async () => {
    for (const ok of [true, false]) {
      const paths: string[] = [];
      const result = await callTool("read_agent_transcript", { bot_id: "chief", thread_id: "work", limit: 10 }, context({ client: {
        api: async () => ({}),
        apiResponse: async (path) => { paths.push(path); return { ok, status: ok ? 200 : 404, body: ok ? { messages: [{ text: "Done" }] } : { error: "No supervised agent conversation" } }; },
      } }));
      expect(paths).toEqual(["/api/internal/agent-transcript?targetBotId=chief&threadId=work&limit=10"]);
      expect(result.isError === true).toBe(!ok);
      expect(result.text).toContain(ok ? "Done" : "No supervised agent conversation");
    }
  });
});

describe("send_voice_note", () => {
  it("refuses a missing or blank note with the shape a retry needs", async () => {
    for (const args of [{}, { text: "" }, { text: "   " }]) {
      const result = await callTool("send_voice_note", args, context());
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.text).toContain("send_voice_note needs text");
    }
  });

  it("refuses a note over 1000 characters and reports the length", async () => {
    const result = await callTool("send_voice_note", { text: "a".repeat(1001) }, context());
    expect(result.isError).toBe(true);
    expect(result.text).toContain("1000 characters");
    expect(result.text).toContain("1001");
  });

  it("posts the trimmed verbatim note to the harness route", async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const result = await callTool("send_voice_note", { text: "  Ship it.  " }, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return {};
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("Voice note recorded");
    expect(calls).toEqual([
      { path: "/api/internal/voice-note", body: { fromBotId: "bot-voice", fromThreadId: "thread-voice", text: "Ship it." } },
    ]);
  });

  it("surfaces missing voice setup as a tool error, never a thrown turn", async () => {
    const result = await callTool("send_voice_note", { text: "Hello" }, context({
      client: {
        api: async () => { throw new Error("Pick a voice in the agent profile."); },
        apiResponse: async () => ({ ok: false, status: 409, body: { error: "Pick a voice in the agent profile." } }),
      },
    }));
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Pick a voice in the agent profile.");
  });
});

describe("create_bot", () => {
  it("passes a working folder through to the internal create route", async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const result = await callTool("create_bot", { name: "Scout", role: "Ops", instructions: "Work.", cwd: "  /tmp/ops  " }, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return { id: "b1", name: "Scout", section: "Work" };
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([
      { path: "/api/internal/create-bot", body: { fromBotId: "bot-voice", fromThreadId: "thread-voice", name: "Scout", role: "Ops", instructions: "Work.", cwd: "/tmp/ops" } },
    ]);
  });
});

describe("add_mcp_server", () => {
  it("posts the arguments and tells the model the server was saved off", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const result = await callTool("add_mcp_server", {
      name: "notes",
      command: "npx",
      args: ["-y", "notes-mcp"],
      env: { NOTES_TOKEN: "super-secret" },
    }, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return { name: "notes", enabled: false, transport: "command", target: "npx", envKeys: ["NOTES_TOKEN"], headerKeys: [] };
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("Saved MCP server “notes” (command npx) switched off.");
    expect(result.text).toContain("MCP server settings");
    expect(result.text).toContain("runs that command on their computer");
    expect(result.text).toContain("NOTES_TOKEN");
    expect(result.text).not.toContain("super-secret");
    expect(calls).toEqual([{
      path: "/api/internal/mcp-servers",
      body: { name: "notes", command: "npx", args: ["-y", "notes-mcp"], env: { NOTES_TOKEN: "super-secret" } },
    }]);
  });

  it("returns the route's error sentence without echoing a secret", async () => {
    const result = await callTool("add_mcp_server", {
      name: "docs",
      url: "https://docs.example/mcp",
      headers: { Authorization: "Bearer hidden" },
      enabled: true,
    }, context({
      client: {
        api: async () => { throw new Error("A bot cannot change the on/off switch. The server is saved off, and only the user can turn it on in MCP server settings."); },
        apiResponse: async () => ({ ok: false, status: 400, body: {} }),
      },
    }));
    expect(result).toEqual({
      text: "A bot cannot change the on/off switch. The server is saved off, and only the user can turn it on in MCP server settings.",
      isError: true,
    });
    expect(result.text).not.toContain("hidden");
  });
});

describe("propose_profile", () => {
  it("rejects a non-boolean toggle without proposing the valid half", async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const ctx = context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return {};
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    });
    const result = await callTool("propose_profile", { description: "Calmer replies.", notifications: "on" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("propose_profile notifications and speakReplies must be true or false.");
    expect(calls).toEqual([]);
  });

  it("passes boolean toggles through with the other fields", async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const result = await callTool("propose_profile", { description: "Calmer replies.", notifications: false, speakReplies: true, reason: "Use calmer replies." }, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return {};
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([
      {
        path: "/api/internal/profile-requests",
        body: {
          fromBotId: "bot-voice",
          fromThreadId: "thread-voice",
          changes: { description: "Calmer replies.", notifications: false, speakReplies: true },
          reason: "Use calmer replies.",
        },
      },
    ]);
  });
});

describe("memory_update", () => {
  // The harness route, in process: the real updateMemory behind the tool.
  const harness = (botId: string): ToolCallContext["client"] => ({
    api: async () => ({}),
    apiResponse: async (_path, init) => {
      const body = JSON.parse(String(init?.body));
      const result = updateMemory(botId, { action: body.action, text: body.text, oldText: body.oldText }, { source: 'chat "Turn"' });
      return { ok: result.ok, status: result.ok ? 200 : result.code === "conflict" ? 409 : 400, body: result };
    },
  });

  it("saves every note in a turn on a full file, saying what moved to the archive, and never closes the tool", async () => {
    const bot = "bot-memory-full";
    writeMemoryFile(bot, Array.from({ length: MEMORY_MAX_LINES }, (_, i) => `- 2026-09-01 · old ${i}\n`).join(""));
    const ctx = context({ botId: bot, client: harness(bot) });
    for (let i = 0; i < 4; i += 1) {
      const stale = await callTool("memory_update", { action: "remove", old_text: "no such passage" }, ctx);
      expect(stale).toMatchObject({ isError: true });
    }
    for (let i = 0; i < 10; i += 1) {
      const result = await callTool("memory_update", { action: "append", text: `note ${i}` }, ctx);
      expect(result.isError, result.text).toBeFalsy();
      expect(result.text).toMatch(new RegExp(`^Memory updated\\. Entry: - \\d{4}-\\d{2}-\\d{2} · from chat "Turn" · note ${i}\\n`));
      expect(result.text).toMatch(new RegExp(`\\nTo stay within what loads each session, moved 1 older entry to memory/archive\\.md \\(session_search finds them\\):\\n- 2026-09-01 · old ${i}$`));
    }
    const text = readMemoryFile(bot).text;
    for (let i = 0; i < 10; i += 1) expect(text).toContain(` · note ${i}\n`);
    expect(readMemoryTopic(bot, "archive.md")).toContain("- 2026-09-01 · old 9 · moved");
  });

  it("names only the first few entries a write moved, each by its first line, and counts the rest", async () => {
    const bot = "bot-memory-grown";
    // a file grown far past the budget by hand: one write moves hundreds
    const grown = Array.from({ length: 600 }, (_, i) => `- 2026-09-01 · old ${i}`);
    grown[0] = "- 2026-08-01 · Deploy command:\n  ```sh\n  railway up\n  ```";
    writeMemoryFile(bot, `${grown.join("\n")}\n`);
    const result = await callTool("memory_update", { action: "append", text: "one more" }, context({ botId: bot, client: harness(bot) }));
    expect(result.isError).toBeFalsy();
    expect(result.text.split("\nTo stay")[1]).toBe(
      " within what loads each session, moved 401 older entries to memory/archive.md (session_search finds them):\n" +
      "- 2026-08-01 · Deploy command:\n- 2026-09-01 · old 1\n- 2026-09-01 · old 2\n- 2026-09-01 · old 3\n- 2026-09-01 · old 4\n…and 396 more",
    );
    expect(readMemoryTopic(bot, "archive.md")).toContain("- 2026-08-01 · Deploy command: · moved");
  });

  it("tells the bot plainly when hand-written lines fill what loads", async () => {
    const bot = "bot-memory-hand";
    writeMemoryFile(bot, Array.from({ length: MEMORY_MAX_LINES }, (_, i) => `- note ${i}\n`).join(""));
    const result = await callTool("memory_update", { action: "append", text: "kept anyway" }, context({ botId: bot, client: harness(bot) }));
    expect(result.isError).toBeFalsy();
    expect(result.text).toMatch(/^Memory updated\. Entry: - \d{4}-\d{2}-\d{2} · from chat "Turn" · kept anyway\nSaved, but the lines that never move out of MEMORY\.md \(hand-written ones, health and safety facts\) fill what loads each session, so the newest entries do not load\. Ask the person to trim MEMORY\.md in Settings\.$/);
    expect(readMemoryFile(bot).text).toContain(" · kept anyway\n");
  });
});

describe("propose_team_memory", () => {
  it.each(["person", "place", "decision", "term"])("sends the %s proposal with exact identity and never claims immediate publication", async (kind) => {
    const calls: Array<{ path: string; body: any }> = [];
    const result = await callTool("propose_team_memory", { kind, name: "  Fixture name  ", detail: "  Unreviewed detail  ", aliases: ["Alias"] }, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return { status: "proposed", requestId: "proposal-fixture", summary: "Needs admin review" };
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).not.toBe(true);
    expect(result.text).toMatch(/confirm|wait/i);
    expect(result.text).not.toContain("Remembered for the team");
    expect(calls).toEqual([{ path: "/api/internal/team-memory", body: {
      fromBotId: "bot-voice", fromThreadId: "thread-voice", kind, name: "Fixture name", detail: "Unreviewed detail", aliases: ["Alias"],
    } }]);
  });
});

describe("origin_assign_issue", () => {
  const handoff = { botId: "kai-dev", botName: "Developer", message: "You're assigned issue ORI-AB12", doneWhen: "PR linked", reason: "Origin issue ORI-AB12: Set up CI" };

  function originHarness(answers: Record<string, { ok: boolean; status: number; body: Record<string, unknown> }>) {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const apiResponse = async (path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ path, body });
      const key = path === "/api/internal/origin/tool" ? `origin:${String(body.phase ?? "prepare")}` : path;
      return answers[key] ?? { ok: false, status: 404, body: { error: "unexpected" } };
    };
    return { calls, client: { api: async () => ({}), apiResponse } };
  }

  it("prepares, hands the issue over through coordinate_bots, then records it", async () => {
    const { calls, client } = originHarness({
      "origin:prepare": { ok: true, status: 200, body: { text: "Ready", handoff } },
      "/api/internal/coordinate-bots": { ok: true, status: 200, body: { receipts: [{ botId: "kai-dev", outcome: "queued" }] } },
      "origin:record": { ok: true, status: 200, body: { text: "Labelled ORI-AB12 agent:developer and commented the assignment." } },
    });
    const result = await callTool("origin_assign_issue", { issue_id: "ORI-AB12", bot_id: "kai-dev" }, context({ client }));
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("Assigned to Developer");
    expect(result.text).toContain("Labelled ORI-AB12 agent:developer");
    expect(calls.map((call) => [call.path, call.body.phase ?? null])).toEqual([
      ["/api/internal/origin/tool", null],
      ["/api/internal/coordinate-bots", null],
      ["/api/internal/origin/tool", "record"],
    ]);
    expect(calls[1]!.body).toEqual({ botIds: ["kai-dev"], message: handoff.message, reason: handoff.reason, done_when: handoff.doneWhen, thread: "new" });
    expect(calls[0]!.body.arguments).toEqual({ issue_id: "ORI-AB12", bot_id: "kai-dev" });
  });

  it("records nothing when coordinate_bots refuses, and sends nothing when Origin refuses", async () => {
    const refused = originHarness({
      "origin:prepare": { ok: true, status: 200, body: { text: "Ready", handoff } },
      "/api/internal/coordinate-bots": { ok: false, status: 403, body: { error: "The recipient is not an allowed peer of the sender" } },
    });
    const result = await callTool("origin_assign_issue", { issue_id: "x", bot_id: "kai-dev" }, context({ client: refused.client }));
    expect(result).toEqual({ isError: true, text: "Not assigned, nothing was sent: The recipient is not an allowed peer of the sender" });
    expect(refused.calls).toHaveLength(2);
    const origin = originHarness({ "origin:prepare": { ok: true, status: 200, body: { text: "Only a Chief assigns Origin issues to agents.", isError: true } } });
    expect(await callTool("origin_assign_issue", { issue_id: "x", bot_id: "y" }, context({ client: origin.client })))
      .toEqual({ isError: true, text: "Only a Chief assigns Origin issues to agents." });
    expect(origin.calls).toHaveLength(1);
  });

  it("origin_complete_issue asks the project's Chief to review in a new thread, without resuming the agent", async () => {
    const reviewer = { botId: "kai-chief", botName: "Kai", message: "Review #7", reason: "Review the pull request for ORI-AB12" };
    const { calls, client } = originHarness({
      "origin:prepare": { ok: true, status: 200, body: { text: "Commented on ORI-AB12.", reviewer } },
      "/api/internal/coordinate-bots": { ok: true, status: 200, body: { receipts: [] } },
    });
    const result = await callTool("origin_complete_issue", { issue_id: "ORI-AB12", summary: "Done" }, context({ client }));
    expect(result).toEqual({ text: "Commented on ORI-AB12." });
    expect(calls[1]).toEqual({ path: "/api/internal/coordinate-bots", body: { botIds: ["kai-chief"], message: "Review #7", reason: reviewer.reason, thread: "new", reply: "none" } });
  });

  it("origin_design_submit starts the Chief's design review, and a canvas screenshot reaches the model as an image", async () => {
    const reviewer = { botId: "kai-chief", botName: "Kai", message: "Review the design", reason: "Review the design for ORI-AB12" };
    const review = originHarness({
      "origin:prepare": { ok: true, status: 200, body: { text: "Linked \"Pricing\" to ORI-AB12.", reviewer } },
      "/api/internal/coordinate-bots": { ok: true, status: 200, body: { receipts: [] } },
    });
    expect(await callTool("origin_design_submit", { issue_id: "task1", frames: ["Pricing"] }, context({ client: review.client }))).toEqual({ text: "Linked \"Pricing\" to ORI-AB12." });
    expect(review.calls[1]?.path).toBe("/api/internal/coordinate-bots");
    const shot = originHarness({ "origin:prepare": { ok: true, status: 200, body: { text: "Screenshot of \"Pricing\".", image: { mimeType: "image/png", data: "iVBORw0KGgo=" } } } });
    expect(await callTool("origin_canvas_screenshot", { node: "Pricing" }, context({ client: shot.client }))).toEqual({
      text: "", passthrough: { content: [{ type: "text", text: "Screenshot of \"Pricing\"." }, { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }] },
    });
  });
});
