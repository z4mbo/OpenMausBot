import { afterEach, describe, expect, it, vi } from "vitest";

import type { ListenerHooks, VoiceListener } from "./listener";
import { VoiceListenerError } from "./listener";
import type { ReplyVoice } from "./session-machine";
import { LIVE_QUIET_MS, startVoiceWake, stopVoiceWake, voiceWakeSnapshot, type VoiceSessionDeps } from "./voice-session";

const target = { botId: "chief", threadId: "t1", name: "Origin" };

/** A fake transcript source: tests say what the person said. */
class FakeListener implements VoiceListener {
  hooks: ListenerHooks;
  listening = false;
  stopped = false;
  failStart: VoiceListenerError | null = null;
  constructor(hooks: ListenerHooks) {
    this.hooks = hooks;
  }
  async start() {
    if (this.failStart) throw this.failStart;
  }
  listen() {
    this.listening = true;
  }
  mute() {
    this.listening = false;
  }
  stop() {
    this.listening = false;
    this.stopped = true;
  }
  say(text: string) {
    if (this.listening) this.hooks.onHeard(text);
  }
}

function harness(reply: ReplyVoice = "speak") {
  let now = 1_000;
  let listener: FakeListener | null = null;
  let finishSpeaking: (done: boolean) => void = () => {};
  const sent: string[] = [];
  const spoken: string[] = [];
  const calls: string[] = [];
  const deps: VoiceSessionDeps = {
    reply,
    listener: (hooks) => (listener = new FakeListener(hooks)),
    send: (_target, text) => void sent.push(text),
    speak: (_target, text) => {
      spoken.push(text);
      return new Promise<boolean>((resolve) => (finishSpeaking = resolve));
    },
    stopSpeaking: () => {
      calls.push("stopSpeaking");
      finishSpeaking(false);
    },
    openLive: async () => void calls.push("openLive"),
    hangUp: () => void calls.push("hangUp"),
    cue: () => void calls.push("cue"),
    needsAnswerLine: (name) => `${name} needs an answer in the chat.`,
    now: () => now,
  };
  const session = startVoiceWake(target, deps);
  return {
    session, sent, spoken, calls,
    get listener() { return listener!; },
    advance(ms: number) { now += ms; },
    finishSpeaking: (done = true) => finishSpeaking(done),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("voice wake session", () => {
  afterEach(() => {
    stopVoiceWake();
    vi.useRealTimers();
  });

  it("asks the project agent what follows the wake phrase and speaks its answer", async () => {
    const h = harness();
    await flush();
    expect(voiceWakeSnapshot().state.phase).toBe("idle");
    expect(h.listener.listening).toBe(true);

    h.listener.say("did you see the game last night");
    expect(h.sent).toEqual([]);
    h.listener.say("Ehi Origin");
    expect(voiceWakeSnapshot().state.phase).toBe("awake");
    expect(h.calls).toEqual(["cue"]);
    h.listener.say("What's the status of the launch?");
    expect(h.sent).toEqual(["What's the status of the launch?"]);
    expect(h.listener.listening).toBe(false);

    h.session.observeChat([{ id: "u1", role: "user", kind: "text", text: "What's the status of the launch?" }], true);
    h.session.observeChat([
      { id: "u1", role: "user", kind: "text", text: "What's the status of the launch?" },
      { id: "b1", role: "bot", kind: "text", text: "Checking." },
    ], true);
    expect(h.spoken).toEqual([]);
    h.session.observeChat([
      { id: "u1", role: "user", kind: "text", text: "What's the status of the launch?" },
      { id: "b1", role: "bot", kind: "text", text: "Checking." },
      { id: "b2", role: "bot", kind: "text", text: "Two issues are left.", turnTerminal: true },
    ], false);
    expect(h.spoken).toEqual(["Two issues are left."]);
    expect(voiceWakeSnapshot().state.phase).toBe("speaking");
    expect(voiceWakeSnapshot().transcript.map((line) => `${line.who}: ${line.text}`)).toEqual([
      "you: What's the status of the launch?",
      "agent: Two issues are left.",
    ]);

    h.finishSpeaking();
    await flush();
    expect(voiceWakeSnapshot().state.phase).toBe("awake");
    expect(h.listener.listening).toBe(true);
  });

  it("does not take earlier chat messages for the answer", async () => {
    const h = harness();
    await flush();
    h.session.observeChat([{ id: "old", role: "bot", kind: "text", text: "Old answer", turnTerminal: true }], false);
    h.listener.say("hey origin, anything new?");
    h.session.observeChat([{ id: "old", role: "bot", kind: "text", text: "Old answer", turnTerminal: true }], true);
    expect(h.spoken).toEqual([]);
  });

  it("says the agent needs an answer in the chat instead of guessing", async () => {
    const h = harness();
    await flush();
    h.listener.say("hey origin, deploy it");
    h.session.observeChat([{ id: "c1", role: "bot", kind: "options", card: { requestId: "r", subtitle: "Allow?", options: [] } as never }], true);
    expect(h.spoken).toEqual(["Origin needs an answer in the chat."]);
  });

  it("goes back to waiting when the agent finishes without an answer", async () => {
    const h = harness();
    await flush();
    h.listener.say("hey origin, tidy up");
    h.session.observeChat([], true);
    h.session.observeChat([], false);
    expect(voiceWakeSnapshot().state.phase).toBe("idle");
    expect(h.listener.listening).toBe(true);
  });

  it("stops speaking when interrupted and listens for the next question", async () => {
    const h = harness();
    await flush();
    h.listener.say("hey origin, read me the notes");
    h.session.observeChat([{ id: "b", role: "bot", kind: "text", text: "A long note", turnTerminal: true }], false);
    h.session.interrupt();
    await flush();
    expect(h.calls).toContain("stopSpeaking");
    expect(voiceWakeSnapshot().state.phase).toBe("awake");
  });

  it("with GPT voice, opens a Live call, passes on an inline question once live, and hangs up when quiet", async () => {
    const h = harness("live");
    await flush();
    h.listener.say("hey origin, how are the tests?");
    expect(h.calls).toEqual(["cue", "openLive"]);
    expect(h.listener.listening).toBe(false);
    const live = { botId: "chief", heard: "", caption: "", needsKey: false };
    h.session.observeLive({ ...live, phase: "starting" }, false);
    expect(h.sent).toEqual([]);
    h.session.observeLive({ ...live, phase: "live" }, false);
    expect(h.sent).toEqual(["how are the tests?"]);
    h.advance(LIVE_QUIET_MS - 1);
    h.session.observeLive({ ...live, phase: "live", caption: "They pass." }, false);
    h.advance(LIVE_QUIET_MS - 1);
    h.session.observeLive({ ...live, phase: "live", caption: "They pass." }, false);
    expect(h.calls).not.toContain("hangUp");
    h.advance(2);
    h.session.observeLive({ ...live, phase: "live", caption: "They pass." }, false);
    expect(h.calls).toContain("hangUp");
    h.session.observeLive({ ...live, phase: "idle" }, false);
    expect(voiceWakeSnapshot().state.phase).toBe("idle");
    expect(h.listener.listening).toBe(true);
  });

  it("reports a Live call that never connected", async () => {
    const h = harness("live");
    await flush();
    h.listener.say("ehi origin");
    h.session.observeLive({ botId: "chief", heard: "", caption: "", needsKey: false, phase: "starting" }, false);
    h.session.observeLive({ botId: "chief", heard: "", caption: "", needsKey: false, phase: "failed" }, false);
    expect(voiceWakeSnapshot().state).toEqual({ phase: "error", error: "live" });
    expect(h.listener.stopped).toBe(true);
  });

  it("reports why listening could not start", async () => {
    let failing: FakeListener | null = null;
    startVoiceWake(target, {
      ...harnessDeps(),
      listener: (hooks) => {
        failing = new FakeListener(hooks);
        failing.failStart = new VoiceListenerError("vc-runtime");
        return failing;
      },
    });
    await flush();
    expect(voiceWakeSnapshot().state).toEqual({ phase: "error", error: "vc-runtime" });
    expect(failing!.stopped).toBe(true);
  });

  it("turning off releases the microphone and ignores late results", async () => {
    const h = harness();
    await flush();
    const listener = h.listener;
    stopVoiceWake("someone-else");
    expect(voiceWakeSnapshot().target?.botId).toBe("chief");
    stopVoiceWake("chief");
    expect(listener.stopped).toBe(true);
    expect(voiceWakeSnapshot()).toMatchObject({ target: null, state: { phase: "off" } });
    listener.hooks.onHeard("hey origin, still there?");
    expect(h.sent).toEqual([]);
  });
});

function harnessDeps(): VoiceSessionDeps {
  return {
    reply: "speak",
    listener: () => { throw new Error("unused"); },
    send: () => {},
    speak: async () => true,
    stopSpeaking: () => {},
    openLive: async () => {},
    hangUp: () => {},
    cue: () => {},
    needsAnswerLine: (name) => name,
    now: () => 0,
  };
}
