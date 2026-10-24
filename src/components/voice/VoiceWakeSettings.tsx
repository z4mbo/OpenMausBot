import { useId } from "react";
import { Check, Download, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { setVoiceBackend, useVoiceBackend, VOICE_BACKENDS, voiceBackendOptions, type VoiceEnvironment } from "@/lib/voice/backend";
import { useLocalVoiceEngine } from "@/lib/voice/local-engine";
import { LiveKeySetup } from "../LiveKeySetup";

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function LocalEngineRow() {
  const { status, install, remove } = useLocalVoiceEngine();
  if (!status) return null;
  const percent = status.totalBytes ? Math.floor((status.receivedBytes / status.totalBytes) * 100) : 0;
  if (status.installing) {
    return (
      <div className="flex items-center gap-2 text-ink-secondary" role="status">
        <Loader2 size={13} className="animate-spin" aria-hidden />
        {t("voice.local.downloading", { percent })}
      </div>
    );
  }
  if (status.installed) {
    return (
      <div className="flex items-center justify-between gap-2 text-ink-secondary">
        <span className="flex items-center gap-1.5"><Check size={13} className="text-success" aria-hidden />{t("voice.local.ready")}</span>
        <button type="button" className="text-ink-tertiary hover:text-danger hover:underline" onClick={() => void remove()}>
          {t("voice.local.remove")}
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => void install()} className="flex items-center gap-1.5 self-start rounded-full bg-raised px-2.5 py-1 text-ink hover:bg-raised-hover">
      <Download size={13} aria-hidden />
      {t("voice.local.download")} · {megabytes(status.totalBytes)}
    </button>
  );
}

export function VoiceWakeSettings({ env }: { env: VoiceEnvironment }) {
  const chosen = useVoiceBackend();
  const name = useId();
  const options = voiceBackendOptions(env);
  const localHint = env.localEngine === "whisper" ? t("voice.backend.localWhisper") : env.localEngine === "apple-speech" ? t("voice.backend.localApple") : t("voice.backend.onlyHere");
  return (
    <fieldset className="flex flex-col gap-2.5 text-[12.5px] text-ink">
      <legend className="mb-1 text-[12px] font-semibold text-ink-secondary">{t("voice.backend.title")}</legend>
      {VOICE_BACKENDS.map((backend) => {
        const option = options.find((candidate) => candidate.id === backend.id)!;
        const selected = chosen === backend.id && option.selectable;
        const hint = backend.id === "chatgpt-plan" ? t("voice.backend.planUnavailable") : t(backend.hint);
        return (
          <div key={backend.id} className={cn("flex flex-col gap-1.5", !option.selectable && "opacity-70")}>
            <label className={cn("flex items-start gap-2", option.selectable ? "cursor-pointer" : "cursor-not-allowed")}>
              <input
                type="radio"
                name={name}
                className="mt-0.5"
                checked={selected}
                disabled={!option.selectable}
                onChange={() => setVoiceBackend(backend.id)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{t(backend.label)}</span>
                <span className="text-[11.5px] text-ink-tertiary">{hint}</span>
                {backend.id === "local" && <span className="text-[11.5px] text-ink-tertiary">{localHint}</span>}
                {backend.id === "openai-key" && option.selectable && <span className="text-[11.5px] text-ink-tertiary">{t("voice.backend.toOpenAI")}</span>}
              </span>
            </label>
            {backend.id === "local" && option.selectable && <div className="pl-6"><LocalEngineRow /></div>}
            {backend.id === "openai-key" && selected && option.problem === "needs-key" && (
              <div className="flex flex-col gap-1.5 pl-6">
                <span className="text-[11.5px] text-ink-secondary">{t("voice.backend.keyNeeded")}</span>
                <LiveKeySetup compact onSaved={() => {}} />
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
