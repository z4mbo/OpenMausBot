import { useCallback, useRef, useState } from "react";
import { Camera, Check, Dices, Loader2, Mic, Pause, Play, Rotate3d, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { chipButton, inputClass } from "../origin-pages/ui";
import { Popover, studioPost, type StudioDraft } from "./studio-ui";
import { STUDIO_CAMERA_ANGLES, STUDIO_CAMERA_MOTIONS, STUDIO_VOICES, type StudioModel } from "../../../shared/studio";

type Patch = (patch: Partial<StudioDraft>) => void;

const valueOf = (allowed: readonly string[] | undefined, value: string | undefined) => (value && allowed?.includes(value) ? value : allowed?.[0] ?? "");
const durationLabel = (value: string) => (value === "auto" ? "Auto length" : value.endsWith("s") ? value : `${value}s`);

/** The voice list with a sample of each, made once per voice on the person's fal key. */
function VoicePicker({ value, disabled, onChange }: { value: string; disabled: boolean; onChange(voice: string): void }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    audio.current?.pause();
    setPlaying(null);
  }, []);
  const preview = async (voice: string) => {
    if (playing === voice) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    setLoading(voice);
    setError("");
    try {
      const { url } = await studioPost<{ url: string }>("voice-preview", { voice });
      audio.current?.pause();
      audio.current = new Audio(url);
      audio.current.onended = () => setPlaying(null);
      await audio.current.play();
      setPlaying(voice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(null);
    }
  };
  return (
    <div className="relative">
      <button type="button" className={chipButton} disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Voice: ${value}`}>
        <Mic size={13} />{value}
      </button>
      <Popover open={open} onClose={close} label="Voices">
        {error && <p className="px-2 py-1.5 text-[12px] text-danger">{error}</p>}
        {STUDIO_VOICES.map((voice) => (
          <div key={voice.name} className={cn("flex items-center gap-1 rounded-lg pr-1", voice.name === value && "bg-raised")}>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-raised focus-visible:bg-raised"
              onClick={() => { onChange(voice.name); close(); }} aria-pressed={voice.name === value}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] text-ink">{voice.name}</span>
                <span className="truncate text-[11.5px] text-ink-tertiary">{voice.tone}</span>
              </span>
              {voice.name === value && <Check size={13} className="text-accent-text" aria-hidden="true" />}
            </button>
            <button type="button" className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
              onClick={() => void preview(voice.name)} aria-label={playing === voice.name ? `Stop ${voice.name}` : `Hear ${voice.name}`}>
              {loading === voice.name ? <Loader2 size={13} className="animate-spin" /> : playing === voice.name ? <Pause size={13} /> : <Play size={13} />}
            </button>
          </div>
        ))}
      </Popover>
    </div>
  );
}

/** Seed, negative prompt and soundtrack: the settings most generations leave alone. */
function MoreSettings({ model, draft, disabled, patch }: { model: StudioModel; draft: StudioDraft; disabled: boolean; patch: Patch }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const changed = draft.seed !== undefined || Boolean(draft.negativePrompt?.trim());
  return (
    <div className="relative">
      <button type="button" className={cn(chipButton, changed && "text-ink")} disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="More settings" title="Seed and negative prompt">
        <SlidersHorizontal size={13} />{changed ? "Custom" : "More"}
      </button>
      <Popover open={open} onClose={close} label="More settings" className="w-80 p-3">
        <div className="flex flex-col gap-3">
          {model.seed && (
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              <span className="font-medium">Seed</span>
              <span className="flex gap-1.5">
                <input className={inputClass} inputMode="numeric" placeholder="Random" value={draft.seed ?? ""} aria-label="Seed"
                  onChange={(event) => { const next = Number.parseInt(event.target.value, 10); patch({ seed: Number.isFinite(next) ? Math.abs(next) % 2_147_483_647 : undefined }); }} />
                <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline/60 text-ink-secondary hover:bg-raised hover:text-ink"
                  aria-label="Random seed" onClick={() => patch({ seed: Math.floor(Math.random() * 2_147_483_647) })}><Dices size={14} /></button>
              </span>
            </label>
          )}
          {model.negative && (
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              <span className="font-medium">Avoid</span>
              <textarea className={inputClass} rows={2} maxLength={2_000} placeholder="blur, text artefacts, extra fingers" aria-label="Negative prompt"
                value={draft.negativePrompt ?? ""} onChange={(event) => patch({ negativePrompt: event.target.value })} />
            </label>
          )}
        </div>
      </Popover>
    </div>
  );
}

/** The selected model's own settings, shown as chips in the prompt bar. */
export function StudioControls({ model, draft, disabled, patch }: { model: StudioModel; draft: StudioDraft; disabled: boolean; patch: Patch }) {
  return (
    <>
      {model.aspectRatios && (
        <Select variant="pill" size="sm" aria-label="Aspect ratio" value={valueOf(model.aspectRatios, draft.aspectRatio)} disabled={disabled} onChange={(event) => patch({ aspectRatio: event.target.value })}>
          {model.aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio === "auto" ? "Auto ratio" : ratio}</option>)}
        </Select>
      )}
      {model.durations && (
        <Select variant="pill" size="sm" aria-label={model.kind === "audio" ? "Length" : "Duration"} value={valueOf(model.durations, draft.duration)} disabled={disabled} onChange={(event) => patch({ duration: event.target.value })}>
          {model.durations.map((value) => <option key={value} value={value}>{durationLabel(value)}</option>)}
        </Select>
      )}
      {model.resolutions && (
        <Select variant="pill" size="sm" aria-label="Resolution" value={valueOf(model.resolutions, draft.resolution)} disabled={disabled} onChange={(event) => patch({ resolution: event.target.value })}>
          {model.resolutions.map((value) => <option key={value} value={value}>{value.toUpperCase().replace("P", "p")}</option>)}
        </Select>
      )}
      {model.angles && (
        <Select variant="pill" size="sm" icon={<Rotate3d size={13} />} aria-label="Camera angle" value={valueOf(STUDIO_CAMERA_ANGLES.map((angle) => angle.id), draft.angle)} disabled={disabled} onChange={(event) => patch({ angle: event.target.value })}>
          {STUDIO_CAMERA_ANGLES.map((angle) => <option key={angle.id} value={angle.id}>{angle.label}</option>)}
        </Select>
      )}
      {model.voices && <VoicePicker value={valueOf(model.voices, draft.voice)} disabled={disabled} onChange={(voice) => patch({ voice })} />}
      {model.motion && (
        <Select variant="pill" size="sm" icon={<Camera size={13} />} aria-label="Camera motion" value={draft.motion ?? ""} disabled={disabled} onChange={(event) => patch({ motion: event.target.value || undefined })}>
          <option value="">Free camera</option>
          {STUDIO_CAMERA_MOTIONS.map((motion) => <option key={motion.id} value={motion.id}>{motion.label}</option>)}
        </Select>
      )}
      {model.sound && (
        <button type="button" role="switch" aria-checked={draft.sound !== false} className={cn(chipButton, draft.sound === false && "text-ink-tertiary")} disabled={disabled}
          onClick={() => patch({ sound: draft.sound === false })} aria-label="Soundtrack">
          {draft.sound === false ? <VolumeX size={13} /> : <Volume2 size={13} />}{draft.sound === false ? "Silent" : "Sound"}
        </button>
      )}
      {(model.seed || model.negative) && <MoreSettings model={model} draft={draft} disabled={disabled} patch={patch} />}
      {model.maxCount > 1 && (
        <Select variant="pill" size="sm" aria-label="Variations" value={String(Math.min(draft.count, model.maxCount))} disabled={disabled} onChange={(event) => patch({ count: Number(event.target.value) })}>
          {Array.from({ length: model.maxCount }, (_, index) => <option key={index} value={index + 1}>{index + 1} ×</option>)}
        </Select>
      )}
    </>
  );
}
