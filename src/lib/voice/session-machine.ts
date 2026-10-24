import type { WakeMatch } from "./wake-phrase";

export type VoicePhase = "off" | "starting" | "idle" | "awake" | "asking" | "speaking" | "live" | "error";

export type ReplyVoice = "speak" | "live";

export type VoiceSessionError =
  | "microphone"
  | "engine"
  | "download"
  | "vc-runtime"
  | "on-device"
  | "speech-permission"
  | "dictation-disabled"
  | "live";

export interface VoiceSessionState {
  phase: VoicePhase;
  awakeUntil?: number;
  error?: VoiceSessionError;
}

export type VoiceSessionEvent =
  | { type: "start" }
  | { type: "ready" }
  | { type: "failed"; error: VoiceSessionError }
  | { type: "stop" }
  | { type: "heard"; text: string; at: number }
  | { type: "tick"; at: number }
  | { type: "reply"; text: string }
  | { type: "noReply" }
  | { type: "spoken"; at: number }
  | { type: "interrupt"; at: number }
  | { type: "liveEnded" };

export type VoiceSessionEffect =
  | { type: "prepare" }
  | { type: "listen" }
  | { type: "mute" }
  | { type: "release" }
  | { type: "cue" }
  | { type: "ask"; text: string }
  | { type: "speak"; text: string }
  | { type: "stopSpeaking" }
  | { type: "openLive"; question?: string }
  | { type: "hangUp" };

export interface VoiceSessionConfig {
  match(text: string): WakeMatch | null;
  reply: ReplyVoice;
  awakeMs: number;
  followUpMs: number;
}

export interface VoiceStep {
  state: VoiceSessionState;
  effects: VoiceSessionEffect[];
}

export const VOICE_OFF: VoiceSessionState = { phase: "off" };

const LISTENING: ReadonlySet<VoicePhase> = new Set(["idle", "awake"]);

function spoken(text: string): string {
  const value = text.trim();
  return /\p{L}{2,}/u.test(value) ? value : "";
}

function ask(text: string): VoiceStep {
  return { state: { phase: "asking" }, effects: [{ type: "mute" }, { type: "ask", text }] };
}

function heard(state: VoiceSessionState, text: string, at: number, config: VoiceSessionConfig): VoiceStep {
  const match = config.match(text);
  if (state.phase === "idle") {
    if (!match) return { state, effects: [] };
    const question = spoken(match.rest);
    if (config.reply === "live") {
      return { state: { phase: "live" }, effects: [{ type: "mute" }, { type: "cue" }, { type: "openLive", ...(question ? { question } : {}) }] };
    }
    if (question) {
      const asked = ask(question);
      return { state: asked.state, effects: [{ type: "cue" }, ...asked.effects] };
    }
    return { state: { phase: "awake", awakeUntil: at + config.awakeMs }, effects: [{ type: "cue" }] };
  }
  const question = spoken(match ? match.rest : text);
  if (question) return ask(question);
  if (match) return { state: { phase: "awake", awakeUntil: at + config.awakeMs }, effects: [] };
  return { state, effects: [] };
}

export function stepVoiceSession(state: VoiceSessionState, event: VoiceSessionEvent, config: VoiceSessionConfig): VoiceStep {
  const unchanged: VoiceStep = { state, effects: [] };
  switch (event.type) {
    case "start":
      return state.phase === "off" || state.phase === "error" ? { state: { phase: "starting" }, effects: [{ type: "prepare" }] } : unchanged;
    case "ready":
      return state.phase === "starting" ? { state: { phase: "idle" }, effects: [{ type: "listen" }] } : unchanged;
    case "failed":
      return state.phase === "off" ? unchanged : { state: { phase: "error", error: event.error }, effects: [{ type: "release" }] };
    case "stop": {
      if (state.phase === "off") return unchanged;
      const effects: VoiceSessionEffect[] = [{ type: "release" }];
      if (state.phase === "speaking") effects.unshift({ type: "stopSpeaking" });
      if (state.phase === "live") effects.unshift({ type: "hangUp" });
      return { state: VOICE_OFF, effects };
    }
    case "heard":
      return LISTENING.has(state.phase) ? heard(state, event.text, event.at, config) : unchanged;
    case "tick":
      return state.phase === "awake" && state.awakeUntil !== undefined && event.at >= state.awakeUntil
        ? { state: { phase: "idle" }, effects: [] }
        : unchanged;
    case "reply":
      return state.phase === "asking" && event.text.trim()
        ? { state: { phase: "speaking" }, effects: [{ type: "speak", text: event.text }] }
        : unchanged;
    case "noReply":
      return state.phase === "asking" ? { state: { phase: "idle" }, effects: [{ type: "listen" }] } : unchanged;
    case "spoken":
      return state.phase === "speaking"
        ? { state: { phase: "awake", awakeUntil: event.at + config.followUpMs }, effects: [{ type: "listen" }] }
        : unchanged;
    case "interrupt":
      if (state.phase === "speaking") {
        return { state: { phase: "awake", awakeUntil: event.at + config.awakeMs }, effects: [{ type: "stopSpeaking" }, { type: "listen" }] };
      }
      if (state.phase === "asking") return { state: { phase: "idle" }, effects: [{ type: "listen" }] };
      if (state.phase === "awake") return { state: { phase: "idle" }, effects: [] };
      return unchanged;
    case "liveEnded":
      return state.phase === "live" ? { state: { phase: "idle" }, effects: [{ type: "listen" }] } : unchanged;
  }
}
