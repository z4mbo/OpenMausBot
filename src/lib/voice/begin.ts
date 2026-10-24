import type { ConfigStatus } from "@/state/store";
import { localSystemVoiceActive } from "../local-voice";
import { hangUpLiveCall, startLiveCall } from "../live-call-media";
import { t } from "../i18n";
import { speaker } from "../tts";
import type { VoiceBackend, VoiceEnvironment } from "./backend";
import { playWakeCue } from "./cue";
import { createAppleListener, createWhisperListener, VoiceListenerError } from "./listener";
import { speakWithSystemVoice, stopSystemVoice } from "./system-voice";
import { startVoiceWake, type VoiceSession } from "./voice-session";

export function voiceEnvironment(capabilities: DesktopCapabilities, config: ConfigStatus | null | undefined): VoiceEnvironment {
  return { localEngine: capabilities.localVoice?.engine ?? "none", openaiKeyConfigured: Boolean(config?.live?.configured) };
}

export interface VoiceWakeBot {
  id: string;
  threadId: string;
  name: string;
  voice?: string;
}

export function beginVoiceWake({ bot, backend, capabilities, config, send }: {
  bot: VoiceWakeBot;
  backend: VoiceBackend;
  capabilities: DesktopCapabilities;
  config: ConfigStatus | null | undefined;
  send(botId: string, threadId: string, text: string): void;
}): VoiceSession {
  const engine = capabilities.localVoice?.engine ?? "none";
  const agentVoice = localSystemVoiceActive() || Boolean(config?.tts?.configured && (config.tts.ready || bot.voice));
  const bridge = window.ogb;
  return startVoiceWake({ botId: bot.id, threadId: bot.threadId, name: bot.name }, {
    reply: backend === "openai-key" ? "live" : "speak",
    listener: (hooks) => {
      if (engine === "whisper" && bridge?.localVoice) return createWhisperListener(bridge.localVoice, hooks);
      if (engine === "apple-speech" && bridge) return createAppleListener(bridge, hooks);
      return { start: () => Promise.reject(new VoiceListenerError("engine")), listen() {}, mute() {}, stop() {} };
    },
    send: (target, text) => send(target.botId, target.threadId, text),
    speak: async (_target, text) => {
      if (agentVoice) {
        await speaker.speak(text, { botId: bot.id, voiceId: bot.voice });
        if (!speaker.state.error) return true;
      }
      return speakWithSystemVoice(text, document.documentElement.lang || undefined);
    },
    stopSpeaking: () => {
      speaker.stop();
      stopSystemVoice();
    },
    openLive: (target) => startLiveCall({ botId: target.botId, threadId: target.threadId }),
    hangUp: () => void hangUpLiveCall(),
    cue: playWakeCue,
    needsAnswerLine: (name) => t("voice.session.needsAnswer", { name }),
    now: Date.now,
  });
}
