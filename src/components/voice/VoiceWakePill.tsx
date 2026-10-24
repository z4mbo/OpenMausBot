import { Ear, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { stopVoiceWake, useVoiceWake } from "@/lib/voice/voice-session";

export function VoiceWakePill({ currentBotId, onOpen, iconOnly = false }: {
  currentBotId: string | null;
  onOpen: (botId: string, threadId: string) => void;
  iconOnly?: boolean;
}) {
  const wake = useVoiceWake();
  const target = wake.target;
  if (!target || wake.state.phase === "off" || target.botId === currentBotId) return null;
  const label = t("voice.session.pill", { name: target.name });
  const error = wake.state.phase === "error";
  const off = (
    <button
      type="button"
      aria-label={t("voice.wake.turnOff", { name: target.name })}
      title={t("voice.wake.turnOff", { name: target.name })}
      onClick={() => stopVoiceWake(target.botId)}
      className="flex shrink-0 items-center justify-center rounded-full p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
    >
      <X className="size-3.5" />
    </button>
  );
  const dot = <span className={cn("size-2 shrink-0 rounded-full", error ? "bg-danger" : "animate-pulse bg-success")} aria-hidden />;
  if (iconOnly) {
    return (
      <div className="mx-2 mb-2 flex flex-col items-center gap-1 rounded-xl border border-success/40 bg-panel py-1.5">
        <button type="button" aria-label={label} title={label} onClick={() => onOpen(target.botId, target.threadId)} className="relative flex items-center justify-center rounded-full p-1.5 text-success hover:bg-raised">
          <Ear className="size-4" />
          <span className="absolute right-0.5 top-0.5">{dot}</span>
        </button>
        {off}
      </div>
    );
  }
  return (
    <div className="mx-2 mb-2 flex items-center gap-1 rounded-xl border border-success/40 bg-panel px-2 py-1.5 text-[12.5px] text-ink" data-voice-wake-pill>
      <button type="button" onClick={() => onOpen(target.botId, target.threadId)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {dot}
        <Ear className="size-3.5 shrink-0 text-ink-secondary" aria-hidden />
        <span className="truncate">{label}</span>
      </button>
      {off}
    </div>
  );
}
