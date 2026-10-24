import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Ear, EarOff } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { resolveVoiceBackend, useVoiceBackend, wakeListeningAvailable } from "@/lib/voice/backend";
import { beginVoiceWake, voiceEnvironment } from "@/lib/voice/begin";
import { stopVoiceWake, useVoiceWake } from "@/lib/voice/voice-session";
import { useStore, type Bot } from "@/state/store";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { VoiceWakeSettings } from "./VoiceWakeSettings";

export function VoiceWakeButton({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const wake = useVoiceWake();
  const chosen = useVoiceBackend();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const env = voiceEnvironment(capabilities, state.config);
  const resolved = resolveVoiceBackend(chosen, env);
  const available = wakeListeningAvailable(env);
  const on = wake.target?.botId === bot.id && wake.state.phase !== "off";

  const begin = () => beginVoiceWake({
    bot,
    backend: resolved.backend,
    capabilities,
    config: state.config,
    send: (botId, threadId, text) => dispatch({ type: "send", botId, text, threadId }),
  });

  const toggle = () => {
    if (on) return stopVoiceWake(bot.id);
    if (resolved.problem) return setSettingsOpen(true);
    begin();
  };

  const beginRef = useRef(begin);
  beginRef.current = begin;
  const reply = resolved.backend === "openai-key" ? "live" : "speak";
  const restartFor = on && !resolved.problem && wake.reply !== reply ? reply : null;
  useEffect(() => {
    if (restartFor) beginRef.current();
  }, [restartFor]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [settingsOpen]);

  const label = !available ? t("voice.wake.unavailable") : on ? t("voice.wake.turnOff", { name: bot.name }) : t("voice.wake.turnOn", { name: bot.name });
  return (
    <div
      ref={rootRef}
      className="relative flex shrink-0 items-center"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !settingsOpen) return;
        event.stopPropagation();
        setSettingsOpen(false);
      }}
    >
      <button
        type="button"
        data-voice-wake
        aria-pressed={on}
        aria-label={label}
        title={!available ? t("voice.backend.onlyHere") : label}
        disabled={!available}
        onClick={toggle}
        className={cn(
          "flex items-center gap-1.5 rounded-l-full border border-r-0 px-2.5 py-1 text-[13px] disabled:cursor-not-allowed disabled:opacity-50",
          on ? "border-success/50 bg-success/10 text-ink" : "border-hairline/40 bg-raised/60 text-ink-secondary hover:bg-raised hover:text-ink",
        )}
      >
        {on ? (
          <span className="relative flex">
            <Ear size={14} aria-hidden />
            <span className="absolute -right-0.5 -top-0.5 size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
          </span>
        ) : <EarOff size={14} aria-hidden />}
        <span className="@max-4xl/chathead:hidden">{on ? t("voice.wake.on") : t("voice.wake.label")}</span>
      </button>
      <button
        type="button"
        aria-label={t("voice.wake.settings")}
        aria-expanded={settingsOpen}
        aria-controls={settingsOpen ? panelId : undefined}
        title={t("voice.wake.settings")}
        onClick={() => setSettingsOpen((open) => !open)}
        className={cn(
          "flex items-center self-stretch rounded-r-full border px-1.5",
          on ? "border-success/50 bg-success/10 text-ink" : "border-hairline/40 bg-raised/60 text-ink-secondary hover:bg-raised hover:text-ink",
        )}
      >
        <ChevronDown size={13} aria-hidden />
      </button>
      {settingsOpen && (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("voice.wake.settings")}
          className="absolute right-0 top-full z-50 mt-2 w-[320px] max-w-[90vw] rounded-xl border border-hairline bg-panel p-3 shadow-lg"
        >
          <VoiceWakeSettings env={env} />
        </div>
      )}
    </div>
  );
}
