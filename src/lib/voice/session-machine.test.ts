import { describe, expect, it } from "vitest";

import { stepVoiceSession, VOICE_OFF, type VoiceSessionConfig, type VoiceSessionEvent, type VoiceSessionState } from "./session-machine";
import { matchWakePhrase } from "./wake-phrase";

const config = (reply: VoiceSessionConfig["reply"] = "speak"): VoiceSessionConfig => ({
  match: (text) => matchWakePhrase(text, [{ id: "origin", name: "Origin" }]),
  reply,
  awakeMs: 8_000,
  followUpMs: 6_000,
});

function run(events: VoiceSessionEvent[], options = config(), from: VoiceSessionState = VOICE_OFF) {
  let state = from;
  const effects: string[] = [];
  for (const event of events) {
    const next = stepVoiceSession(state, event, options);
    state = next.state;
    effects.push(...next.effects.map((effect) => ("text" in effect ? `${effect.type}:${effect.text}` : "question" in effect && effect.question ? `${effect.type}:${effect.question}` : effect.type)));
  }
  return { state, effects };
}

const listening: VoiceSessionEvent[] = [{ type: "start" }, { type: "ready" }];

describe("voice session", () => {
  it("is off until started, then prepares the engine and listens for the wake phrase", () => {
    expect(run([]).state).toEqual(VOICE_OFF);
    expect(run(listening)).toEqual({ state: { phase: "idle" }, effects: ["prepare", "listen"] });
  });

  it("ignores everything said before the wake phrase", () => {
    const { state, effects } = run([...listening, { type: "heard", text: "what's for dinner", at: 1 }, { type: "heard", text: "origin is late", at: 2 }]);
    expect(state.phase).toBe("idle");
    expect(effects).toEqual(["prepare", "listen"]);
  });

  it("wakes on the phrase, then sends the next utterance as the question", () => {
    const woke = run([...listening, { type: "heard", text: "Ehi Origin", at: 1_000 }]);
    expect(woke.state).toEqual({ phase: "awake", awakeUntil: 9_000 });
    expect(woke.effects.slice(2)).toEqual(["cue"]);
    const asked = run([{ type: "heard", text: "what's the status?", at: 2_000 }], config(), woke.state);
    expect(asked.state.phase).toBe("asking");
    expect(asked.effects).toEqual(["mute", "ask:what's the status?"]);
  });

  it("takes a question asked in the same breath", () => {
    const { state, effects } = run([...listening, { type: "heard", text: "hey origin, open the launch issues", at: 1 }]);
    expect(state.phase).toBe("asking");
    expect(effects.slice(2)).toEqual(["cue", "mute", "ask:open the launch issues"]);
  });

  it("goes back to waiting for the wake phrase when nothing is asked in time", () => {
    const woke = run([...listening, { type: "heard", text: "hey origin", at: 0 }]).state;
    expect(run([{ type: "tick", at: 7_999 }], config(), woke).state.phase).toBe("awake");
    expect(run([{ type: "tick", at: 8_000 }], config(), woke).state.phase).toBe("idle");
    expect(run([{ type: "heard", text: "  ", at: 100 }], config(), woke).state.phase).toBe("awake");
    expect(run([{ type: "heard", text: "hey origin", at: 5_000 }], config(), woke).state).toEqual({ phase: "awake", awakeUntil: 13_000 });
  });

  it("speaks the reply, then listens for a follow-up without the wake phrase", () => {
    const asked = run([...listening, { type: "heard", text: "hey origin what's up", at: 0 }]).state;
    const answered = run([{ type: "reply", text: "All green." }, { type: "spoken", at: 10_000 }], config(), asked);
    expect(answered.effects).toEqual(["speak:All green.", "listen"]);
    expect(answered.state).toEqual({ phase: "awake", awakeUntil: 16_000 });
    const followUp = run([{ type: "heard", text: "and tomorrow?", at: 11_000 }], config(), answered.state);
    expect(followUp.effects).toEqual(["mute", "ask:and tomorrow?"]);
  });

  it("returns to waiting when the agent finishes without a spoken answer", () => {
    const asked = run([...listening, { type: "heard", text: "hey origin what's up", at: 0 }]).state;
    expect(run([{ type: "noReply" }], config(), asked)).toEqual({ state: { phase: "idle" }, effects: ["listen"] });
    expect(run([{ type: "reply", text: "   " }], config(), asked).state.phase).toBe("asking");
  });

  it("can be interrupted while speaking", () => {
    const speaking = run([...listening, { type: "heard", text: "hey origin what's up", at: 0 }, { type: "reply", text: "Long answer" }]).state;
    expect(speaking.phase).toBe("speaking");
    const cut = run([{ type: "interrupt", at: 1_000 }], config(), speaking);
    expect(cut.effects).toEqual(["stopSpeaking", "listen"]);
    expect(cut.state).toEqual({ phase: "awake", awakeUntil: 9_000 });
  });

  it("does not hear its own voice: nothing is heard while asking or speaking", () => {
    const asked = run([...listening, { type: "heard", text: "hey origin what's up", at: 0 }]).state;
    expect(run([{ type: "heard", text: "hey origin stop", at: 1 }], config(), asked).state.phase).toBe("asking");
    const speaking = run([{ type: "reply", text: "x y" }], config(), asked).state;
    expect(run([{ type: "heard", text: "hey origin", at: 2 }], config(), speaking).effects).toEqual([]);
  });

  it("with GPT voice, the wake phrase opens a Live call and passes on a question asked with it", () => {
    const live = run([...listening, { type: "heard", text: "ehi origin", at: 0 }], config("live"));
    expect(live.state.phase).toBe("live");
    expect(live.effects.slice(2)).toEqual(["mute", "cue", "openLive"]);
    const inline = run([...listening, { type: "heard", text: "hey origin, how are the tests?", at: 0 }], config("live"));
    expect(inline.effects.slice(2)).toEqual(["mute", "cue", "openLive:how are the tests?"]);
    expect(run([{ type: "liveEnded" }], config("live"), live.state)).toEqual({ state: { phase: "idle" }, effects: ["listen"] });
  });

  it("turns off from any phase, ending what is under way", () => {
    expect(run([{ type: "stop" }])).toEqual({ state: VOICE_OFF, effects: [] });
    expect(run([...listening, { type: "stop" }]).effects.slice(2)).toEqual(["release"]);
    const speaking = run([...listening, { type: "heard", text: "hey origin hi there", at: 0 }, { type: "reply", text: "hello" }]).state;
    expect(run([{ type: "stop" }], config(), speaking).effects).toEqual(["stopSpeaking", "release"]);
    const live = run([...listening, { type: "heard", text: "hey origin", at: 0 }], config("live")).state;
    expect(run([{ type: "stop" }], config("live"), live).effects).toEqual(["hangUp", "release"]);
  });

  it("reports a failure and can be started again", () => {
    const failed = run([{ type: "start" }, { type: "failed", error: "microphone" }]);
    expect(failed.state).toEqual({ phase: "error", error: "microphone" });
    expect(failed.effects).toEqual(["prepare", "release"]);
    expect(run([{ type: "start" }], config(), failed.state).state.phase).toBe("starting");
    expect(run([{ type: "failed", error: "engine" }]).state).toEqual(VOICE_OFF);
  });
});
