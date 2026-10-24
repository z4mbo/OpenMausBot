import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { LiveCallState } from "../../shared/wire.ts";
import { launchVerificationServer } from "../control-omb.ts";
import { startFakeOpenAiLive, type FakeOpenAiLive } from "../../server/testing/fake-openai-live.ts";
import type { ListenerHooks, VoiceListener } from "../../src/lib/voice/listener.ts";
import type { LiveMediaPhase } from "../../src/lib/live-call-media.ts";
import { LIVE_QUIET_MS, startVoiceWake, stopVoiceWake, voiceWakeSnapshot, type VoiceSessionDeps } from "../../src/lib/voice/voice-session.ts";

type Bot = { id: string; name: string; threadId: string; busy?: boolean };
type ChatMessage = { id: string; role: "user" | "bot"; kind: "text"; text?: string; turnTerminal?: boolean };

const key = "sk-origin-isolated-voice";

/** Stands in for the microphone and its recogniser: the test says what the person said. */
class ScriptedListener implements VoiceListener {
  listening = false;
  constructor(readonly hooks: ListenerHooks) {}
  async start() {}
  listen() { this.listening = true; }
  mute() { this.listening = false; }
  stop() { this.listening = false; }
  say(text: string) {
    if (!this.listening) throw new Error(`not listening when told: ${text}`);
    this.hooks.onHeard(text);
  }
}

async function until<T>(check: () => Promise<T | undefined> | T | undefined, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("wake-phrase voice for a project agent, against the isolated fixture and the fake GPT-Live", () => {
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  let live: FakeOpenAiLive;
  let bot: Bot;
  const url = (path: string) => new URL(path, fixture!.info.url);
  const call = async (path: string, body?: unknown, method = "POST") => {
    const response = await fetch(url(path), {
      method,
      headers: { "content-type": "application/json", origin: fixture!.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const currentBot = async () => ((await (await fetch(url("/api/bots"))).json()) as { bots: Bot[] }).bots.find((candidate) => candidate.id === bot.id)!;
  const messages = async () => ((await (await fetch(url(`/api/threads/${bot.threadId}/messages?limit=40`))).json()) as { messages: ChatMessage[] }).messages;

  beforeAll(async () => {
    live = await startFakeOpenAiLive();
    fixture = await launchVerificationServer({ PATH: process.env.PATH, OMB_OPENAI_LIVE_URL: live.url });
    bot = ((await (await fetch(url("/api/bots"))).json()) as { bots: Bot[] }).bots[0];
  }, 60_000);

  afterEach(() => stopVoiceWake());

  afterAll(async () => {
    await fixture?.close();
    await live?.stop();
  });

  function session(reply: VoiceSessionDeps["reply"], now: () => number) {
    let listener: ScriptedListener | null = null;
    const spoken: string[] = [];
    const opened: LiveCallState[] = [];
    const deps: VoiceSessionDeps = {
      reply,
      listener: (hooks) => (listener = new ScriptedListener(hooks)),
      send: (target, text) => void call(`/api/bots/${target.botId}/messages`, { text, threadId: target.threadId, sendId: crypto.randomUUID() }),
      speak: async (_target, text) => (spoken.push(text), true),
      stopSpeaking: () => {},
      openLive: async (target) => {
        const started = await call("/api/live/session", { botId: target.botId, threadId: target.threadId, sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n", client: "desktop" });
        if (started.status !== 201) throw new Error(`Live call refused: ${started.status}`);
        opened.push((started.body as { call: LiveCallState }).call);
      },
      hangUp: () => {
        const callId = opened.at(-1)?.callId;
        if (callId) void call("/api/live/call/end", { callId });
      },
      cue: () => {},
      needsAnswerLine: (name) => `${name} needs an answer in the chat.`,
      now,
    };
    const voice = startVoiceWake({ botId: bot.id, threadId: bot.threadId, name: bot.name }, deps);
    return { voice, spoken, opened, get listener() { return listener!; } };
  }

  async function feedChat(voice: ReturnType<typeof session>["voice"]) {
    voice.observeChat(await messages(), Boolean((await currentBot()).busy));
  }

  it("Local: the wake phrase, then a question, reaches the project agent and its answer is spoken", async () => {
    const s = session("speak", Date.now);
    await feedChat(s.voice);
    await until(() => (voiceWakeSnapshot().state.phase === "idle" ? true : undefined), "listening");

    s.listener.say("We should order lunch.");
    s.listener.say(`Ehi ${bot.name}`);
    expect(voiceWakeSnapshot().state.phase).toBe("awake");
    s.listener.say("What is six times seven?");
    expect(voiceWakeSnapshot().state.phase).toBe("asking");

    await until(async () => {
      await feedChat(s.voice);
      return s.spoken.length ? true : undefined;
    }, "the spoken answer");
    expect(s.spoken).toEqual(["hello from fake claude"]);
    const chat = await messages();
    expect(chat.filter((message) => message.role === "user").map((message) => message.text)).toEqual(["What is six times seven?"]);
    expect(chat.some((message) => message.text === "We should order lunch.")).toBe(false);
    expect(voiceWakeSnapshot().state.phase).toBe("awake");
    expect(voiceWakeSnapshot().transcript.map((line) => `${line.who}: ${line.text}`)).toEqual([
      "you: What is six times seven?",
      "agent: hello from fake claude",
    ]);
  }, 60_000);

  it("GPT voice: the wake phrase opens a GPT-Live call with the saved key, passes the question on, and hangs up when quiet", async () => {
    expect((await call("/api/config", { live: { key } }, "PUT")).status).toBe(200);
    let clock = Date.now();
    const s = session("live", () => clock);
    await feedChat(s.voice);
    await until(() => (voiceWakeSnapshot().state.phase === "idle" ? true : undefined), "listening");
    const sessionsBefore = live.sessions.length;

    s.listener.say(`Hey ${bot.name}, what is six times seven?`);
    expect(voiceWakeSnapshot().state.phase).toBe("live");
    expect(s.listener.listening).toBe(false);
    const created = await until(() => live.sessions[sessionsBefore], "a GPT-Live session");
    expect(created.key).toBe(key);
    await live.waitForAttach(created.id);

    const observe = async () => {
      const state = ((await (await fetch(url("/api/live/call"))).json()) as { call: LiveCallState | null }).call;
      const phase: LiveMediaPhase = !state ? "idle" : state.status === "connecting" ? "starting" : state.status === "live" ? "live" : state.status === "ending" ? "ending" : "ended";
      s.voice.observeLive({ phase, botId: state?.botId ?? null, heard: "", caption: "", needsKey: false }, Boolean((await currentBot()).busy));
      return phase;
    };
    await until(async () => ((await observe()) === "live" ? true : undefined), "the call to go live");
    await until(async () => {
      const chat = await messages();
      return chat.some((message) => message.role === "user" && message.text === "what is six times seven?") ? true : undefined;
    }, "the question in the chat");
    const spokenBack = await live.waitForCommand(created.id, (command) =>
      command.type === "session.commentary.append" && String(command.content).includes("hello from fake claude"), 20_000);
    expect(spokenBack).toBeTruthy();

    await until(async () => (!(await currentBot()).busy ? true : undefined), "the agent to finish");
    clock += LIVE_QUIET_MS + 1;
    await observe();
    await until(async () => {
      const phase = await observe();
      return voiceWakeSnapshot().state.phase === "idle" ? phase : undefined;
    }, "the quiet call to end and listening to go back to local");
    expect(created.closed).toBe(true);
    expect(s.listener.listening).toBe(true);
    const config = await fetch(url("/api/config")).then((response) => response.text());
    expect(config).not.toContain(key);
  }, 90_000);
});
