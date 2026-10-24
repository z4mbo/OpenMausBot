import { afterEach, describe, expect, it, vi } from "vitest";

import { parseVoiceBackend, resolveVoiceBackend, VOICE_BACKEND_KEY, VOICE_BACKENDS, voiceBackendOptions, wakeListeningAvailable } from "./backend";
import { t } from "../i18n";

const windows = { localEngine: "whisper" as const, openaiKeyConfigured: false };
const mac = { localEngine: "apple-speech" as const, openaiKeyConfigured: true };
const browser = { localEngine: "none" as const, openaiKeyConfigured: true };

describe("voice backend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("defaults to Local and reads only known stored values", () => {
    expect(parseVoiceBackend(null)).toBe("local");
    expect(parseVoiceBackend("openai-key")).toBe("openai-key");
    expect(parseVoiceBackend("chatgpt-plan")).toBe("chatgpt-plan");
    expect(parseVoiceBackend("OPENAI-KEY")).toBe("local");
    expect(VOICE_BACKENDS.map((backend) => t(backend.label))).toEqual(["Local (free)", "ChatGPT plan", "OpenAI API key"]);
  });

  it("offers Local and the API key wherever this computer can hear the wake phrase", () => {
    expect(voiceBackendOptions(windows)).toEqual([
      { id: "local", selectable: true, audioToOpenAI: false },
      { id: "chatgpt-plan", selectable: false, audioToOpenAI: true, problem: "plan-not-permitted" },
      { id: "openai-key", selectable: true, audioToOpenAI: true, problem: "needs-key" },
    ]);
    expect(voiceBackendOptions(mac).find((option) => option.id === "openai-key")).toEqual({ id: "openai-key", selectable: true, audioToOpenAI: true });
  });

  it("never offers the ChatGPT plan for voice, and says why", () => {
    for (const env of [windows, mac, browser]) {
      expect(voiceBackendOptions(env).find((option) => option.id === "chatgpt-plan")).toMatchObject({ selectable: false, problem: "plan-not-permitted" });
    }
    expect(resolveVoiceBackend("chatgpt-plan", mac)).toEqual({ backend: "local" });
    expect(t("voice.backend.planUnavailable")).toContain("audio");
  });

  it("only Local keeps audio on the computer", () => {
    const local = voiceBackendOptions(mac).filter((option) => !option.audioToOpenAI).map((option) => option.id);
    expect(local).toEqual(["local"]);
  });

  it("resolves the stored choice, reporting what must be fixed first", () => {
    expect(resolveVoiceBackend("local", windows)).toEqual({ backend: "local" });
    expect(resolveVoiceBackend("openai-key", windows)).toEqual({ backend: "openai-key", problem: "needs-key" });
    expect(resolveVoiceBackend("openai-key", mac)).toEqual({ backend: "openai-key" });
    expect(resolveVoiceBackend("openai-key", browser)).toEqual({ backend: "local", problem: "needs-local-engine" });
    expect(resolveVoiceBackend("local", browser)).toEqual({ backend: "local", problem: "needs-local-engine" });
  });

  it("listens for the wake phrase only with a local engine, so idle audio is never streamed", () => {
    expect(wakeListeningAvailable(windows)).toBe(true);
    expect(wakeListeningAvailable(mac)).toBe(true);
    expect(wakeListeningAvailable(browser)).toBe(false);
  });

  it("remembers the choice on this device", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    const fresh = await import("./backend");
    expect(fresh.voiceBackend()).toBe("local");
    fresh.setVoiceBackend("openai-key");
    expect(stored.get(VOICE_BACKEND_KEY)).toBe("openai-key");
    vi.resetModules();
    expect((await import("./backend")).voiceBackend()).toBe("openai-key");
  });
});
