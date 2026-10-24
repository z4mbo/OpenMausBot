import { Ear, ExternalLink, Square, X } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { VC_RUNTIME_URL, VOICE_ERROR_TEXT, VOICE_PHASE_TEXT } from "@/lib/voice/messages";
import { currentVoiceWake, stopVoiceWake, useVoiceWake } from "@/lib/voice/voice-session";
import type { Bot } from "@/state/store";

export function VoiceSessionStrip({ bot }: { bot: Bot }) {
  const wake = useVoiceWake();
  if (wake.target?.botId !== bot.id || wake.state.phase === "off") return null;
  const { phase, error } = wake.state;
  const cloud = wake.reply === "live";
  const status = phase === "error" ? t(VOICE_ERROR_TEXT[error ?? "engine"]) : t(VOICE_PHASE_TEXT[phase], { name: bot.name });
  const listening = phase === "idle" || phase === "awake";
  return (
    <div className="pointer-events-auto mx-auto mb-2 w-full max-w-[min(48rem,calc(100%-2rem))] rounded-xl border border-hairline bg-panel/95 px-3 py-2 text-[12.5px] text-ink shadow-sm" data-voice-session>
      <div className="flex items-center gap-2">
        <span className={cn("relative flex shrink-0", phase === "error" ? "text-danger" : "text-success")}>
          <Ear size={14} aria-hidden />
          {listening && <span className="absolute -right-0.5 -top-0.5 size-1.5 animate-pulse rounded-full bg-success" aria-hidden />}
        </span>
        <span role="status" className={cn("min-w-0 flex-1 truncate", phase === "error" && "whitespace-normal text-danger")}>{status}</span>
        {phase !== "error" && (
          <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[11px] text-ink-secondary">
            {cloud ? t("voice.session.toOpenAI") : t("voice.session.onComputer")}
          </span>
        )}
        {phase === "speaking" && (
          <button type="button" onClick={() => currentVoiceWake()?.interrupt()} className="flex shrink-0 items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-ink-secondary hover:bg-raised-hover hover:text-ink">
            <Square size={10} className="fill-current" aria-hidden />
            {t("voice.session.stopSpeaking")}
          </button>
        )}
        {phase === "error" && error === "vc-runtime" && (
          <button type="button" onClick={() => void openExternalLink(VC_RUNTIME_URL).catch(() => undefined)} className="flex shrink-0 items-center gap-1 text-accent hover:underline">
            {t("voice.error.vcRuntimeLink")}
            <ExternalLink size={11} aria-hidden />
          </button>
        )}
        {phase === "error" && (
          <button type="button" onClick={() => currentVoiceWake()?.start()} className="shrink-0 text-accent hover:underline">{t("voice.session.retry")}</button>
        )}
        <button
          type="button"
          onClick={() => stopVoiceWake(bot.id)}
          aria-label={t("voice.session.turnOff")}
          title={t("voice.session.turnOff")}
          className="flex shrink-0 items-center rounded-full p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={13} aria-hidden />
        </button>
      </div>
      {wake.transcript.length > 0 && (
        <ol aria-label={t("voice.session.transcript")} className="mt-1.5 flex flex-col gap-0.5 border-t border-hairline/60 pt-1.5">
          {wake.transcript.slice(-4).map((line) => (
            <li key={line.id} className="flex gap-1.5">
              <span className="shrink-0 font-medium text-ink-secondary">{line.who === "you" ? t("voice.session.you") : bot.name}:</span>
              <span className="line-clamp-2 min-w-0 text-ink">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
