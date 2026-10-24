import { useSyncExternalStore } from "react";
import type { LocaleKey } from "@/locales";

export type VoiceBackend = "local" | "chatgpt-plan" | "openai-key";
export type LocalVoiceEngine = NonNullable<DesktopCapabilities["localVoice"]>["engine"];

export const VOICE_BACKEND_KEY = "openmausbot.voiceBackend.v1";

export const VOICE_BACKENDS: ReadonlyArray<{ id: VoiceBackend; label: LocaleKey; hint: LocaleKey }> = [
  { id: "local", label: "voice.backend.local", hint: "voice.backend.localHint" },
  { id: "chatgpt-plan", label: "voice.backend.plan", hint: "voice.backend.planHint" },
  { id: "openai-key", label: "voice.backend.key", hint: "voice.backend.keyHint" },
];

export interface VoiceEnvironment {
  localEngine: LocalVoiceEngine;
  openaiKeyConfigured: boolean;
}

export type VoiceBackendProblem = "needs-local-engine" | "plan-not-permitted" | "needs-key";

export interface VoiceBackendOption {
  id: VoiceBackend;
  selectable: boolean;
  problem?: VoiceBackendProblem;
  audioToOpenAI: boolean;
}

/**
 * Sign in with ChatGPT for open-source apps covers the Responses API only and lists audio input and transcription
 * as unsupported (https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations, 2026-10), so a
 * ChatGPT plan cannot carry voice. The plan can still be the project agent's model while voice is Local.
 */
const PLAN_VOICE_PERMITTED = false;

export function voiceBackendOptions(env: VoiceEnvironment): VoiceBackendOption[] {
  const wakeHere = env.localEngine !== "none";
  return [
    { id: "local", selectable: wakeHere, audioToOpenAI: false, ...(wakeHere ? {} : { problem: "needs-local-engine" as const }) },
    { id: "chatgpt-plan", selectable: PLAN_VOICE_PERMITTED, audioToOpenAI: true, problem: "plan-not-permitted" },
    {
      id: "openai-key",
      selectable: wakeHere,
      audioToOpenAI: true,
      ...(!wakeHere ? { problem: "needs-local-engine" as const } : !env.openaiKeyConfigured ? { problem: "needs-key" as const } : {}),
    },
  ];
}

export interface ResolvedVoiceBackend {
  backend: VoiceBackend;
  problem?: VoiceBackendProblem;
}

export function resolveVoiceBackend(chosen: VoiceBackend, env: VoiceEnvironment): ResolvedVoiceBackend {
  const options = voiceBackendOptions(env);
  const option = options.find((candidate) => candidate.id === chosen && candidate.selectable) ?? options[0];
  return option.problem ? { backend: option.id, problem: option.problem } : { backend: option.id };
}

/** Wake listening never streams idle audio anywhere: the wake phrase is always heard by the local engine. */
export function wakeListeningAvailable(env: VoiceEnvironment): boolean {
  return env.localEngine !== "none";
}

export function parseVoiceBackend(value: string | null): VoiceBackend {
  return value === "openai-key" || value === "chatgpt-plan" ? value : "local";
}

function readStored(): VoiceBackend {
  try {
    return parseVoiceBackend(globalThis.localStorage?.getItem(VOICE_BACKEND_KEY) ?? null);
  } catch {
    return "local";
  }
}

let current: VoiceBackend = readStored();
const watchers = new Set<() => void>();

export function voiceBackend(): VoiceBackend {
  return current;
}

export function setVoiceBackend(next: VoiceBackend): void {
  if (next === current) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(VOICE_BACKEND_KEY, next);
  } catch {
  }
  for (const watcher of Array.from(watchers)) watcher();
}

export function useVoiceBackend(): VoiceBackend {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    () => current,
    () => current,
  );
}
