import type { LocaleKey } from "@/locales";
import type { VoicePhase, VoiceSessionError } from "./session-machine";

export const VOICE_ERROR_TEXT: Record<VoiceSessionError, LocaleKey> = {
  microphone: "voice.error.microphone",
  engine: "voice.error.engine",
  download: "voice.error.download",
  "vc-runtime": "voice.error.vcRuntime",
  "on-device": "voice.error.onDevice",
  "speech-permission": "voice.error.speechPermission",
  "dictation-disabled": "voice.error.dictationDisabled",
  live: "voice.error.live",
};

export const VOICE_PHASE_TEXT: Record<Exclude<VoicePhase, "off" | "error">, LocaleKey> = {
  starting: "voice.session.starting",
  idle: "voice.session.idle",
  awake: "voice.session.awake",
  asking: "voice.session.asking",
  speaking: "voice.session.speaking",
  live: "voice.session.live",
};

export const VC_RUNTIME_URL = "https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist";
