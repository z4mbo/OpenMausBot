import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppleListener, createWhisperListener, VoiceListenerError, type ListenerHooks } from "./listener";
import type { UtteranceMicrophone } from "./microphone";

function hooks() {
  const heard: string[] = [];
  const failures: string[] = [];
  const value: ListenerHooks = { onHeard: (text) => void heard.push(text), onFailure: (code) => void failures.push(code), prompt: () => "Ehi Origin." };
  return { value, heard, failures };
}

function whisperBridge(overrides: Partial<NonNullable<NonNullable<Window["ogb"]>["localVoice"]>> = {}) {
  const transcribed: Array<{ bytes: number; prompt?: string }> = [];
  let answer: (value: { text: string } | { error: LocalVoiceErrorCode }) => void = () => {};
  const bridge = {
    status: vi.fn(async (): Promise<LocalVoiceStatus> => ({ engine: "whisper", installed: true, installing: false, receivedBytes: 0, totalBytes: 1 })),
    install: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const })),
    transcribe: vi.fn((pcm16: ArrayBuffer, options?: { prompt?: string }) => {
      transcribed.push({ bytes: pcm16.byteLength, prompt: options?.prompt });
      return new Promise<{ text: string } | { error: LocalVoiceErrorCode }>((resolve) => (answer = resolve));
    }),
    onProgress: () => () => {},
    ...overrides,
  };
  return { bridge, transcribed, answer: (value: { text: string } | { error: LocalVoiceErrorCode }) => answer(value) };
}

function fakeMicrophone() {
  let deliver: (pcm16: Int16Array) => void = () => {};
  const mic: UtteranceMicrophone & { muted: boolean; stopped: boolean } = {
    muted: false,
    stopped: false,
    start: async () => {},
    setMuted(muted) { this.muted = muted; },
    stop() { this.stopped = true; },
  };
  return { mic, factory: (onUtterance: (pcm16: Int16Array) => void) => ((deliver = onUtterance), mic), utter: (samples = 16_000) => deliver(new Int16Array(samples)) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("whisper listener", () => {
  it("downloads the model on first use, then hands each utterance to whisper.cpp with the project names", async () => {
    const h = hooks();
    const { bridge, transcribed, answer } = whisperBridge({
      status: vi.fn(async () => ({ engine: "whisper" as const, installed: false, installing: false, receivedBytes: 0, totalBytes: 1 })),
    });
    const mic = fakeMicrophone();
    const listener = createWhisperListener(bridge, h.value, mic.factory);
    await listener.start();
    expect(bridge.install).toHaveBeenCalledOnce();
    expect(mic.mic.muted).toBe(true);
    listener.listen();
    expect(mic.mic.muted).toBe(false);
    mic.utter();
    expect(transcribed).toEqual([{ bytes: 32_000, prompt: "Ehi Origin." }]);
    answer({ text: "Hey Origin." });
    await flush();
    expect(h.heard).toEqual(["Hey Origin."]);
  });

  it("drops a result that arrives after the microphone was muted", async () => {
    const h = hooks();
    const { bridge, answer } = whisperBridge();
    const mic = fakeMicrophone();
    const listener = createWhisperListener(bridge, h.value, mic.factory);
    await listener.start();
    listener.listen();
    mic.utter();
    listener.mute();
    answer({ text: "the agent's own voice" });
    await flush();
    expect(h.heard).toEqual([]);
  });

  it("names what stopped it from starting", async () => {
    const mic = fakeMicrophone();
    const download = whisperBridge({
      status: vi.fn(async () => ({ engine: "whisper" as const, installed: false, installing: false, receivedBytes: 0, totalBytes: 1 })),
      install: vi.fn(async () => ({ error: "download-corrupt" as const })),
    });
    await expect(createWhisperListener(download.bridge, hooks().value, mic.factory).start()).rejects.toEqual(new VoiceListenerError("download"));
    const broken = fakeMicrophone();
    broken.mic.start = async () => { throw new Error("NotAllowedError"); };
    await expect(createWhisperListener(whisperBridge().bridge, hooks().value, broken.factory).start()).rejects.toMatchObject({ code: "microphone" });
    expect(broken.mic.stopped).toBe(true);
  });

  it("reports a missing Visual C++ runtime as soon as whisper.cpp cannot run", async () => {
    const h = hooks();
    const { bridge, answer } = whisperBridge();
    const mic = fakeMicrophone();
    const listener = createWhisperListener(bridge, h.value, mic.factory);
    await listener.start();
    listener.listen();
    mic.utter();
    answer({ error: "vc-runtime-missing" });
    await flush();
    expect(h.failures).toEqual(["vc-runtime"]);
  });
});

describe("Apple listener", () => {
  afterEach(() => vi.useRealTimers());

  function appleBridge() {
    let transcript: (line: { partial?: boolean; text?: string }) => void = () => {};
    let end: (info: { code: number | null; reason?: string }) => void = () => {};
    const bridge = {
      speechStart: vi.fn(async (_options?: { endpointMs?: number; onDeviceOnly?: boolean }) => {}),
      speechStop: vi.fn(async () => {}),
      onSpeechTranscript: (cb: typeof transcript) => ((transcript = cb), () => (transcript = () => {})),
      onSpeechEnd: (cb: typeof end) => ((end = cb), () => (end = () => {})),
    };
    return { bridge, say: (line: Parameters<typeof transcript>[0]) => transcript(line), end: (info: Parameters<typeof end>[0]) => end(info) };
  }

  it("listens on-device only and restarts after every final transcript", async () => {
    vi.useFakeTimers();
    const h = hooks();
    const apple = appleBridge();
    const listener = createAppleListener(apple.bridge, h.value);
    await listener.start();
    expect(apple.bridge.speechStart).not.toHaveBeenCalled();
    listener.listen();
    expect(apple.bridge.speechStart).toHaveBeenCalledWith({ endpointMs: 900, onDeviceOnly: true });
    apple.say({ partial: true, text: "hey ori" });
    apple.say({ partial: false, text: "hey Origin" });
    expect(h.heard).toEqual(["hey Origin"]);
    apple.end({ code: 0, reason: "completed" });
    await vi.advanceTimersByTimeAsync(1);
    expect(apple.bridge.speechStart).toHaveBeenCalledTimes(2);
  });

  it("stops the helper when muted and ignores what it still reports", async () => {
    const h = hooks();
    const apple = appleBridge();
    const listener = createAppleListener(apple.bridge, h.value);
    await listener.start();
    listener.listen();
    listener.mute();
    expect(apple.bridge.speechStop).toHaveBeenCalledOnce();
    apple.say({ partial: false, text: "hey Origin" });
    apple.end({ code: 0 });
    expect(h.heard).toEqual([]);
    expect(apple.bridge.speechStart).toHaveBeenCalledOnce();
  });

  it("gives up on permission problems at once and on repeated failures after a few tries", async () => {
    vi.useFakeTimers();
    const h = hooks();
    const apple = appleBridge();
    const listener = createAppleListener(apple.bridge, h.value, 10);
    await listener.start();
    listener.listen();
    apple.end({ code: 1, reason: "on-device-unavailable" });
    expect(h.failures).toEqual(["on-device"]);
    for (let i = 0; i < 4; i++) {
      apple.end({ code: 1, reason: "recognition-error" });
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(h.failures).toEqual(["on-device"]);
    apple.end({ code: 1, reason: "recognition-error" });
    expect(h.failures).toEqual(["on-device", "engine"]);
  });
});
