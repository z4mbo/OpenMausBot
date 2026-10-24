import { createUtteranceMicrophone, type UtteranceMicrophone } from "./microphone";
import type { VoiceSessionError } from "./session-machine";

export interface VoiceListener {
  start(): Promise<void>;
  listen(): void;
  mute(): void;
  stop(): void;
}

export class VoiceListenerError extends Error {
  readonly code: VoiceSessionError;
  constructor(code: VoiceSessionError) {
    super(code);
    this.code = code;
  }
}

export interface ListenerHooks {
  onHeard(text: string): void;
  onFailure(code: VoiceSessionError): void;
  prompt(): string;
}

type LocalVoiceBridge = NonNullable<NonNullable<Window["ogb"]>["localVoice"]>;

function installFailure(code: LocalVoiceErrorCode): VoiceSessionError {
  return code === "vc-runtime-missing" ? "vc-runtime" : code === "download-failed" || code === "download-corrupt" || code === "extract-failed" ? "download" : "engine";
}

export function createWhisperListener(
  bridge: LocalVoiceBridge,
  hooks: ListenerHooks,
  microphone: (onUtterance: (pcm16: Int16Array) => void) => UtteranceMicrophone = createUtteranceMicrophone,
): VoiceListener {
  let generation = 0;
  let muted = true;
  let mic: UtteranceMicrophone | null = null;

  const transcribe = async (pcm16: Int16Array) => {
    const mine = generation;
    const result = await bridge.transcribe(pcm16.slice().buffer, { prompt: hooks.prompt() }).catch(() => ({ error: "transcribe-failed" as const }));
    if (mine !== generation || muted) return;
    if ("error" in result) {
      if (result.error === "vc-runtime-missing" || result.error === "not-installed") hooks.onFailure(installFailure(result.error));
      return;
    }
    if (result.text.trim()) hooks.onHeard(result.text);
  };

  return {
    async start() {
      const status = await bridge.status().catch(() => null);
      if (!status || status.engine !== "whisper") throw new VoiceListenerError("engine");
      if (!status.installed) {
        const installed = await bridge.install().catch(() => ({ error: "download-failed" as const }));
        if ("error" in installed) throw new VoiceListenerError(installFailure(installed.error));
      }
      mic = microphone((pcm16) => void transcribe(pcm16));
      mic.setMuted(true);
      try {
        await mic.start();
      } catch {
        mic.stop();
        mic = null;
        throw new VoiceListenerError("microphone");
      }
    },
    listen() {
      generation += 1;
      muted = false;
      mic?.setMuted(false);
    },
    mute() {
      generation += 1;
      muted = true;
      mic?.setMuted(true);
    },
    stop() {
      generation += 1;
      muted = true;
      mic?.stop();
      mic = null;
    },
  };
}

type SpeechBridge = Pick<NonNullable<Window["ogb"]>, "speechStart" | "speechStop" | "onSpeechTranscript" | "onSpeechEnd">;

const APPLE_FAILURES: Record<string, VoiceSessionError> = {
  "speech-not-authorized": "speech-permission",
  "dictation-disabled": "dictation-disabled",
  "on-device-unavailable": "on-device",
  "mic-failed": "microphone",
  "helper-build-failed": "engine",
  "recognizer-unavailable": "on-device",
};
const RESTARTS_BEFORE_FAILING = 5;
const APPLE_ENDPOINT_MS = 900;

/** The macOS helper ends after each final transcript, and Apple caps one request at about a minute, so it is restarted. */
export function createAppleListener(bridge: SpeechBridge, hooks: ListenerHooks, retryMs = 400): VoiceListener {
  let active = false;
  let failures = 0;
  let unsubscribe: Array<() => void> = [];
  let retry: ReturnType<typeof setTimeout> | null = null;

  const begin = () => {
    if (!active) return;
    void bridge.speechStart({ endpointMs: APPLE_ENDPOINT_MS, onDeviceOnly: true }).catch(() => hooks.onFailure("engine"));
  };
  const clearRetry = () => {
    if (retry) clearTimeout(retry);
    retry = null;
  };

  return {
    async start() {
      unsubscribe = [
        bridge.onSpeechTranscript((line) => {
          if (!active || line.partial !== false || typeof line.text !== "string") return;
          failures = 0;
          if (line.text.trim()) hooks.onHeard(line.text);
        }),
        bridge.onSpeechEnd(({ code, reason }) => {
          if (!active) return;
          const fatal = code === 2 ? "engine" : code === 1 && reason ? APPLE_FAILURES[reason] : undefined;
          if (fatal) return hooks.onFailure(fatal);
          if (code !== 0 && ++failures >= RESTARTS_BEFORE_FAILING) return hooks.onFailure("engine");
          clearRetry();
          retry = setTimeout(begin, code === 0 ? 0 : retryMs);
        }),
      ];
    },
    listen() {
      if (active) return;
      active = true;
      failures = 0;
      begin();
    },
    mute() {
      if (!active) return;
      active = false;
      clearRetry();
      void bridge.speechStop();
    },
    stop() {
      const wasActive = active;
      active = false;
      clearRetry();
      for (const off of unsubscribe) off();
      unsubscribe = [];
      if (wasActive) void bridge.speechStop();
    },
  };
}
