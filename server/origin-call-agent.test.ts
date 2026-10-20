import { describe, expect, it } from "vitest";
import { parseWidgetInput, widgetActions } from "../shared/widget.ts";
import {
  awaitBotReply, createCallAgents, parseCallAgentSettings, parseSummary, spokenReply, summaryWidget, transcribeWith, wakeRequest,
  DEFAULT_CALL_AGENT_SETTINGS, type CallAgentDeps, type CallAgentScope, type CallAgentSettings,
} from "./origin-call-agent.ts";
import type { RequestAuth } from "./request-auth.ts";

const AUTH: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const ana = { userId: "user000000000a", name: "Ana" };
const bo = { userId: "user000000000b", name: "Bo", username: "bo" };
const scopeOf = (user: CallAgentScope["user"], room = "proj0000000001"): CallAgentScope => ({ teamId: "team0000000001", room, name: "Kai", user });
const flush = () => new Promise((done) => setTimeout(done, 0));

function harness(overrides: Partial<CallAgentDeps> = {}) {
  const asked: string[] = [];
  const posted: Parameters<CallAgentDeps["post"]>[0][] = [];
  const summarized: string[] = [];
  let settings: CallAgentSettings = { ...DEFAULT_CALL_AGENT_SETTINGS };
  let clock = 1_700_000_000_000;
  const agents = createCallAgents({
    bot: (botId) => (botId === "chief" ? { id: "chief", name: "GGs" } : null),
    allowed: ({ botId }) => botId === "chief",
    ask: async ({ prompt }) => { asked.push(prompt); return "**Ship it** on Friday."; },
    summarize: async ({ prompt }) => {
      summarized.push(prompt);
      return 'Sure: {"keyPoints":["Launch moves to Friday"],"decisions":["Ship v2"],"actionItems":[{"title":"Write release notes","owner":"Bo"}]}';
    },
    post: (input) => posted.push(input),
    transcribe: async () => "hey GGs what do you think",
    settings: () => settings,
    now: () => clock,
    ...overrides,
  });
  return { agents, asked, posted, summarized, tick: (ms: number) => { clock += ms; }, setSettings: (next: CallAgentSettings) => { settings = next; } };
}

describe("wakeRequest", () => {
  it("hears the agent's name after a greeting however speech-to-text spells it", () => {
    expect(wakeRequest("Hey GGs, what do you think?", "GGs")).toEqual({ request: "what do you think?" });
    expect(wakeRequest("ok so hey G G's can you check the build", "GGs")).toEqual({ request: "can you check the build" });
    expect(wakeRequest("hi ggs", "GGs")).toEqual({ request: "" });
    expect(wakeRequest("ehi GG what now", "GGs")).toEqual({ request: "what now" });
    expect(wakeRequest("the GGs team shipped it", "GGs")).toBeNull();
    expect(wakeRequest("hey Bo, what do you think?", "GGs")).toBeNull();
  });
});

describe("summaries", () => {
  it("reads a small model's JSON, or its bullets when it ignored the format", () => {
    expect(parseSummary('{"keyPoints":["a"],"decisions":[],"actionItems":["Fix login",{"title":"Deploy","owner":"Ana"}]}'))
      .toEqual({ keyPoints: ["a"], decisions: [], actionItems: [{ title: "Fix login" }, { title: "Deploy", owner: "Ana" }] });
    expect(parseSummary("- one\n* two\n3. three")).toEqual({ keyPoints: ["one", "two", "three"], decisions: [], actionItems: [] });
  });

  it("builds a card the widget parser accepts, with a checkbox per action item", () => {
    const { widget, fallback } = summaryWidget({
      callName: "Kai", minutes: 12, when: "2026-10-17 10:00", people: ["Ana", "bo"],
      summary: { keyPoints: ["Launch moves to Friday"], decisions: ["Ship v2"], actionItems: [{ title: "Write release notes", owner: "Bo" }] },
    });
    const parsed = parseWidgetInput(widget);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(widgetActions(parsed.value).map((entry) => entry.label)).toEqual(["Create issues", "Discuss"]);
    expect(JSON.stringify(parsed.value)).toContain("Write release notes (Bo)");
    expect(fallback).toContain("Action items");
    const empty = summaryWidget({ callName: "Kai", minutes: 1, when: "x", people: [], summary: { keyPoints: [], decisions: [], actionItems: [] } });
    expect(parseWidgetInput(empty.widget).ok).toBe(true);
  });

  it("speaks replies without formatting", () => {
    expect(spokenReply("**Yes**, see [the doc](https://x.dev).\n\n```\ncode\n```")).toBe("Yes, see the doc.");
  });
});

describe("settings", () => {
  it("defaults to a local transcription server and refuses junk", () => {
    expect(parseCallAgentSettings({}).transcription).toEqual({ engine: "local", baseUrl: "http://127.0.0.1:8000/v1", model: "" });
    expect(parseCallAgentSettings({ transcription: { engine: "rocket", baseUrl: "file:///etc" }, keepTranscript: "yes" }))
      .toEqual(parseCallAgentSettings({}));
    expect(parseCallAgentSettings({ transcription: { engine: "groq", baseUrl: "http://localhost:9000/v1/" } }).transcription.baseUrl).toBe("http://localhost:9000/v1");
  });
});

describe("a call's agent", () => {
  it("only joins for someone in the call, and only the allowed chief", () => {
    const { agents } = harness();
    expect(() => agents.join(scopeOf(ana), AUTH, "chief", [])).toThrow("Join the call first");
    expect(() => agents.join(scopeOf(ana), AUTH, "other", [ana.userId])).toThrow("can't join");
    expect(agents.join(scopeOf(ana), AUTH, "chief", [ana.userId])).toMatchObject({ botId: "chief", name: "GGs", state: "listening", addedBy: "Ana" });
    expect(agents.state(scopeOf(bo), 0).agent?.name).toBe("GGs");
    expect(agents.state(scopeOf(bo, ""), 0).agent).toBeNull();
  });

  it("answers a wake word with recent context and shows the reply as a caption", async () => {
    const { agents, asked } = harness();
    const present = [ana.userId, bo.userId];
    agents.join(scopeOf(ana), AUTH, "chief", present);
    agents.line(scopeOf(bo), AUTH, "We could ship on Friday", present);
    agents.line(scopeOf(ana), AUTH, "Hey GGs, what do you think?", present);
    expect(agents.state(scopeOf(ana), 0).agent?.state).toBe("thinking");
    await flush();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("bo: We could ship on Friday");
    expect(asked[0]).toContain("Ana asked: what do you think?");
    const { lines, cursor } = agents.state(scopeOf(bo), 0);
    expect(lines.at(-1)).toMatchObject({ speaker: "GGs", text: "Ship it on Friday.", agent: true });
    expect(agents.state(scopeOf(bo), cursor).lines).toEqual([]);
  });

  it("takes the next sentence as the question after only the name", async () => {
    const { agents, asked, tick } = harness();
    const present = [ana.userId, bo.userId];
    agents.join(scopeOf(ana), AUTH, "chief", present);
    agents.line(scopeOf(ana), AUTH, "hey GGs", present);
    expect(agents.state(scopeOf(bo), 0).agent?.awaiting).toBe("Ana");
    agents.line(scopeOf(bo), AUTH, "not you", present);
    tick(1_000);
    agents.line(scopeOf(ana), AUTH, "summarise the plan", present);
    await flush();
    expect(asked[0]).toContain("Ana asked: summarise the plan");
  });

  it("summarises when removed, posts the card, then forgets the transcript", async () => {
    const { agents, posted, summarized } = harness();
    const present = [ana.userId, bo.userId];
    agents.join(scopeOf(ana), AUTH, "chief", present);
    agents.line(scopeOf(bo), AUTH, "Let's move the launch to Friday", present);
    agents.leave(scopeOf(bo), present);
    expect(agents.state(scopeOf(ana), 0).agent).toBeNull();
    await flush();
    expect(summarized[0]).toContain("bo: Let's move the launch to Friday");
    expect(posted).toHaveLength(1);
    expect(posted[0]!.transcript).toBeUndefined();
    expect(parseWidgetInput(posted[0]!.widget).ok).toBe(true);
    expect(agents.state(scopeOf(ana), 0).ended).toMatchObject({ name: "GGs", status: "posted" });
    expect(agents.state(scopeOf({ userId: "user000000000c", name: "Cy" }), 0).ended).toBeNull();
    agents.join(scopeOf(ana), AUTH, "chief", present);
    expect(agents.state(scopeOf(ana), 0).lines).toEqual([]);
  });

  it("keeps the transcript in the chief's chat when the call asks to", async () => {
    const { agents, posted } = harness();
    agents.join(scopeOf(ana), AUTH, "chief", [ana.userId]);
    agents.keep(scopeOf(ana), true, [ana.userId]);
    agents.line(scopeOf(ana), AUTH, "Decision: ship v2", [ana.userId]);
    agents.sweep(() => [ana.userId]);
    expect(agents.active()).toBe(1);
    agents.sweep(() => []);
    await flush();
    expect(posted[0]!.transcript).toBe("Ana: Decision: ship v2");
  });

  it("keeps the summary and action items in Origin, with the transcript only when the call kept it", async () => {
    const recorded: unknown[] = [];
    const { agents } = harness({ record: async (input) => { recorded.push(input); } });
    agents.join(scopeOf(ana), AUTH, "chief", [ana.userId]);
    agents.line(scopeOf(ana), AUTH, "Bo writes the release notes", [ana.userId]);
    agents.leave(scopeOf(ana), [ana.userId]);
    await flush();
    agents.join(scopeOf(ana), AUTH, "chief", [ana.userId]);
    agents.keep(scopeOf(ana), true, [ana.userId]);
    agents.line(scopeOf(ana), AUTH, "Ship v2", [ana.userId]);
    agents.leave(scopeOf(ana), [ana.userId]);
    await flush();
    expect(recorded).toEqual([
      {
        room: "proj0000000001", callName: "Kai", startedAt: 1_700_000_000_000, minutes: 1,
        summary: { keyPoints: ["Launch moves to Friday"], decisions: ["Ship v2"], actionItems: [{ title: "Write release notes", owner: "Bo" }] },
      },
      expect.objectContaining({ transcript: "Ana: Ship v2" }),
    ]);
  });

  it("posts nothing for a call where nobody spoke, and reports a failed summary", async () => {
    const quiet = harness();
    quiet.agents.join(scopeOf(ana), AUTH, "chief", [ana.userId]);
    quiet.agents.leave(scopeOf(ana), [ana.userId]);
    await flush();
    expect(quiet.posted).toEqual([]);
    expect(quiet.agents.state(scopeOf(ana), 0).ended).toBeNull();
    const failing = harness({ summarize: async () => { throw new Error("model offline"); } });
    failing.agents.join(scopeOf(ana), AUTH, "chief", [ana.userId]);
    failing.agents.line(scopeOf(ana), AUTH, "something", [ana.userId]);
    failing.agents.leave(scopeOf(ana), [ana.userId]);
    await flush();
    expect(failing.agents.state(scopeOf(ana), 0).ended).toMatchObject({ status: "failed", error: "model offline" });
  });

  it("transcribes audio through the engine and keeps only the text", async () => {
    const seen: number[] = [];
    const { agents, asked, setSettings } = harness({ transcribe: async ({ audio }) => { seen.push(audio.length); return "hey GGs status?"; } });
    agents.join(scopeOf(ana), AUTH, "chief", [ana.userId]);
    const result = await agents.audio(scopeOf(ana), AUTH, new Uint8Array(32), "audio/webm", [ana.userId]);
    expect(result.line).toMatchObject({ speaker: "Ana", text: "hey GGs status?" });
    expect(seen).toEqual([32]);
    await flush();
    expect(asked).toHaveLength(1);
    setSettings({ ...DEFAULT_CALL_AGENT_SETTINGS, transcription: { ...DEFAULT_CALL_AGENT_SETTINGS.transcription, engine: "browser" } });
    await expect(agents.audio(scopeOf(ana), AUTH, new Uint8Array(1), "audio/webm", [ana.userId])).rejects.toThrow("browser");
  });
});

describe("transcribeWith", () => {
  const audio = new Uint8Array([1, 2, 3]);
  it("posts the audio as multipart to an OpenAI-compatible endpoint", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ text: " hello there " }), { status: 200 });
    }) as unknown as typeof fetch;
    const local = await transcribeWith({ audio, mime: "audio/webm;codecs=opus", settings: DEFAULT_CALL_AGENT_SETTINGS, keys: {}, fetch: fake });
    expect(local).toBe("hello there");
    expect(calls[0]!.url).toBe("http://127.0.0.1:8000/v1/audio/transcriptions");
    const form = calls[0]!.init.body as FormData;
    expect(form.get("model")).toBe("Systran/faster-whisper-small");
    expect((form.get("file") as File).size).toBe(3);
    expect(calls[0]!.init.headers).toEqual({});
    const groq = { ...DEFAULT_CALL_AGENT_SETTINGS, transcription: { engine: "groq" as const, baseUrl: "", model: "" } };
    await transcribeWith({ audio, mime: "audio/webm", settings: groq, keys: { groq: "gsk_test" }, fetch: fake });
    expect(calls[1]!.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(calls[1]!.init.headers).toEqual({ authorization: "Bearer gsk_test" });
  });

  it("explains a missing key or an unreachable local server", async () => {
    const openai = { ...DEFAULT_CALL_AGENT_SETTINGS, transcription: { engine: "openai" as const, baseUrl: "", model: "" } };
    await expect(transcribeWith({ audio, mime: "audio/webm", settings: openai, keys: {} })).rejects.toThrow("OpenAI key");
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(transcribeWith({ audio, mime: "audio/webm", settings: DEFAULT_CALL_AGENT_SETTINGS, keys: {}, fetch: down })).rejects.toThrow("No speech-to-text server");
  });
});

describe("awaitBotReply", () => {
  it("resolves with the first finished bot answer in the thread", async () => {
    const listeners = new Set<(change: { type: string; threadId?: string; message?: { role: string; kind?: string; text?: string; turnTerminal?: boolean } }) => void>();
    const store = { onChange: (listener: Parameters<typeof listeners.add>[0]) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    const emit = (change: Parameters<Parameters<typeof listeners.add>[0]>[0]) => listeners.forEach((listener) => listener(change));
    const reply = awaitBotReply(store, "t1", async () => {
      emit({ type: "message", threadId: "t1", message: { role: "user", kind: "text", text: "question" } });
      emit({ type: "message", threadId: "t1", message: { role: "bot", kind: "text", text: "thinking…" } });
      emit({ type: "message", threadId: "t2", message: { role: "bot", kind: "text", text: "elsewhere", turnTerminal: true } });
      emit({ type: "message.patch", threadId: "t1", message: { role: "bot", kind: "text", text: "Answer", turnTerminal: true } });
    }, 1_000);
    await expect(reply).resolves.toBe("Answer");
    expect(listeners.size).toBe(0);
    await expect(awaitBotReply(store, "t1", async () => { throw new Error("busy"); }, 1_000)).rejects.toThrow("busy");
    await expect(awaitBotReply(store, "t1", async () => {}, 10)).rejects.toThrow("too long");
  });
});
