import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: vi.fn() }) };
});

import { startVoiceWake, stopVoiceWake, type VoiceSessionDeps } from "@/lib/voice/voice-session";
import { VoiceSessionStrip } from "./VoiceSessionStrip";
import { VoiceWakePill } from "./VoiceWakePill";
import { VoiceWakeSettings } from "./VoiceWakeSettings";

const origin = { id: "chief", threadId: "t1", name: "Origin" } as Bot;

let say: (text: string) => void = () => {};

function deps(reply: VoiceSessionDeps["reply"] = "speak"): VoiceSessionDeps {
  return {
    reply,
    listener: (hooks) => ({
      start: async () => void (say = hooks.onHeard),
      listen() {},
      mute() {},
      stop() {},
    }),
    send: () => {},
    speak: () => new Promise(() => {}),
    stopSpeaking: () => {},
    openLive: async () => {},
    hangUp: () => {},
    cue: () => {},
    needsAnswerLine: (name) => name,
    now: () => 0,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

afterEach(() => stopVoiceWake());

describe("voice settings", () => {
  it("offers Local, explains why the ChatGPT plan cannot carry voice, and prices the API key", () => {
    const markup = renderToStaticMarkup(createElement(VoiceWakeSettings, { env: { localEngine: "apple-speech", openaiKeyConfigured: true } }));
    const words = text(markup);
    expect(words).toContain("Local (free)");
    expect(words).toContain("No audio leaves it.");
    expect(words).toContain("Uses Apple's on-device speech recognition.");
    expect(words).toContain("does not include audio or transcription");
    expect(words).toContain("About $0.05 per minute");
    expect(words).toContain("After the wake phrase your voice goes to OpenAI.");
    expect(markup.match(/type="radio"/g)).toHaveLength(3);
    expect(markup.match(/disabled=""/g)).toHaveLength(1);
  });

  it("says where wake listening works when this computer cannot hear it", () => {
    const words = text(renderToStaticMarkup(createElement(VoiceWakeSettings, { env: { localEngine: "none", openaiKeyConfigured: true } })));
    expect(words).toContain("needs the Origin desktop app on Windows or macOS");
  });
});

describe("voice session strip", () => {
  it("is absent while listening is off", () => {
    expect(renderToStaticMarkup(createElement(VoiceSessionStrip, { bot: origin }))).toBe("");
  });

  it("shows that it is listening for the wake phrase, locally, with a way to turn it off", async () => {
    startVoiceWake({ botId: "chief", threadId: "t1", name: "Origin" }, deps());
    await flush();
    const markup = renderToStaticMarkup(createElement(VoiceSessionStrip, { bot: origin }));
    expect(text(markup)).toContain("Listening for “ehi Origin”");
    expect(text(markup)).toContain("On this computer");
    expect(markup).toContain('aria-label="Turn off"');
  });

  it("keeps a running transcript of what was asked", async () => {
    startVoiceWake({ botId: "chief", threadId: "t1", name: "Origin" }, deps());
    await flush();
    say("hey origin, how are the tests?");
    const words = text(renderToStaticMarkup(createElement(VoiceSessionStrip, { bot: origin })));
    expect(words).toContain("Origin is working on it");
    expect(words).toContain("You: how are the tests?");
  });

  it("says plainly when voice goes to OpenAI", async () => {
    startVoiceWake({ botId: "chief", threadId: "t1", name: "Origin" }, deps("live"));
    await flush();
    expect(text(renderToStaticMarkup(createElement(VoiceSessionStrip, { bot: origin })))).toContain("Voice to OpenAI");
  });
});

describe("voice wake pill", () => {
  it("shows a listening project only while another chat is open", async () => {
    startVoiceWake({ botId: "chief", threadId: "t1", name: "Origin" }, deps());
    await flush();
    expect(renderToStaticMarkup(createElement(VoiceWakePill, { currentBotId: "chief", onOpen: () => {} }))).toBe("");
    const markup = renderToStaticMarkup(createElement(VoiceWakePill, { currentBotId: "other", onOpen: () => {} }));
    expect(text(markup)).toContain("Listening for Origin");
    expect(markup).toContain('aria-label="Stop listening for “ehi Origin”"');
  });
});
